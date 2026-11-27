import { Brand, Effect, Option, Result } from "effect"
import * as Base64Url from "effect/encoding/Base64Url"

/** A presenter code in canonical form: 8 characters of Crockford's base32, upper case, no separator. */
export type Code = string & Brand.Brand<"PresenterCode">

/** Crockford's base32: the digits and the capitals without I, L, O and U. */
export const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export const length = 8

/** The PBKDF2 iteration count. workerd refuses more than 100000. */
export const iterations = 100_000

const algorithm = "pbkdf2-sha256"

/** A fresh code: 40 random bits, 5 per character. */
export const generate = (): Code => {
  const value = crypto.getRandomValues(new Uint8Array(5)).reduce((n, byte) => n * 256 + byte, 0)
  let code = ""
  for (let i = length - 1; i >= 0; i--) code += alphabet[Math.floor(value / 32 ** i) % 32]
  return code as Code
}

/** How a person reads a code: `ABCD-EFGH`. */
export const format = (code: Code): string => `${code.slice(0, 4)}-${code.slice(4)}`

/** Crockford's decoding aliases: the letters a person may type for the digits they look like. */
const aliases: Readonly<Record<string, string>> = { I: "1", L: "1", O: "0" }

/** Reads what a person typed: case doesn't matter, and dashes and spaces are ignored. */
export const normalize = (input: string): Option.Option<Code> => {
  const code = input.toUpperCase().replace(/[\s-]/g, "").replace(/[ILO]/g, (c) => aliases[c]!)
  return code.length === length && [...code].every((c) => alphabet.includes(c))
    ? Option.some(code as Code)
    : Option.none()
}

const derive = (code: Code, salt: Uint8Array<ArrayBuffer>, rounds: number) =>
  Effect.promise(async () => {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveBits"])
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, key, 256)
    return new Uint8Array(bits)
  })

/** Compares in time that depends only on the lengths. */
const equal = (a: Uint8Array, b: Uint8Array): boolean => {
  let difference = a.length ^ b.length
  for (let i = 0; i < Math.min(a.length, b.length); i++) difference |= a[i]! ^ b[i]!
  return difference === 0
}

/** The stored form of a code: `pbkdf2-sha256$<iterations>$<salt>$<hash>`, with a random 16-byte salt. */
export const hash = (code: Code): Effect.Effect<string> =>
  Effect.gen(function*() {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const derived = yield* derive(code, salt, iterations)
    return [algorithm, iterations, Base64Url.encode(salt), Base64Url.encode(derived)].join("$")
  })

const bytes = (encoded: string | undefined): Uint8Array<ArrayBuffer> | undefined => {
  const decoded = encoded === undefined ? undefined : Base64Url.decode(encoded)
  return decoded !== undefined && Result.isSuccess(decoded) ? new Uint8Array(decoded.success) : undefined
}

/** Whether `input`, as a person typed it, is the code `stored` was hashed from. A malformed `stored` matches nothing. */
export const verify = (input: string, stored: string): Effect.Effect<boolean> =>
  Effect.gen(function*() {
    const code = normalize(input)
    const [name, rounds, salt, expected] = stored.split("$")
    const saltBytes = bytes(salt)
    const expectedBytes = bytes(expected)
    const count = Number(rounds)
    if (
      Option.isNone(code) || name !== algorithm || !Number.isInteger(count) || count < 1 || count > iterations ||
      saltBytes === undefined || expectedBytes === undefined
    ) return false
    return equal(yield* derive(code.value, saltBytes, count), expectedBytes)
  })
