import { Component, Router } from "@effect/ui"
import { Story } from "@effect/ui/testing"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Deck from "../Deck.ts"
import * as Position from "../Position.ts"
import type { State } from "../protocol.ts"
import * as Slide from "../Slide.ts"
import { routeOf, ViewerRoute } from "./routes.ts"
import { Reload } from "./SyncClient.ts"
import { Viewer, ViewerMessage } from "./Viewer.ts"

const deck = Deck.make({
  title: "Test",
  slides: [Slide.make({ steps: 2, view: (h) => h.div }), Slide.make({ view: (h) => h.div }), Slide.make({ view: (h) => h.div })]
})
const at = Position.make

const state = (position: Position.Position, presenterLive = true, buildId = "build-1"): State => ({
  _tag: "State",
  position,
  presenterLive,
  viewers: 1,
  buildId
})

const start = (position = at(0, 0)) => Story.make(Viewer(deck), { route: routeOf(position), host: "deck.test", buildId: "build-1" })

type Steps = Effect.Success<ReturnType<typeof start>>

/** The Router moves to `position`, and its change comes back through the router subscription as it does in the browser. */
const routed = (s: Steps, position: Position.Position) => {
  const replace = Router.replace(ViewerRoute, routeOf(position))
  return s.expectExact(replace).resolve(replace, "navigated").subscription(
    "@effect/ui/Router",
    ViewerMessage.ChangedRoute({ route: routeOf(position) })
  )
}
const received = (s: Steps, value: State) => s.subscription("room", ViewerMessage.ReceivedState({ state: value }))
const shown = (s: Steps) => Position.parse(deck, s.model.route.params["*"])

describe("Viewer sync", () => {
  it.effect("moves freely until a presenter is live, then follows it", () =>
    Effect.gen(function*() {
      const s = yield* start()
      s.send(ViewerMessage.RequestedNext())
      routed(s, at(0, 1))
      expect(s.model.mode._tag).toBe("Free")

      received(s, state(at(2, 0)))
      expect(s.model.mode._tag).toBe("Following")
      routed(s, at(2, 0))
      expect(s.model.mode._tag).toBe("Following")
      expect(shown(s)).toEqual(at(2, 0))

      received(s, state(at(1, 0)))
      routed(s, at(1, 0))
      expect(s.model.mode._tag).toBe("Following")
    }).pipe(Effect.scoped))

  it.effect("keeps following when States arrive faster than the route changes", () =>
    Effect.gen(function*() {
      const s = yield* start()
      received(s, state(at(0, 1)))
      const first = Router.replace(ViewerRoute, routeOf(at(0, 1)))
      s.expectExact(first).resolve(first, "navigated")
      received(s, state(at(1, 0)))
      const second = Router.replace(ViewerRoute, routeOf(at(1, 0)))
      s.expectExact(second).keepPending(second)
      // The first follow's route change arrives after the second State.
      s.subscription("@effect/ui/Router", ViewerMessage.ChangedRoute({ route: routeOf(at(0, 1)) }))
      expect(s.model.mode._tag).toBe("Following")
      s.resolve(second, "navigated").subscription("@effect/ui/Router", ViewerMessage.ChangedRoute({ route: routeOf(at(1, 0)) }))
      expect(s.model.mode._tag).toBe("Following")
      expect(shown(s)).toEqual(at(1, 0))
    }).pipe(Effect.scoped))

  it.effect("detaches on navigation and stops following", () =>
    Effect.gen(function*() {
      const s = yield* start()
      received(s, state(at(1, 0)))
      routed(s, at(1, 0))

      s.send(ViewerMessage.RequestedPrevious())
      expect(s.model.mode._tag).toBe("Detached")
      routed(s, at(0, 1))

      received(s, state(at(2, 0)))
      s.expectNone()
      expect(s.model.mode._tag).toBe("Detached")
      expect(shown(s)).toEqual(at(0, 1))
    }).pipe(Effect.scoped))

  it.effect("goes back to live at the presenter's position", () =>
    Effect.gen(function*() {
      const s = yield* start()
      received(s, state(at(1, 0)))
      routed(s, at(1, 0))
      s.send(ViewerMessage.ClickedDot({ slide: 0 }))
      routed(s, at(0, 0))
      received(s, state(at(2, 0)))
      expect(s.model.mode._tag).toBe("Detached")

      s.send(ViewerMessage.ClickedBackToLive())
      expect(s.model.mode._tag).toBe("Following")
      routed(s, at(2, 0))
      expect(s.model.mode._tag).toBe("Following")
      expect(shown(s)).toEqual(at(2, 0))
    }).pipe(Effect.scoped))

  it.effect("stays put and moves freely when the presenter stops being live", () =>
    Effect.gen(function*() {
      for (const detach of [false, true]) {
        const s = yield* start()
        received(s, state(at(1, 0)))
        routed(s, at(1, 0))
        if (detach) {
          s.send(ViewerMessage.RequestedNext())
          routed(s, at(2, 0))
        }
        const before = shown(s)

        received(s, state(at(0, 0), false))
        s.expectNone()
        expect(s.model.mode._tag).toBe("Free")
        expect(shown(s)).toEqual(before)

        s.send(ViewerMessage.RequestedPrevious())
        routed(s, Position.previous(deck, before))
        expect(s.model.mode._tag).toBe("Free")
      }
    }).pipe(Effect.scoped))

  it.effect("reloads when the room runs another build", () =>
    Effect.gen(function*() {
      const s = yield* start(at(1, 0))
      received(s, state(at(2, 0), true, "build-2"))
      s.expectExact(Reload.make({})).resolve(Reload, Component.noop)
      expect(shown(s)).toEqual(at(1, 0))
    }).pipe(Effect.scoped))
})
