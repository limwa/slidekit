import * as Alchemist from "alchemy/Alchemist"
import { Config, Effect, Layer, Option } from "effect"
import type * as Code from "../auth/Code.ts"
import { codeHashBinding, type DeckOptions, sessionKeyBinding } from "../worker/Deck.ts"
import * as Stack from "../worker/stack.ts"
import { CliError } from "./output.ts"
import * as Project from "./project.ts"
import * as Secrets from "./secrets.ts"

/** Where a command runs the deck's stack. */
export interface Target {
  readonly stage: string
  /** The Alchemy profile. Without one, Alchemy picks `ALCHEMY_PROFILE` or `default`. */
  readonly profile: Option.Option<string>
}

const credentialsHelp =
  "Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or connect Cloudflare to an Alchemy profile with `bun x alchemy profile edit` and pass it with --profile."

/**
 * Fails unless Cloudflare credentials are at hand: both env vars, or a profile with a Cloudflare account. Alchemist
 * resolves credentials lazily, so without this check a plan would succeed and only the apply would find them
 * missing. It doesn't probe the account. Alchemy refreshes an expired token itself, or names the command that does.
 */
const requireCredentials = Effect.fnUntraced(function*(target: Target) {
  const [token, account, selected] = yield* Config.all([
    Config.option(Config.String("CLOUDFLARE_API_TOKEN")),
    Config.option(Config.String("CLOUDFLARE_ACCOUNT_ID")),
    Config.option(Config.String("ALCHEMY_PROFILE"))
  ])
  if (Option.isSome(token) && Option.isSome(account)) return
  const name = Option.getOrElse(Option.orElse(target.profile, () => selected), () => "default")
  const profile = yield* Alchemist.Profile.get({ name, includeProviderStatus: false }).pipe(
    Effect.catchTag("AlchemistNotFound", () => Effect.succeed(undefined))
  )
  if (profile?.providers.some((provider) => provider.name === "Cloudflare")) return
  const problem = profile === undefined
    ? `There is no Alchemy profile named ${name}.`
    : `The Alchemy profile ${name} has no Cloudflare account.`
  return yield* new CliError({ message: `No Cloudflare credentials. ${problem} ${credentialsHelp}` })
}, Effect.provide(Alchemist.layer()))

const alchemy = Effect.fnUntraced(function*(target: Target, dev: boolean) {
  const context = yield* Layer.build(Alchemist.layer())
  const options = {
    stage: target.stage,
    dev,
    ...Option.match(target.profile, { onNone: () => ({}), onSome: (profile) => ({ profile }) })
  }
  return { context, options }
})

/**
 * Plans deploying the deck's one stack, which dev, deploy, rotate and destroy all share. Alchemist reads the Worker's
 * `Config` from the process env, which it snapshots when it plans, so the secrets go there first. The plan and its
 * build stay open until the surrounding scope closes. Nothing changes until `apply` runs.
 */
export const planDeploy = Effect.fn("deploy.planDeploy")(function*(
  target: Target,
  deck: DeckOptions,
  secrets: Secrets.StageSecrets,
  dev = false
) {
  yield* Effect.sync(() =>
    Object.assign(process.env, { [codeHashBinding]: secrets.codeHash, [sessionKeyBinding]: secrets.sessionKey })
  )
  const { context, options } = yield* alchemy(target, dev)
  const stack = Stack.make(deck)
  const plan = yield* Alchemist.plan({ stack, operation: "deploy", ...options }).pipe(Effect.provideContext(context))
  return { plan, apply: Alchemist.apply(plan).pipe(Effect.provideContext(context)) }
})

/** Plans removing everything the stage owns. It never runs the stack's program, so it needs no build and no secrets. */
export const planDestroy = Effect.fn("deploy.planDestroy")(function*(target: Target, deck: DeckOptions) {
  const { context, options } = yield* alchemy(target, false)
  const stack = Stack.make(deck)
  const plan = yield* Alchemist.plan({ stack, operation: "destroy", ...options }).pipe(Effect.provideContext(context))
  return { plan, apply: Alchemist.apply(plan).pipe(Effect.provideContext(context)) }
})

/** What a plan would change, for people and for `--json`. */
export interface PlanView {
  readonly stage: string
  /** The Worker the stage deploys as, and so its workers.dev subdomain. */
  readonly worker: string
  readonly changes: boolean
  readonly summary: Alchemist.PlanSummary
  readonly resources: ReadonlyArray<{ readonly action: string; readonly id: string; readonly type: string }>
}

