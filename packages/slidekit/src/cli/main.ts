#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import * as Alchemist from "alchemy/Alchemist"
import { Effect, FileSystem, Layer, Path, Schema } from "effect"
import { Command, Flag } from "effect/cli"
import { build as viteBuild, createServer } from "vite"
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
    yield* fs.writeFileString(path.join(project.dir, name), content)
  }
  return project
})

const deckName = Effect.fn("deckName")(function*(root: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const { name } = yield* Schema.decodeEffect(PackageJson)(yield* fs.readFileString(path.join(root, "package.json")))
  return Project.workerName(name)
})

/** Runs the deck's Worker and room in local workerd until the scope closes, and returns its URL. */
const runWorker = Effect.fn("runWorker")(function*(project: Project.Project, buildId: string) {
  const fs = yield* FileSystem.FileSystem
  // The Worker serves `dist` as its assets. In dev Vite serves the app, so an empty directory will do.
  yield* fs.makeDirectory(project.dist, { recursive: true })
  const stack = Stack.make({ name: yield* deckName(project.root), assets: project.dist, buildId })
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
      const url = yield* runWorker(project, buildId)
      const server = yield* Effect.acquireRelease(
        Effect.promise(() =>
          createServer({
            ...project.vite,
            server: { ...project.vite.server, port, proxy: { "/ws": { target: url, ws: true } } }
          })
        ),
        (server) => Effect.promise(() => server.close())
      )
      yield* Effect.promise(() => server.listen())
      server.printUrls()
      yield* Effect.log(`Room: ${new URL("/ws", url)}`)
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
