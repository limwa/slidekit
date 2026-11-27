import tailwindcss from "@tailwindcss/vite"
import { Effect, FileSystem, Schema } from "effect"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { build as viteBuild, createLogger, searchForWorkspaceRoot, type InlineConfig } from "vite"
import { CliError, stderr } from "./output.ts"

/** The files slidekit generates into a deck's hidden `.slidekit/` directory, and the Vite config that builds from them. */
export interface Project {
  readonly root: string
  readonly dir: string
  /** Where `slidekit build` writes the app, and what the Worker serves as static assets. */
  readonly dist: string
  readonly files: Readonly<Record<string, string>>
  readonly vite: InlineConfig
}

const clientDir = path.resolve(import.meta.dirname, "../client")
const packageDir = path.resolve(import.meta.dirname, "../..")
const tailwindCss = fileURLToPath(import.meta.resolve("tailwindcss/index.css"))

const posix = (file: string) => file.split(path.sep).join("/")

/** A fresh build id. The client bundle and the Worker built together get the same one. */
export const makeBuildId = (): string => crypto.randomUUID()

/** A Worker name from a package name: `@me/My Talk` becomes `my-talk`. */
export const workerName = (packageName: string): string =>
  packageName.replace(/^@[^/]*\//, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 63) || "slidekit"

/** Whether `name` can be a Worker name, and so a `workers.dev` subdomain: lowercase, digits and inner dashes, at most 63. */
export const isWorkerName = (name: string): boolean => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)

/** The stage `slidekit dev` runs in local workerd. No deploy may use it. */
export const devStage = "dev"

/** The stage `slidekit deploy`, `code rotate` and `destroy` use without `--stage`. */
export const defaultStage = "production"

/**
 * The Worker a stage deploys as. The default stage keeps the deck's own name, so it serves at
 * `<deck>.<account>.workers.dev`. Another stage gets `<deck>-<stage>`, so stages never share a Worker.
 */
export const stageWorkerName = (deck: string, stage: string): string =>
  stage === defaultStage ? deck : `${deck}-${stage}`

export const make = (root: string, buildId: string): Project => {
  const dir = path.join(root, ".slidekit")
  const dist = path.join(dir, "dist")
  const relative = (to: string) => posix(path.relative(dir, to))
  const files = {
    ".gitignore": "*\n",
    // Absolute paths, so `/present` and any deeper path load the same app.
    "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>slidekit</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div id="slidekit"></div>
    <script type="module" src="/entry.ts"></script>
  </body>
</html>
`,
    // The build id comes from Vite's `define`, so `slidekit dev` and `slidekit build` never overwrite each other's.
    "entry.ts": `import { mount } from "slidekit/client"
import deck from "../slidekit.config.ts"

declare const __SLIDEKIT_BUILD_ID__: string

mount(deck, { buildId: __SLIDEKIT_BUILD_ID__ })
`,
    "styles.css": `@import "${relative(tailwindCss)}" source(none);
@import "${relative(path.join(clientDir, "theme.css"))}";

@source "../slidekit.config.ts";
@source "../src";
@source "${relative(clientDir)}";
`
  }
  return {
    root,
    dir,
    dist,
    files,
    vite: {
      configFile: false,
      root: dir,
      publicDir: path.join(root, "public"),
      cacheDir: path.join(dir, "cache"),
      plugins: [tailwindcss()],
      define: { __SLIDEKIT_BUILD_ID__: JSON.stringify(buildId) },
      build: { outDir: dist, emptyOutDir: true },
      server: { fs: { allow: [searchForWorkspaceRoot(root), root, packageDir] } }
    }
  }
}

/** Writes the generated files of the deck in `root`. Unchanged files stay untouched, so a running `slidekit dev` doesn't reload its pages. */
export const write = Effect.fn("project.write")(function*(root: string, buildId: string) {
  const fs = yield* FileSystem.FileSystem
  const project = make(root, buildId)
  if (!(yield* fs.exists(path.join(root, "slidekit.config.ts")))) {
    return yield* new CliError({ message: `No slidekit.config.ts in ${root}. Run slidekit in a deck, or create one with slidekit init.` })
  }
  yield* fs.makeDirectory(project.dir, { recursive: true })
  for (const [name, content] of Object.entries(project.files)) {
    const file = path.join(project.dir, name)
    if ((yield* fs.exists(file)) && (yield* fs.readFileString(file)) === content) continue
    yield* fs.writeFileString(file, content)
  }
  return project
})

/**
 * Builds the app into `dist`, logging to stderr. `quiet` keeps only warnings and errors, which also turns off
 * rolldown's native progress lines: those go straight to stdout, out of reach of any logger.
 */
export const build = (project: Project, options: { readonly quiet: boolean }) =>
  Effect.promise(() => {
    const logLevel = options.quiet ? "warn" : "info"
    return viteBuild({ ...project.vite, logLevel, customLogger: createLogger(logLevel, { console: stderr }) })
  })

const PackageJson = Schema.fromJsonString(Schema.Struct({ name: Schema.String }))

/** The deck's Worker name, from its `package.json`. */
export const deckName = Effect.fn("project.deckName")(function*(root: string) {
  const fs = yield* FileSystem.FileSystem
  const { name } = yield* Schema.decodeEffect(PackageJson)(yield* fs.readFileString(path.join(root, "package.json")))
  return workerName(name)
})
