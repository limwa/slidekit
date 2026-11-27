import { Effect } from "effect"
import * as Base64Url from "effect/encoding/Base64Url"

/** How many presenter logins may fail within `window` before the deck refuses more. */
export const limit = 10

/** How far back failed logins count, in milliseconds. */
export const window = 10 * 60_000

/**
 * The logins that count against the limit, for the whole deck: those that failed, and those still being checked. A
 * login counts from the moment it begins, so concurrent guesses can't slip past the limit. The count belongs to one
 * `scope`, so a new presenter code or a new build starts it over.
 */
export interface Attempts {
  readonly scope: string
  readonly times: ReadonlyArray<number>
}

export const empty = (scope: string): Attempts => ({ scope, times: [] })

/**
 * The scope of a count: one presenter code on one build. Rotating the code or deploying again clears a lockout, and
 * only the deck's owner can do either. Restarting `slidekit dev` makes a new build id, so it clears one too.
 */
export const scope = (codeHash: string, buildId: string): Effect.Effect<string> =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${codeHash}\n${buildId}`))
    return Base64Url.encode(new Uint8Array(digest))
  })

/** The stored count if it belongs to `scope`, and a fresh one otherwise. Anything else stored counts as nothing. */
export const within = (stored: unknown, scope: string): Attempts => {
  const attempts = stored as Partial<Attempts> | null | undefined
  return attempts?.scope === scope && Array.isArray(attempts.times) ? { scope, times: attempts.times } : empty(scope)
}

/** Begins a login at `now`. It is refused while `limit` logins count, and otherwise counts until it succeeds. */
export const begin = (attempts: Attempts, now: number): { readonly allowed: boolean; readonly attempts: Attempts } => {
  const recent = attempts.times.filter((at) => at > now - window)
  return recent.length >= limit
    ? { allowed: false, attempts: { scope: attempts.scope, times: recent } }
    : { allowed: true, attempts: { scope: attempts.scope, times: [...recent, now] } }
}

/** The login begun at `at` had the right code, so it stops counting. Other failures still count. */
export const succeeded = (attempts: Attempts, at: number): Attempts => {
  const index = attempts.times.indexOf(at)
  return index === -1
    ? attempts
    : { scope: attempts.scope, times: [...attempts.times.slice(0, index), ...attempts.times.slice(index + 1)] }
}
