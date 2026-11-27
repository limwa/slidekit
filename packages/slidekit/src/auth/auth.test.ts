import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import * as Attempts from "./Attempts.ts"
import * as Code from "./Code.ts"
import * as Session from "./Session.ts"

const code = Option.getOrThrow(Code.normalize("ABCD-EFGH"))

describe("Code", () => {
  it("reads a code however it is typed", () => {
    for (const input of ["abcd-efgh", "ABCD EFGH", " abcdefgh ", "Ab-Cd Ef-gH"]) {
      expect(Code.normalize(input)).toEqual(Option.some("ABCDEFGH"))
    }
    // Crockford's aliases: O is 0, and I and L are 1.
    expect(Code.normalize("OIL0-1234")).toEqual(Option.some("0110" + "1234"))
  })

  it("refuses what isn't 8 characters of the alphabet", () => {
    for (const input of ["", "ABCD-EFG", "ABCD-EFGHJ", "ABCD-EFGU", "ABCD_EFGH", "ABCD-EFG!"]) {
      expect(Code.normalize(input)).toEqual(Option.none())
    }
  })

  it("generates codes that read back as themselves", () => {
    for (let i = 0; i < 50; i++) {
      const generated = Code.generate()
      expect(generated).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/)
      expect(Code.normalize(Code.format(generated))).toEqual(Option.some(generated))
    }
    expect(Code.format(code)).toBe("ABCD-EFGH")
  })

  it.effect("verifies the code it hashed, however it is typed", () =>
    Effect.gen(function*() {
      const stored = yield* Code.hash(code)
      expect(stored).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/)
      expect(yield* Code.verify("abcd efgh", stored)).toBe(true)
      expect(yield* Code.verify("ABCD-EFGJ", stored)).toBe(false)
      expect(yield* Code.verify("not a code", stored)).toBe(false)
    }))

  it.effect("salts every hash", () =>
    Effect.gen(function*() {
      expect(yield* Code.hash(code)).not.toBe(yield* Code.hash(code))
    }))

  it.effect("matches nothing against a malformed hash", () =>
    Effect.gen(function*() {
      const [, , salt, derived] = (yield* Code.hash(code)).split("$")
      for (
        const stored of ["", "garbage", `sha1$100000$${salt}$${derived}`, `pbkdf2-sha256$0$${salt}$${derived}`,
          `pbkdf2-sha256$100001$${salt}$${derived}`, `pbkdf2-sha256$100000$${salt}`]
      ) {
        expect(yield* Code.verify("ABCD-EFGH", stored)).toBe(false)
      }
    }))
})

describe("Session", () => {
  const now = Date.UTC(2026, 10, 27, 12)
  const hour = 60 * 60 * 1000

  const secrets = Effect.map(Code.hash(code), (codeHash): Session.Secrets => ({ key: Session.generateKey(), codeHash }))

  it.effect("verifies a token it signed, for 12 hours", () =>
    Effect.gen(function*() {
      const s = yield* secrets
      const token = yield* Session.sign(s, now)
      expect(yield* Session.verify(token, s, now)).toBe(true)
      expect(yield* Session.verify(token, s, now + 12 * hour)).toBe(true)
      expect(yield* Session.verify(token, s, now + 12 * hour + 1000)).toBe(false)
    }))

  it.effect("refuses a tampered token", () =>
    Effect.gen(function*() {
      const s = yield* secrets
      const token = yield* Session.sign(s, now)
      const [issuedAt, mac] = token.split(".") as [string, string]
      const flipped = (mac[0] === "A" ? "B" : "A") + mac.slice(1)
      for (const tampered of [`${Number(issuedAt) - 60}.${mac}`, `${issuedAt}.${flipped}`, `${issuedAt}.`, "", token + "x"]) {
        expect(yield* Session.verify(tampered, s, now)).toBe(false)
      }
    }))

  it.effect("refuses a token signed with another key", () =>
    Effect.gen(function*() {
      const s = yield* secrets
      const token = yield* Session.sign({ ...s, key: Session.generateKey() }, now)
      expect(yield* Session.verify(token, s, now)).toBe(false)
    }))

  it.effect("ends every session when the code changes", () =>
    Effect.gen(function*() {
      const s = yield* secrets
      const token = yield* Session.sign(s, now)
      const rotated = { ...s, codeHash: yield* Code.hash(Code.generate()) }
      expect(yield* Session.verify(token, rotated, now)).toBe(false)
    }))

  it.effect("refuses a token issued in the future", () =>
    Effect.gen(function*() {
      const s = yield* secrets
      const token = yield* Session.sign(s, now + hour)
      expect(yield* Session.verify(token, s, now)).toBe(false)
    }))
})

describe("Attempts", () => {
  const minute = 60_000

  /** Fails `count` logins, one a second from `start`. */
  const failing = (count: number, start = 0) =>
    Array.from({ length: count }, (_, i) => start + i * 1000).reduce(
      (attempts, at) => Attempts.begin(attempts, at).attempts,
      Attempts.empty
    )

  it("refuses once 10 logins failed in 10 minutes", () => {
    expect(Attempts.begin(failing(9), 9 * 1000).allowed).toBe(true)
    const ten = failing(10)
    const refused = Attempts.begin(ten, 10 * 1000)
    expect(refused.allowed).toBe(false)
    // A refused login doesn't count, so it doesn't stretch the lockout.
    expect(refused.attempts).toEqual(ten)
  })

  it("allows logins again as old failures leave the window", () => {
    const ten = failing(10)
    expect(Attempts.begin(ten, 10 * minute - 1).allowed).toBe(false)
    expect(Attempts.begin(ten, 10 * minute).allowed).toBe(true)
    expect(Attempts.begin(ten, 10 * minute + 9 * 1000).attempts).toHaveLength(1)
  })

  it("stops counting a login that succeeded, and keeps the other failures", () => {
    const nine = failing(9)
    const begun = Attempts.begin(nine, 20 * 1000)
    expect(begun.attempts).toHaveLength(10)
    const after = Attempts.succeeded(begun.attempts, 20 * 1000)
    expect(after).toEqual(nine)
    expect(Attempts.begin(after, 21 * 1000).allowed).toBe(true)
    expect(Attempts.begin(Attempts.begin(after, 21 * 1000).attempts, 22 * 1000).allowed).toBe(false)
  })
})
