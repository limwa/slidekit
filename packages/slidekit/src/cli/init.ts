import { Effect, FileSystem, Option, Path, Schema } from "effect"
import * as path from "node:path"
import { CliError } from "./output.ts"
import * as Project from "./project.ts"

const packageDir = path.resolve(import.meta.dirname, "../..")

const tsconfig = {
  compilerOptions: {
    target: "ES2023",
    module: "ESNext",
    moduleResolution: "Bundler",
    lib: ["ES2023", "DOM", "DOM.Iterable"],
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    skipLibCheck: true,
    noEmit: true
  },
  include: ["slidekit.config.ts", "src"]
}

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n"

/** `my-talk` becomes `My talk`. */
const title = (name: string) => {
  const words = name.replace(/-+/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The files of a new deck, by path. `slidekit` is the dependency spec for slidekit itself. */
export const files = (name: string, slidekit: string): Readonly<Record<string, string>> => ({
  "package.json": json({
    name,
    private: true,
    type: "module",
    scripts: {
      dev: "slidekit dev",
      build: "slidekit build",
      deploy: "slidekit deploy",
      typecheck: "tsc --noEmit"
    },
    dependencies: { slidekit },
    devDependencies: { typescript: "7.0.2" }
  }),
  "tsconfig.json": json(tsconfig),
  ".gitignore": "node_modules/\n.slidekit/\n.alchemy/\n",
  "slidekit.config.ts": `import { Deck } from "slidekit"
import { hello } from "./src/slides/hello.ts"
import { steps } from "./src/slides/steps.ts"

export default Deck.make({
  title: ${JSON.stringify(title(name))},
  slides: [hello, steps]
})
`,
  "src/slides/hello.ts": `import { Slide } from "slidekit"

export const hello = Slide.make({
  steps: 2,
  notes: "Say hello. The next step reveals the subtitle.",
  view: (h, { step }) =>
    h.div.class("flex h-full flex-col justify-center px-[160px]").children(
      h.h1.class("text-[160px] leading-none font-semibold tracking-[-0.04em]").children(${
    JSON.stringify(title(name))
  }),
      h.p.class(
        "mt-12 text-[48px] text-ink/70 transition duration-500",
        step >= 1 ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      ).children("Press → to step through the deck.")
    )
})
`,
  "src/slides/steps.ts": `import { Slide } from "slidekit"

const points = ["A slide is a view of its step.", "Classes keyed on the step do the motion.", "Viewers follow the presenter live."]

export const steps = Slide.make({
  steps: points.length,
  notes: "Each step reveals one more point.",
  view: (h, { step }) =>
    h.div.class("flex h-full flex-col justify-center px-[160px]").children(
      h.h2.class("text-[112px] font-semibold tracking-[-0.035em]").children("Steps"),
      h.ul.class("mt-14 space-y-8 text-[48px]").children(
        ...points.map((point, index) =>
          h.li.key(String(index)).class(
            "transition duration-500",
            step >= index ? "text-accent opacity-100" : "opacity-0"
          ).children(point)
        )
      )
    )
})
`
})

const Version = Schema.fromJsonString(Schema.Struct({ version: Schema.String }))
const Workspaces = Schema.fromJsonString(Schema.Struct({ workspaces: Schema.optional(Schema.Unknown) }))

/**
 * How the new deck depends on slidekit: `workspace:*` when the deck lands inside the Bun workspace this slidekit
 * belongs to, and this slidekit's own version otherwise.
 */
const slidekitSpec = Effect.fn("init.slidekitSpec")(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const own = yield* Schema.decodeEffect(Version)(yield* fs.readFileString(path.join(packageDir, "package.json")))
  for (let root = path.dirname(packageDir); root !== path.dirname(root); root = path.dirname(root)) {
    const manifest = path.join(root, "package.json")
    if (!(yield* fs.exists(manifest))) continue
    const { workspaces } = yield* Schema.decodeEffect(Workspaces)(yield* fs.readFileString(manifest))
    if (workspaces === undefined) continue
    return path.relative(root, dir).startsWith("..") ? own.version : "workspace:*"
  }
  return own.version
})

/** Creates a deck in `dir`, which must be missing or empty, and returns the dependency spec it used for slidekit. */
export const create = Effect.fn("init.create")(function*(dir: string, name: Option.Option<string>) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const target = path.resolve(dir)
  if ((yield* fs.exists(target)) && (yield* fs.readDirectory(target)).length > 0) {
    return yield* new CliError({ message: `${target} is not empty. slidekit init writes only into a new or empty directory.` })
  }
  const deck = Option.getOrElse(name, () => Project.workerName(path.basename(target)))
  if (!Project.isWorkerName(deck)) {
    return yield* new CliError({
      message: `--name must be lowercase letters, digits and inner dashes, at most 63, such as ${
        Project.workerName(deck)
      }. It becomes the Worker name and the workers.dev subdomain.`
    })
  }
  const slidekit = yield* slidekitSpec(target)
  for (const [file, content] of Object.entries(files(deck, slidekit))) {
    yield* fs.makeDirectory(path.dirname(path.join(target, file)), { recursive: true })
    yield* fs.writeFileString(path.join(target, file), content)
  }
  yield* fs.makeDirectory(path.join(target, "public"), { recursive: true })
  return { dir: target, name: deck, slidekit }
})
