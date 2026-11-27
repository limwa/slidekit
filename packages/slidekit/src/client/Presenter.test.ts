import { Component, Router } from "@effect/ui"
import { Story } from "@effect/ui/testing"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Deck from "../Deck.ts"
import * as Position from "../Position.ts"
import type { State } from "../protocol.ts"
import * as Slide from "../Slide.ts"
import { CheckSession, Presenter, PresenterMessage, SignOut } from "./Presenter.ts"
import { routeOf, ViewerRoute } from "./routes.ts"
import { Reload, SendGoto } from "./SyncClient.ts"

const deck = Deck.make({
  title: "Test",
  slides: [Slide.make({ steps: 2, view: (h) => h.div }), Slide.make({ view: (h) => h.div }), Slide.make({ view: (h) => h.div })]
})
const at = Position.make

const state = (position: Position.Position, buildId = "build-1"): State => ({
  _tag: "State",
  position,
  presenterLive: true,
  viewers: 2,
  buildId
})

const start = (position = at(0, 0)) =>
  Story.make(Presenter(deck), { route: routeOf(position), host: "deck.test", buildId: "build-1" })

type Steps = Effect.Success<ReturnType<typeof start>>

/** The session check answers, as the Worker would for a cookie that is or isn't valid. */
const checked = (s: Steps, signedIn: boolean) =>
  s.expectExact(CheckSession.make({})).resolve(CheckSession, PresenterMessage.CompletedCheckSession({ signedIn }))

const presenting = (position = at(0, 0)) => Effect.map(start(position), (s) => checked(s, true))

/** The Router moves to `position`, and its change comes back through the router subscription as it does in the browser. */
const routed = (s: Steps, position: Position.Position) => {
  const replace = Router.replace(ViewerRoute, routeOf(position))
  return s.expectExact(replace).resolve(replace, "navigated").subscription(
    "@effect/ui/Router",
    PresenterMessage.ChangedRoute({ route: routeOf(position) })
  )
}
const received = (s: Steps, value: State) => s.subscription("room", PresenterMessage.ReceivedState({ state: value }))
const shown = (s: Steps) => Position.parse(deck, s.model.route.params["*"])
const connected = (s: Steps) => s.subscriptions.includes("room")

describe("Presenter", () => {
  it.effect("shows the login without a session, and joins the room once signed in", () =>
    Effect.gen(function*() {
      const s = yield* start()
      expect(s.model.screen._tag).toBe("CheckingSession")
      checked(s, false)
      expect(s.model.screen._tag).toBe("SigningIn")
      expect(connected(s)).toBe(false)

      s.send(PresenterMessage.SignedInLogin())
      expect(s.model.screen).toEqual({ _tag: "Presenting", live: null, signingOut: false })
      expect(connected(s)).toBe(true)
    }).pipe(Effect.scoped))

  it.effect("goes straight to the presenter view with a session", () =>
    Effect.gen(function*() {
      const s = yield* presenting()
      expect(s.model.screen._tag).toBe("Presenting")
      expect(connected(s)).toBe(true)
    }).pipe(Effect.scoped))

  it.effect("takes the room's position when it joins, then moves the room", () =>
    Effect.gen(function*() {
      const s = yield* presenting()
      // Moves before joining stay local, so a fresh /present tab can't yank the room back to the start.
      s.send(PresenterMessage.RequestedNext())
      routed(s, at(0, 1))
      s.expectNone()

      received(s, state(at(2, 0)))
      routed(s, at(2, 0))
      s.expectExact(SendGoto.make({ position: at(2, 0) })).resolve(SendGoto, Component.noop)

      s.send(PresenterMessage.RequestedPrevious())
      routed(s, at(1, 0))
      s.expectExact(SendGoto.make({ position: at(1, 0) })).resolve(SendGoto, Component.noop)

      // A late echo of an older position doesn't move the presenter back.
      received(s, state(at(2, 0)))
      s.expectNone()
      expect(shown(s)).toEqual(at(1, 0))
      expect(s.model.screen).toMatchObject({ live: { viewers: 2 } })
    }).pipe(Effect.scoped))

  it.effect("reloads when the room runs another build", () =>
    Effect.gen(function*() {
      const s = yield* presenting(at(1, 0))
      received(s, state(at(2, 0), "build-2"))
      s.expectExact(Reload.make({})).resolve(Reload, Component.noop)
      expect(shown(s)).toEqual(at(1, 0))
    }).pipe(Effect.scoped))

  it.effect("leaves the room and shows the login after signing out", () =>
    Effect.gen(function*() {
      const s = yield* presenting()
      received(s, state(at(0, 0)))
      s.send(PresenterMessage.ClickedSignOut()).expectExact(SignOut.make({})).keepPending(SignOut)
      // A second click while the first is out sends nothing.
      s.send(PresenterMessage.ClickedSignOut())
      expect(s.pending).toHaveLength(1)
      s.resolve(SignOut, PresenterMessage.CompletedSignOut())
      expect(s.model.screen._tag).toBe("SigningIn")
      expect(connected(s)).toBe(false)
    }).pipe(Effect.scoped))
})
