import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, FileSystem, Option } from "effect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as Init from "./init.ts"

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "slidekit-cli-"))

describe("slidekit init", () => {
  const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), "utf8")

  it.effect("creates a deck named after its directory", () =>
    Effect.gen(function*() {
      const dir = path.join(scratch(), "My Talk")
      const created = yield* Init.create(dir, Option.none())
      expect(created.name).toBe("my-talk")
      const files = fs.readdirSync(dir, { recursive: true, withFileTypes: true })
        .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)) + (entry.isDirectory() ? "/" : ""))
        .sort()
      expect(files).toEqual([
        ".gitignore",
        "package.json",
        "public/",
        "slidekit.config.ts",
        "src/",
        "src/slides/",
        "src/slides/hello.ts",
        "src/slides/steps.ts",
        "tsconfig.json"
      ])
      const manifest = JSON.parse(read(dir, "package.json"))
      expect(manifest.name).toBe("my-talk")
      // Outside the workspace, the deck depends on this slidekit's version.
      expect(manifest.dependencies).toEqual({ slidekit: "0.0.0" })
      expect(read(dir, ".gitignore").split("\n")).toEqual(["node_modules/", ".slidekit/", ".alchemy/", ""])
      const { compilerOptions } = JSON.parse(read(dir, "tsconfig.json"))
      expect(compilerOptions).toMatchObject({ strict: true, exactOptionalPropertyTypes: true })
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("takes the name from --name, and refuses one that can't be a Worker name", () =>
    Effect.gen(function*() {
      const dir = scratch()
      const created = yield* Init.create(path.join(dir, "a"), Option.some("git-on-the-edge"))
      expect(JSON.parse(read(created.dir, "package.json")).name).toBe("git-on-the-edge")
      const refused = yield* Effect.exit(Init.create(path.join(dir, "b"), Option.some("Git On The Edge")))
      expect(Exit.isFailure(refused)).toBe(true)
      expect(fs.existsSync(path.join(dir, "b"))).toBe(false)
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("refuses a directory that isn't empty, and leaves it untouched", () =>
    Effect.gen(function*() {
      const dir = scratch()
      fs.writeFileSync(path.join(dir, "notes.md"), "mine")
      const refused = yield* Effect.exit(Init.create(dir, Option.none()))
      expect(Exit.isFailure(refused)).toBe(true)
      expect(fs.readdirSync(dir)).toEqual(["notes.md"])
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("depends on the workspace's slidekit inside the workspace", () =>
    Effect.gen(function*() {
      const fsService = yield* FileSystem.FileSystem
      const dir = path.resolve(import.meta.dirname, "../../../../examples", `init-test-${crypto.randomUUID()}`)
      yield* Effect.addFinalizer(() => fsService.remove(dir, { recursive: true, force: true }).pipe(Effect.orDie))
      yield* Init.create(dir, Option.some("init-test"))
      expect(JSON.parse(read(dir, "package.json")).dependencies).toEqual({ slidekit: "workspace:*" })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
