import { Effect, FileSystem, Option, Path, Schema } from "effect"
import * as Code from "../auth/Code.ts"
import * as Session from "../auth/Session.ts"

/**
 * What a deployed stage keeps between deploys, so presenters stay signed in: the presenter code's hash and the
 * session key. The code itself is never stored.
 */
export const StageSecrets = Schema.Struct({ codeHash: Schema.String, sessionKey: Schema.String })
export type StageSecrets = typeof StageSecrets.Type

const StageSecretsJson = Schema.fromJsonString(StageSecrets)

/** Where a stage's secrets live: `.alchemy/slidekit/<stage>.json` in the deck, beside Alchemy's state. */
export const file = (root: string, stage: string) =>
  Effect.map(Path.Path, (path) => path.join(root, ".alchemy", "slidekit", `${stage}.json`))

/** The stage's secrets, or none when the stage was never deployed from this machine. */
export const read = Effect.fn("secrets.read")(function*(root: string, stage: string) {
  const fs = yield* FileSystem.FileSystem
  const target = yield* file(root, stage)
  if (!(yield* fs.exists(target))) return Option.none<StageSecrets>()
  return Option.some(yield* Schema.decodeEffect(StageSecretsJson)(yield* fs.readFileString(target)))
})

/** Writes the stage's secrets, readable only by the owner. A crash mid-write leaves the old file whole. */
export const write = Effect.fn("secrets.write")(function*(root: string, stage: string, secrets: StageSecrets) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const target = yield* file(root, stage)
  yield* fs.makeDirectory(path.dirname(target), { recursive: true })
  const temporary = `${target}.${crypto.randomUUID()}.tmp`
  yield* fs.writeFileString(temporary, JSON.stringify(secrets, null, 2) + "\n", { mode: 0o600 })
  // `mode` applies only when a file is created, and the umask can narrow it, so set it outright.
  yield* fs.chmod(temporary, 0o600)
  yield* fs.rename(temporary, target)
})

export const remove = Effect.fn("secrets.remove")(function*(root: string, stage: string) {
  const fs = yield* FileSystem.FileSystem
  yield* fs.remove(yield* file(root, stage), { force: true })
})

/** What a deploy binds as the Worker's secrets, which new code it prints once, and what it saves after it applies. */
export interface Resolved {
  readonly secrets: StageSecrets
  /** A new presenter code, to print once the deploy succeeds. */
  readonly code: Option.Option<Code.Code>
  /** The secrets to save once the deploy succeeds. */
  readonly save: Option.Option<StageSecrets>
}

export interface Request {
  /** What the stage holds now. */
  readonly stored: Option.Option<StageSecrets>
  /** A code from `--code` or `SLIDEKIT_PRESENTER_CODE`. */
  readonly given: Option.Option<Code.Code>
  /** Replace the code even when none is given. */
  readonly rotate: boolean
  /** Plan only. Nothing is saved or printed, and a first deploy binds throwaway secrets. */
  readonly dryRun: boolean
}

/**
 * The secrets for one deploy. A first deploy makes a code, given or fresh, and a session key. A later deploy keeps
 * both, so presenters stay signed in, unless it rotates or is given another code: then only the code changes, which
 * ends every session. Short of a rotate, a given code that is already the stage's code changes nothing, since a fresh
 * hash of it would still end every session.
 */
export const resolve = Effect.fn("secrets.resolve")(function*(request: Request) {
  const { stored, given, rotate, dryRun } = request
  if (
    Option.isSome(stored) && !rotate &&
    (Option.isNone(given) || (yield* Code.verify(given.value, stored.value.codeHash)))
  ) return { secrets: stored.value, code: Option.none(), save: Option.none() } satisfies Resolved
  const code = Option.getOrElse(given, Code.generate)
  const secrets: StageSecrets = {
    codeHash: yield* Code.hash(code),
    sessionKey: Option.isSome(stored) ? stored.value.sessionKey : Session.generateKey()
  }
  if (dryRun) return { secrets, code: Option.none(), save: Option.none() } satisfies Resolved
  return { secrets, code: Option.some(code), save: Option.some(secrets) } satisfies Resolved
})
