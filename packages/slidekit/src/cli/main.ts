#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import * as Alchemist from "alchemy/Alchemist"
import { Config, Console, Effect, FileSystem, Layer, Option, Path, Redacted, Schema } from "effect"
import { Command, Flag } from "effect/cli"
import { build as viteBuild, createServer } from "vite"
import * as Code from "../auth/Code.ts"
import * as Session from "../auth/Session.ts"
import { codeHashBinding, sessionKeyBinding } from "../worker/Deck.ts"
import * as Stack from "../worker/stack.ts"
import * as Project from "./project.ts"

const PackageJson = Schema.fromJsonString(Schema.Struct({ name: Schema.String }))

const write = Effect.fn("write")(function*(buildId: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const project = Project.make(process.cwd(), buildId)
  if (!(yield* fs.exists(path.join(project.root, "slidekit.config.ts")))) {
    return yield* Effect.fail(new Error(`No slidekit.config.ts in ${project.root}`))
  }
  yield* fs.makeDirectory(project.dir, { recursive: true })
  for (const [name, content] of Object.entries(project.files)) {
    const file = path.join(project.dir, name)
    // Unchanged files stay untouched, so a running `slidekit dev` doesn't reload its pages.
    if ((yield* fs.exists(file)) && (yield* fs.readFileString(file)) === content) continue
    yield* fs.writeFileString(file, content)
  }
  return project
})

const deckName = Effect.fn("deckName")(function*(root: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const { name } = yield* Schema.decodeEffect(PackageJson)(yield* fs.readFileString(path.join(root, "package.json")))
  return Project.workerName(name)
})

/** The presenter code for a dev session: `SLIDEKIT_PRESENTER_CODE` when it is set, or a fresh one. */
const devCode = Effect.gen(function*() {
  const given = yield* Config.option(Config.Redacted("SLIDEKIT_PRESENTER_CODE"))
  if (Option.isNone(given)) return Code.generate()
  return yield* Option.match(Code.normalize(Redacted.value(given.value)), {
    onNone: () =>
      Effect.fail(
        new Error("SLIDEKIT_PRESENTER_CODE must be 8 characters of 0-9 and A-Z, without I, L, O or U, such as ABCD-EFGH")
      ),
    onSome: Effect.succeed
  })
})

/** The Worker's secrets, for its `Config`: the hash of `code` and a fresh session key. */
const secretsFor = (code: Code.Code) =>
  Effect.map(Code.hash(code), (hash) => ({ [codeHashBinding]: hash, [sessionKeyBinding]: Session.generateKey() }))

/** Runs the deck's Worker and room in local workerd until the scope closes, and returns its URL. */
const runWorker = Effect.fn("runWorker")(function*(
  project: Project.Project,
  buildId: string,
  secrets: Readonly<Record<string, string>>
) {
  const fs = yield* FileSystem.FileSystem
  // The Worker serves `dist` as its assets. In dev Vite serves the app, so an empty directory will do.
  yield* fs.makeDirectory(project.dist, { recursive: true })
  const stack = Stack.make({ name: yield* deckName(project.root), assets: project.dist, buildId })
  // Alchemist reads the Worker's `Config` from the shell's env, which it snapshots when it plans.
  yield* Effect.sync(() => Object.assign(process.env, secrets))
  const alchemy = yield* Layer.build(Alchemist.layer())
  const { url } = yield* Effect.gen(function*() {
    const plan = yield* Alchemist.plan({ stack, operation: "deploy", stage: "dev", dev: true })
    return yield* Alchemist.apply(plan)
  }).pipe(Effect.provideContext(alchemy))
  if (url === undefined) return yield* Effect.fail(new Error("The local Worker has no URL"))
  return url
})

const dev = Command.make(
  "dev",
  { port: Flag.Int("port").pipe(Flag.withDescription("The port to serve on."), Flag.withDefault(5173)) },
  ({ port }) =>
    Effect.gen(function*() {
      const buildId = Project.makeBuildId()
      const project = yield* write(buildId)
      const code = yield* devCode
      const url = yield* runWorker(project, buildId, yield* secretsFor(code))
      // `/present` itself is the app, which Vite serves.
      const proxy = {
        "/ws": { target: url, ws: true },
        "/present/login": url,
        "/present/session": url,
        "/present/logout": url
      }
      const server = yield* Effect.acquireRelease(
        Effect.promise(() => createServer({ ...project.vite, server: { ...project.vite.server, port, proxy } })),
        (server) => Effect.promise(() => server.close())
      )
      yield* Effect.promise(() => server.listen())
      server.printUrls()
      yield* Effect.log(`Room: ${new URL("/ws", url)}`)
      const local = server.resolvedUrls?.local[0] ?? `http://localhost:${port}/`
      yield* Console.log(`\n  Presenter code: ${Code.format(code)}  →  ${new URL("/present", local)}\n`)
      return yield* Effect.never
    }).pipe(Effect.scoped)
).pipe(Command.withDescription("Serve the deck with hot reload, and run its Worker and room locally."))

const build = Command.make(
  "build",
  {},
  () =>
    Effect.gen(function*() {
      const project = yield* write(Project.makeBuildId())
      yield* Effect.promise(() => viteBuild(project.vite))
    })
).pipe(Command.withDescription("Build the deck into .slidekit/dist."))

Command.make("slidekit").pipe(
  Command.withSubcommands([dev, build]),
  Command.run({ version: "0.0.0" }),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain
)
