import { Router } from "@effect/ui"
import { BrowserHost, BrowserRouter } from "@effect/ui/html"
import { Effect, Layer } from "effect"
import type * as Deck from "../Deck.ts"
import { CheckSession, Presenter, SignOut } from "./Presenter.ts"
import { SignIn } from "./PresenterLogin.ts"
import { ViewerRoute } from "./routes.ts"
import { Reload, SendGoto, SyncClient } from "./SyncClient.ts"
import { Viewer } from "./Viewer.ts"

/**
 * Starts the deck in `#slidekit`, or in the body without one: the presenter at `/present`, the viewer anywhere else.
 * The URL hash holds the position. `buildId` is the id of this bundle, which the room checks it against.
 */
export const mount = (deck: Deck.Deck, options: { readonly buildId: string }): void => {
  const container = document.getElementById("slidekit") ?? document.body
  const props = Effect.map(
    Router.currentRoute(ViewerRoute),
    (route) => ({ route, host: location.host, buildId: options.buildId })
  )
  const presenter = location.pathname.startsWith("/present")
  const platform = Layer.mergeAll(
    BrowserRouter.layerHash({ routes: ViewerRoute, scroll: false, focus: false }),
    Layer.mergeAll(SendGoto.layer, Reload.layer).pipe(Layer.provideMerge(SyncClient.layer({ buildId: options.buildId, presenter })))
  )
  const app = presenter
    ? BrowserHost.mount(Presenter(deck), props, container).pipe(
      Layer.provide(Layer.mergeAll(CheckSession.layer, SignIn.layer, SignOut.layer))
    )
    : BrowserHost.mount(Viewer(deck), props, container)
  app.pipe(Layer.provide(platform), Layer.launch, Effect.runFork)
}
