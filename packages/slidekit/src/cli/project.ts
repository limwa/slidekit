import tailwindcss from "@tailwindcss/vite"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { searchForWorkspaceRoot, type InlineConfig } from "vite"

/** The files slidekit generates into a deck's hidden `.slidekit/` directory, and the Vite config that builds from them. */
export interface Project {
  readonly root: string
  readonly dir: string
  readonly files: Readonly<Record<string, string>>
  readonly vite: InlineConfig
}

const clientDir = path.resolve(import.meta.dirname, "../client")
const packageDir = path.resolve(import.meta.dirname, "../..")
const tailwindCss = fileURLToPath(import.meta.resolve("tailwindcss/index.css"))

const posix = (file: string) => file.split(path.sep).join("/")

export const make = (root: string): Project => {
  const dir = path.join(root, ".slidekit")
  const relative = (to: string) => posix(path.relative(dir, to))
  const files = {
    ".gitignore": "*\n",
    "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>slidekit</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div id="slidekit"></div>
    <script type="module" src="./entry.ts"></script>
  </body>
</html>
`,
    "entry.ts": `import { mount } from "slidekit/client"
import deck from "../slidekit.config.ts"

mount(deck)
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
    files,
    vite: {
      configFile: false,
      root: dir,
      publicDir: path.join(root, "public"),
      cacheDir: path.join(dir, "cache"),
      plugins: [tailwindcss()],
      build: { outDir: path.join(dir, "dist"), emptyOutDir: true },
      server: { fs: { allow: [searchForWorkspaceRoot(root), root, packageDir] } }
    }
  }
}