export const view = (plan: Alchemist.StackPlan, worker: string): PlanView => ({
  stage: plan.stack.stage,
  worker,
  changes: Alchemist.hasChanges(plan),
  summary: plan.summary,
  resources: plan.resources.map((resource) => ({
    action: resource.action,
    id: resource.fqn,
    type: resource.resourceType
  }))
})

export const formatPlan = (plan: PlanView): string => {
  const { summary } = plan
  const rows = plan.resources.map((resource) => `  ${resource.action.padEnd(8)} ${resource.id} (${resource.type})`)
  const counts = ([
    [summary.create, "to create"],
    [summary.adopted, "to adopt"],
    [summary.update, "to update"],
    [summary.replace, "to replace"],
    [summary.delete + summary.orphaned, "to delete"],
    [summary.noop, "unchanged"]
  ] as const).filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`)
  return [`Stage ${plan.stage}, Worker ${plan.worker}:`, ...(rows.length > 0 ? rows : ["  nothing deployed"]), `  ${counts.join(", ") || "no changes"}`]
    .join("\n")
}

/** The deck in `root` and the Worker name its stage deploys as. */
const deck = Effect.fn("deploy.deck")(function*(root: string, stage: string) {
  if (!Project.isWorkerName(stage)) {
    return yield* new CliError({
      message: `--stage must be lowercase letters, digits and inner dashes, such as preview-1, not ${JSON.stringify(stage)}.`
    })
  }
  // The dev stage's state holds local workerd resources. Planning it against Cloudflare would mistake them for real ones.
  if (stage === Project.devStage) {
    return yield* new CliError({ message: `Stage ${stage} belongs to slidekit dev, which runs locally. Pick another stage.` })
  }
  const name = Project.stageWorkerName(yield* Project.deckName(root), stage)
  if (!Project.isWorkerName(name)) {
    return yield* new CliError({ message: `The Worker name ${name} is longer than 63 characters. Pick a shorter stage.` })
  }
  return name
})

export type DeployResult =
  | { readonly _tag: "Planned"; readonly plan: PlanView }
  | {
    readonly _tag: "Deployed"
    readonly stage: string
    readonly url: string
    readonly presentUrl: string
    readonly code: Option.Option<Code.Code>
  }

/**
 * Builds the deck and deploys one stage. The stage's secrets are saved only after the deploy applies, so a failed
 * deploy leaves the file as it was and the next deploy starts over from it. A dry run builds and plans, and stops.
 */
export const deploy = Effect.fn("deploy.deploy")(function*(
  root: string,
  target: Target,
  request: { readonly given: Option.Option<Code.Code>; readonly rotate: boolean; readonly dryRun: boolean }
) {
  const name = yield* deck(root, target.stage)
  yield* requireCredentials(target)
  const stored = yield* Secrets.read(root, target.stage)
  if (request.rotate && Option.isNone(stored)) {
    return yield* new CliError({
      message: `Stage ${target.stage} has no presenter code to rotate. Deploy it first: slidekit deploy --stage ${target.stage}`
    })
  }
  const resolved = yield* Secrets.resolve({ stored, ...request })
  const buildId = Project.makeBuildId()
  const project = yield* Project.write(root, buildId)
  yield* Project.build(project, { quiet: true })
  yield* Effect.log(`Built the deck into ${project.dist}`)
  const { plan, apply } = yield* planDeploy(target, { name, assets: project.dist, buildId }, resolved.secrets)
  if (request.dryRun) return { _tag: "Planned", plan: view(plan, name) } satisfies DeployResult
  const { url } = yield* apply
  if (url === undefined) return yield* new CliError({ message: "The deploy finished, but the Worker has no URL." })
  if (Option.isSome(resolved.save)) yield* Secrets.write(root, target.stage, resolved.save.value)
  return {
    _tag: "Deployed",
    stage: target.stage,
    url,
    presentUrl: new URL("/present", url).href,
    code: resolved.code
  } satisfies DeployResult
})

export type DestroyResult =
  | { readonly _tag: "Planned"; readonly plan: PlanView }
  | { readonly _tag: "Destroyed"; readonly plan: PlanView }

/** Removes the stage's Cloudflare resources, then its secrets. Without `yes`, it only plans. */
export const destroy = Effect.fn("deploy.destroy")(function*(root: string, target: Target, yes: boolean) {
  const name = yield* deck(root, target.stage)
  yield* requireCredentials(target)
  const project = Project.make(root, "")
  const { plan, apply } = yield* planDestroy(target, { name, assets: project.dist, buildId: "" })
  if (!yes) return { _tag: "Planned", plan: view(plan, name) } satisfies DestroyResult
  yield* apply
  yield* Secrets.remove(root, target.stage)
  return { _tag: "Destroyed", plan: view(plan, name) } satisfies DestroyResult
})
