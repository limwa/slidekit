import { Router } from "@effect/ui"
import { BrowserHost, BrowserRouter } from "@effect/ui/html"
import { Effect, Layer } from "effect"
import type * as Deck from "../Deck.ts"
import type { Role } from "../protocol.ts"
import { ViewerRoute } from "./routes.ts"
import { Reload, SendGoto, SyncClient } from "./SyncClient.ts"
import { Viewer } from "./Viewer.ts"

/**
 * Starts the viewer for `deck` in `#slidekit`, or in the body without one. The URL hash holds the position.
 * At `/present` the client is the presenter. `buildId` is the id of this bundle, which the room checks it against.
 */
export const mount = (deck: Deck.Deck, options: { readonly buildId: string }): void => {
  const container = document.getElementById("slidekit") ?? document.body
  const role: Role = location.pathname.startsWith("/present") ? "presenter" : "viewer"
  const props = Effect.map(
    Router.currentRoute(ViewerRoute),
    (route) => ({ route, host: location.host, role, buildId: options.buildId })
  )
  BrowserHost.mount(Viewer(deck), props, container).pipe(
    Layer.provide([
      BrowserRouter.layerHash({ routes: ViewerRoute, scroll: false, focus: false }),
      Layer.mergeAll(SendGoto.layer, Reload.layer).pipe(Layer.provideMerge(SyncClient.layer({ role, buildId: options.buildId })))
    ]),
    Layer.launch,
    Effect.runFork
  )
}
