#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Cause, Config, Console, Effect, FileSystem, Option } from "effect"
import { CliError as CliErrors, Command, Flag } from "effect/cli"
import { createServer } from "vite"
import * as Code from "../auth/Code.ts"
import * as Session from "../auth/Session.ts"
import * as Deploy from "./deploy.ts"
import { CliError, result, stderr } from "./output.ts"
import * as Project from "./project.ts"

/** Runs a command with its logs, Alchemy's and Vite's included, on stderr, so stdout holds only its result. */
const logToStderr = <A, E, R>(command: Effect.Effect<A, E, R>) => Effect.provideService(command, Console.Console, stderr)

const codeFormat = "8 characters of 0-9 and A-Z, without I, L, O or U, such as ABCD-EFGH"

const parseCode = (input: string, source: string) =>
  Option.match(Code.normalize(input), {
    onNone: () => Effect.fail(new CliError({ message: `${source} must be ${codeFormat}.` })),
    onSome: Effect.succeed
  })

/** The code from `--code`, or else from `SLIDEKIT_PRESENTER_CODE`, if either is set. */
const givenCode = Effect.fn("givenCode")(function*(flag: Option.Option<string>) {
  if (Option.isSome(flag)) return Option.some(yield* parseCode(flag.value, "--code"))
  const env = yield* Config.option(Config.String("SLIDEKIT_PRESENTER_CODE"))
  return Option.isSome(env) ? Option.some(yield* parseCode(env.value, "SLIDEKIT_PRESENTER_CODE")) : Option.none()
})

const stage = Flag.String("stage").pipe(
  Flag.withDescription("The deploy to act on. The default stage, production, deploys as the deck's own Worker. Any other stage deploys as its own Worker, <deck>-<stage>."),
  Flag.withDefault(Project.defaultStage)
)
const profile = Flag.String("profile").pipe(
  Flag.withDescription(
    "The Alchemy profile with the Cloudflare credentials. Defaults to ALCHEMY_PROFILE, then `default`. CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID override any profile."
  ),
  Flag.optional
)
const json = Flag.Boolean("json").pipe(
  Flag.withDescription("Print the result as one JSON object on stdout. Logs always go to stderr."),
  Flag.withDefault(false)
)
const code = Flag.String("code").pipe(
  Flag.withDescription(`Use this presenter code instead of a fresh one: ${codeFormat}. SLIDEKIT_PRESENTER_CODE works too.`),
  Flag.optional
)

const dev = Command.make(
  "dev",
  { port: Flag.Int("port").pipe(Flag.withDescription("The port to serve on."), Flag.withDefault(5173)) },
  ({ port }) =>
    Effect.gen(function*() {
      const root = process.cwd()
      const buildId = Project.makeBuildId()
      const project = yield* Project.write(root, buildId)
      // A fresh code and key on every run, so a dev session never shares secrets with a deploy.
      const code = Option.getOrElse(yield* givenCode(Option.none()), Code.generate)
      const secrets = { codeHash: yield* Code.hash(code), sessionKey: Session.generateKey() }
      // The Worker serves `dist` as its assets. In dev Vite serves the app, so an empty directory will do.
      yield* (yield* FileSystem.FileSystem).makeDirectory(project.dist, { recursive: true })
      const deck = { name: yield* Project.deckName(root), assets: project.dist, buildId }
      const { apply } = yield* Deploy.planDeploy({ stage: Project.devStage, profile: Option.none() }, deck, secrets, true)
      const { url } = yield* apply
      if (url === undefined) return yield* new CliError({ message: "The local Worker has no URL." })
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
    }).pipe(Effect.scoped, logToStderr)
).pipe(
  Command.withDescription(
    "Serve the deck with hot reload, and run its Worker and room locally. Prints a fresh presenter code, or uses SLIDEKIT_PRESENTER_CODE."
  )
)

const build = Command.make(
  "build",
  {},
  () =>
    Effect.gen(function*() {
      yield* Project.build(yield* Project.write(process.cwd(), Project.makeBuildId()), { quiet: false })
    }).pipe(logToStderr)
).pipe(Command.withDescription("Build the deck into .slidekit/dist."))

