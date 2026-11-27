import { Router } from "@effect/ui"
import { BrowserHost, BrowserRouter } from "@effect/ui/html"
import { Effect, Layer } from "effect"
import type * as Deck from "../Deck.ts"
import { ViewerRoute } from "./routes.ts"
import { Viewer } from "./Viewer.ts"

/** Starts the viewer for `deck` in `#slidekit`, or in the body without one. The URL hash holds the position. */
export const mount = (deck: Deck.Deck): void => {
  const container = document.getElementById("slidekit") ?? document.body
  const props = Effect.map(Router.currentRoute(ViewerRoute), (route) => ({ route, host: location.host }))
  BrowserHost.mount(Viewer(deck), props, container).pipe(
    Layer.provide(BrowserRouter.layerHash({ routes: ViewerRoute, scroll: false, focus: false })),
    Layer.launch,
    Effect.runFork
  )
}
