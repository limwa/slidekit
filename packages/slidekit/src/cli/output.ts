import { Data, Effect } from "effect"
import { Console as NodeConsole } from "node:console"

/** A failure the CLI reports as one line, `slidekit: <message>`, before it exits with 1. */
export class CliError extends Data.TaggedError("CliError")<{ readonly message: string }> {}

/**
 * Where logs go: stderr, for every command. Stdout holds only a command's result, so `--json` output parses and a
 * script can capture a URL or a code.
 */
export const stderr: Console = Object.assign(new NodeConsole({ stdout: process.stderr, stderr: process.stderr }), {
  write: (...data: Array<string | ArrayBufferView | ArrayBuffer>) => {
    const bytes = data.map((chunk) =>
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : ArrayBuffer.isView(chunk)
        ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        : Buffer.from(chunk)
    )
    const all = Buffer.concat(bytes)
    process.stderr.write(all)
    return all.byteLength
  }
})

/** Writes a command's result to stdout. */
export const result = (text: string) => Effect.sync(() => void process.stdout.write(text.endsWith("\n") ? text : `${text}\n`))