const printDeploy = (deployed: Deploy.DeployResult, asJson: boolean) => {
  if (deployed._tag === "Planned") {
    return result(asJson ? JSON.stringify({ dryRun: true, ...deployed.plan }) : Deploy.formatPlan(deployed.plan))
  }
  const code = Option.map(deployed.code, Code.format)
  if (asJson) {
    const { url, presentUrl, stage } = deployed
    return result(JSON.stringify({ url, presentUrl, stage, ...Option.match(code, { onNone: () => ({}), onSome: (code) => ({ code }) }) }))
  }
  return result(
    [
      `Deployed stage ${deployed.stage}`,
      `  Deck:            ${deployed.url}`,
      `  Presenter view:  ${deployed.presentUrl}`,
      ...Option.match(code, {
        onNone: () => [],
        onSome: (code) => [`  Presenter code:  ${code}  (shown once; slidekit code rotate replaces it)`]
      })
    ].join("\n")
  )
}

const runDeploy = (
  flags: { readonly stage: string; readonly profile: Option.Option<string>; readonly json: boolean },
  request: { readonly code: Option.Option<string>; readonly rotate: boolean; readonly dryRun: boolean }
) =>
  Effect.gen(function*() {
    const given = yield* givenCode(request.code)
    const deployed = yield* Deploy.deploy(process.cwd(), flags, { given, rotate: request.rotate, dryRun: request.dryRun })
    yield* printDeploy(deployed, flags.json)
  }).pipe(Effect.scoped, logToStderr)

const deploy = Command.make(
  "deploy",
  {
    stage,
    profile,
    json,
    code,
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Build and plan only. Prints what would change, and changes nothing, local secrets included."),
      Flag.withDefault(false)
    )
  },
  ({ code, dryRun, ...flags }) => runDeploy(flags, { code, rotate: false, dryRun })
).pipe(
  Command.withDescription(
    "Build the deck and deploy it to workers.dev. The first deploy of a stage makes a presenter code and prints it once. Later deploys keep it, so presenters stay signed in; --code replaces it."
  ),
  Command.withExamples([
    { command: "slidekit deploy", description: "Deploy the production stage" },
    { command: "slidekit deploy --dry-run --stage preview", description: "Show what a deploy of stage preview would change" },
    { command: "slidekit deploy --json", description: "Print { url, presentUrl, stage, code? } on stdout" }
  ])
)

const rotate = Command.make(
  "rotate",
  { stage, profile, json, code },
  ({ code, ...flags }) => runDeploy(flags, { code, rotate: true, dryRun: false })
).pipe(
  Command.withDescription(
    "Replace the presenter code of a deployed stage, redeploy, and print the new code once. Every presenter session ends."
  )
)

const presenterCode = Command.make("code").pipe(
  Command.withDescription("Manage the presenter code."),
  Command.withSubcommands([rotate])
)

const destroy = Command.make(
  "destroy",
  {
    stage,
    profile,
    json,
    yes: Flag.Boolean("yes").pipe(
      Flag.withDescription("Destroy for real. Without it, destroy prints what it would remove and exits with 1."),
      Flag.withDefault(false)
    )
  },
  ({ yes, ...flags }) =>
    Effect.gen(function*() {
      const destroyed = yield* Deploy.destroy(process.cwd(), flags, yes)
      const done = destroyed._tag === "Destroyed"
      yield* result(
        flags.json
          ? JSON.stringify({ destroyed: done, ...destroyed.plan })
          : done
          ? `Destroyed stage ${flags.stage}`
          : Deploy.formatPlan(destroyed.plan)
      )
      if (!done) {
        return yield* new CliError({
          message: `Nothing was destroyed. Run slidekit destroy --stage ${flags.stage} --yes to remove it.`
        })
      }
    }).pipe(Effect.scoped, logToStderr)
).pipe(
  Command.withDescription(
    "Remove a stage's Cloudflare resources and its saved presenter secrets. Needs --yes; without it, only prints the plan."
  )
)

/** Every failure ends as one line on stderr and exit code 1. */
const report = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  Effect.catchCause(program, (cause) => {
    const error = Cause.squash(cause)
    // effect/cli has already printed its own parse errors and the help.
    if (Cause.hasInterruptsOnly(cause) || CliErrors.isCliError(error)) return Effect.failCause(cause)
    const message = error instanceof Error ? error.message : String(error)
    return Effect.andThen(Effect.sync(() => stderr.error(`slidekit: ${message}`)), Effect.failCause(cause))
  })

Command.make("slidekit").pipe(
  Command.withDescription("Build, run and deploy live slide decks. No command prompts, so scripts and agents can run each one."),
  Command.withSubcommands([dev, build, deploy, presenterCode, destroy]),
  Command.run({ version: "0.0.0" }),
  report,
  Effect.provide(BunServices.layer),
  (program) => BunRuntime.runMain(program, { disableErrorReporting: true })
)
