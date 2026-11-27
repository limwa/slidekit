#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, FileSystem, Path } from "effect"
import { Command, Flag } from "effect/cli"
import { build as viteBuild, createServer } from "vite"
import * as Project from "./project.ts"

const write = Effect.fn("write")(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const project = Project.make(process.cwd())
  if (!(yield* fs.exists(path.join(project.root, "slidekit.config.ts")))) {
    return yield* Effect.fail(new Error(`No slidekit.config.ts in ${project.root}`))
  }
  yield* fs.makeDirectory(project.dir, { recursive: true })
  for (const [name, content] of Object.entries(project.files)) {
    yield* fs.writeFileString(path.join(project.dir, name), content)
  }
  return project
})

const dev = Command.make(
  "dev",
  { port: Flag.Int("port").pipe(Flag.withDescription("The port to serve on."), Flag.withDefault(5173)) },
  ({ port }) =>
    Effect.gen(function*() {
      const project = yield* write()
      const server = yield* Effect.acquireRelease(
        Effect.promise(() => createServer({ ...project.vite, server: { ...project.vite.server, port } })),
        (server) => Effect.promise(() => server.close())
      )
      yield* Effect.promise(() => server.listen())
      server.printUrls()
      return yield* Effect.never
    }).pipe(Effect.scoped)
).pipe(Command.withDescription("Serve the deck with hot reload."))

const build = Command.make(
  "build",
  {},
  () =>
    Effect.gen(function*() {
      const project = yield* write()
      yield* Effect.promise(() => viteBuild(project.vite))
    })
).pipe(Command.withDescription("Build the deck into .slidekit/dist."))

Command.make("slidekit").pipe(
  Command.withSubcommands([dev, build]),
  Command.run({ version: "0.0.0" }),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain
)
