import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Option } from "effect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as Code from "../auth/Code.ts"
import * as Secrets from "./secrets.ts"

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "slidekit-cli-"))

const code = Option.getOrThrow(Code.normalize("ABCD-EFGH"))
const other = Option.getOrThrow(Code.normalize("WXYZ-2345"))

describe("Stage secrets file", () => {
  it.effect("reads back what it wrote, readable only by the owner", () =>
    Effect.gen(function*() {
      const root = scratch()
      const secrets = { codeHash: "pbkdf2-sha256$1$a$b", sessionKey: "key" }
      yield* Secrets.write(root, "production", secrets)
      expect(yield* Secrets.read(root, "production")).toEqual(Option.some(secrets))
      const file = path.join(root, ".alchemy", "slidekit", "production.json")
      expect(fs.statSync(file).mode & 0o777).toBe(0o600)
      // Only the stage's file is there: no temporary file left behind.
      expect(fs.readdirSync(path.dirname(file))).toEqual(["production.json"])
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("reads none for a stage that was never deployed, and none after removing it", () =>
    Effect.gen(function*() {
      const root = scratch()
      expect(yield* Secrets.read(root, "production")).toEqual(Option.none())
      yield* Secrets.write(root, "preview", { codeHash: "h", sessionKey: "k" })
      yield* Secrets.remove(root, "preview")
      expect(yield* Secrets.read(root, "preview")).toEqual(Option.none())
      // Removing twice is fine, so a destroy that crashed after its apply can run again.
      yield* Secrets.remove(root, "preview")
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("fails on a file that isn't secrets, rather than deploying without them", () =>
    Effect.gen(function*() {
      const root = scratch()
      fs.mkdirSync(path.join(root, ".alchemy", "slidekit"), { recursive: true })
      fs.writeFileSync(path.join(root, ".alchemy", "slidekit", "production.json"), "{}")
      expect(Exit.isFailure(yield* Effect.exit(Secrets.read(root, "production")))).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("Deploy secrets", () => {
  const request = { stored: Option.none(), given: Option.none(), rotate: false, dryRun: false }

  const stored = Effect.map(Code.hash(code), (codeHash) => ({ codeHash, sessionKey: "the-key" }))

  it.effect("a first deploy makes a code and a key, and saves them", () =>
    Effect.gen(function*() {
      const resolved = yield* Secrets.resolve(request)
      const made = Option.getOrThrow(resolved.code)
      expect(yield* Code.verify(made, resolved.secrets.codeHash)).toBe(true)
      expect(resolved.secrets.sessionKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(resolved.save).toEqual(Option.some(resolved.secrets))
    }))

  it.effect("a first deploy takes a given code", () =>
    Effect.gen(function*() {
      const resolved = yield* Secrets.resolve({ ...request, given: Option.some(code) })
      expect(resolved.code).toEqual(Option.some(code))
      expect(yield* Code.verify(code, resolved.secrets.codeHash)).toBe(true)
    }))

  it.effect("a later deploy keeps the code and the key, and prints and saves nothing", () =>
    Effect.gen(function*() {
      const secrets = yield* stored
      const resolved = yield* Secrets.resolve({ ...request, stored: Option.some(secrets) })
      expect(resolved).toEqual({ secrets, code: Option.none(), save: Option.none() })
    }))

  it.effect("a later deploy given the code it already has changes nothing", () =>
    Effect.gen(function*() {
      const secrets = yield* stored
      const resolved = yield* Secrets.resolve({ ...request, stored: Option.some(secrets), given: Option.some(code) })
      expect(resolved).toEqual({ secrets, code: Option.none(), save: Option.none() })
    }))

  it.effect("a later deploy given another code replaces the hash and keeps the key", () =>
    Effect.gen(function*() {
      const secrets = yield* stored
      const resolved = yield* Secrets.resolve({ ...request, stored: Option.some(secrets), given: Option.some(other) })
      expect(resolved.code).toEqual(Option.some(other))
      expect(yield* Code.verify(other, resolved.secrets.codeHash)).toBe(true)
      expect(resolved.secrets.sessionKey).toBe("the-key")
      expect(resolved.save).toEqual(Option.some(resolved.secrets))
    }))

  it.effect("a rotate makes a new code and keeps the key", () =>
    Effect.gen(function*() {
      const secrets = yield* stored
      const resolved = yield* Secrets.resolve({ ...request, stored: Option.some(secrets), rotate: true })
      const made = Option.getOrThrow(resolved.code)
      expect(made).not.toBe(code)
      expect(resolved.secrets.codeHash).not.toBe(secrets.codeHash)
      expect(yield* Code.verify(made, resolved.secrets.codeHash)).toBe(true)
      expect(resolved.secrets.sessionKey).toBe("the-key")
      expect(resolved.save).toEqual(Option.some(resolved.secrets))
    }))

  it.effect("a dry run prints and saves nothing, first deploy or not", () =>
    Effect.gen(function*() {
      const secrets = yield* stored
      for (
        const variant of [
          { stored: Option.none(), given: Option.none() },
          { stored: Option.some(secrets), given: Option.some(other) },
          { stored: Option.some(secrets), given: Option.none() }
        ]
      ) {
        const resolved = yield* Secrets.resolve({ ...variant, rotate: false, dryRun: true })
        expect(resolved.code).toEqual(Option.none())
        expect(resolved.save).toEqual(Option.none())
      }
    }))
})
