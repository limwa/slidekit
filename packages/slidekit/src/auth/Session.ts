import { Effect, Result } from "effect"
import * as Base64Url from "effect/encoding/Base64Url"

/** The cookie that holds a presenter's session token. */
export const cookieName = "slidekit_presenter"

/** How long a session lasts, in seconds. */
export const maxAge = 12 * 60 * 60

/** How far ahead of the Worker's clock an issue time may be, in seconds. */
const skew = 60

/** The Worker's two secrets: the key that signs tokens, and the hash of the current presenter code. */
export interface Secrets {
  readonly key: string
  readonly codeHash: string
}

/** A fresh signing key: 32 random bytes, base64url. */
export const generateKey = (): string => Base64Url.encode(crypto.getRandomValues(new Uint8Array(32)))

const importKey = (key: string) =>
  Effect.promise(() => {
    const decoded = Base64Url.decode(key)
    if (Result.isFailure(decoded)) return Promise.reject(new Error("The session key is not base64url"))
    return crypto.subtle.importKey(
      "raw",
      new Uint8Array(decoded.success),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    )
  })

// The MAC covers the code hash, so a new code ends every session signed under the old one.
const payload = (issuedAt: number, codeHash: string) => new TextEncoder().encode(`slidekit-session:${issuedAt}:${codeHash}`)

/** A token issued at `now` (in milliseconds): `<issued at, in seconds>.<HMAC-SHA256>`. */
export const sign = (secrets: Secrets, now: number): Effect.Effect<string> =>
  Effect.gen(function*() {
    const key = yield* importKey(secrets.key)
    const issuedAt = Math.floor(now / 1000)
    const mac = yield* Effect.promise(() => crypto.subtle.sign("HMAC", key, payload(issuedAt, secrets.codeHash)))
    return `${issuedAt}.${Base64Url.encode(new Uint8Array(mac))}`
  })

/** Whether `token` was signed with these secrets and is younger than `maxAge` at `now` (in milliseconds). */
export const verify = (token: string, secrets: Secrets, now: number): Effect.Effect<boolean> =>
  Effect.gen(function*() {
    const match = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token)
    if (match === null) return false
    const issuedAt = Number(match[1])
    const age = Math.floor(now / 1000) - issuedAt
    const mac = Base64Url.decode(match[2]!)
    if (age < -skew || age > maxAge || Result.isFailure(mac)) return false
    const key = yield* importKey(secrets.key)
    return yield* Effect.promise(() =>
      crypto.subtle.verify("HMAC", key, new Uint8Array(mac.success), payload(issuedAt, secrets.codeHash))
    )
  })
