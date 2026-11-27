import * as Cloudflare from "@alchemy.run/cloudflare"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import Room from "./Room.ts"

// Static assets serve every path except /ws. Hash routing keeps every deck URL at `/`.
export default class Deck extends Cloudflare.Worker<Deck>()(
  "Deck",
  {
    main: import.meta.url,
    name: "slidekit-spike",
    assets: {
      directory: "./dist",
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/ws"]
    },
    compatibility: { date: "2026-11-01" }
  },
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
