/** How many presenter logins may fail within `window` before the deck refuses more. */
export const limit = 10

/** How far back failed logins count, in milliseconds. */
export const window = 10 * 60_000

/**
 * The times of the logins that count against the limit, for the whole deck: those that failed, and those still being
 * checked. A login counts from the moment it begins, so concurrent guesses can't slip past the limit.
 */
export type Attempts = ReadonlyArray<number>

export const empty: Attempts = []

/** Begins a login at `now`. It is refused while `limit` logins count, and otherwise counts until it succeeds. */
export const begin = (attempts: Attempts, now: number): { readonly allowed: boolean; readonly attempts: Attempts } => {
  const recent = attempts.filter((at) => at > now - window)
  return recent.length >= limit ? { allowed: false, attempts: recent } : { allowed: true, attempts: [...recent, now] }
}

/** The login begun at `at` had the right code, so it stops counting. Other failures still count. */
export const succeeded = (attempts: Attempts, at: number): Attempts => {
  const index = attempts.indexOf(at)
  return index === -1 ? attempts : [...attempts.slice(0, index), ...attempts.slice(index + 1)]
}
