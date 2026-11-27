import * as Cloudflare from "@alchemy.run/cloudflare"
import { Context, Effect } from "effect"
import { HttpServerRequest } from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import Room, { buildIdBinding } from "./Room.ts"

/** What the Worker is deployed as, taken from the deck project when slidekit builds its stack. */
export interface DeckOptions {
  /** The Worker name, and so the `workers.dev` subdomain. */
  readonly name: string
  /** The built app, served as static assets. */
  readonly assets: string
  readonly buildId: string
}

// The runtime bundle evaluates the props again with no deck project around, so the defaults must be harmless there.
export const DeckOptions = Context.Reference<DeckOptions>("slidekit/DeckOptions", {
  defaultValue: () => ({ name: "slidekit", assets: "./dist", buildId: "" })
})

/** The deck's Worker. It runs only for `/ws`, which it hands to the one room. Static assets serve every other path. */
export default class Deck extends Cloudflare.Worker<Deck>()(
  "Deck",
  Effect.gen(function*() {
    const options = yield* DeckOptions
    return {
      main: import.meta.url,
      name: options.name,
      assets: {
        directory: options.assets,
        notFoundHandling: "single-page-application" as const,
        runWorkerFirst: ["/ws"]
      },
      env: { [buildIdBinding]: options.buildId },
      compatibility: { date: "2026-11-01" }
    }
  }),
  Effect.gen(function*() {
    const rooms = yield* Room
    return {
      fetch: Effect.gen(function*() {
        const request = yield* HttpServerRequest
        if (request.url !== "/ws") return HttpServerResponse.text("Not found", { status: 404 })
        if (request.headers.upgrade !== "websocket") {
          return HttpServerResponse.text("Expected Upgrade: websocket", { status: 426 })
        }
        return yield* rooms.getByName("deck").fetch(request)
      })
    }
  })
) {}
