import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { ClientWire, type ClientMessage } from "../protocol.ts"
import { Event, gracePeriod, type Room, state, step } from "./RoomState.ts"

const encode = Schema.encodeSync(ClientWire)

const empty: Room = { buildId: "b1", position: { slide: 0, step: 0 }, sockets: new Map(), graceUntil: null }

/** Runs events in order, each at its own time, and returns the room and whether each one broadcast. */
const run = (room: Room, ...events: ReadonlyArray<readonly [number, Event]>) =>
  events.reduce(
    (acc, [now, event]) => {
      const next = step(acc.room, event, now)
      return { room: next.room, broadcasts: [...acc.broadcasts, next.broadcast] }
    },
    { room, broadcasts: [] as Array<boolean> }
  )

const send = (socket: string, message: ClientMessage) => Event.Received({ socket, data: encode(message) })
const hello = (socket: string, role: "presenter" | "viewer") => send(socket, { _tag: "Hello", role, buildId: "b1" })
const goto = (socket: string, slide: number, step = 0) => send(socket, { _tag: "Goto", position: { slide, step } })
const close = (socket: string) => Event.Closed({ socket })

describe("RoomState", () => {
  it("lets only presenters move the position", () => {
    const { room, broadcasts } = run(
      empty,
      [0, hello("p", "presenter")],
      [0, hello("v", "viewer")],
      [1, goto("v", 4)],
      [2, goto("p", 2, 1)],
      [3, goto("stranger", 5)]
    )
    expect(state(room).position).toEqual({ slide: 2, step: 1 })
    expect(broadcasts).toEqual([true, true, false, true, false])
  })

  it("counts viewers, once per socket", () => {
    const { room } = run(
      empty,
      [0, hello("a", "viewer")],
      [0, hello("b", "viewer")],
      [0, hello("b", "viewer")],
      [0, hello("p", "presenter")]
    )
    expect(state(room).viewers).toBe(2)
    expect(state(run(room, [1, close("a")]).room).viewers).toBe(1)
  })

  it("is not live until a presenter says hello", () => {
    const viewer = run(empty, [0, hello("v", "viewer")]).room
    expect(state(viewer).presenterLive).toBe(false)
    expect(state(run(viewer, [1, hello("p", "presenter")]).room).presenterLive).toBe(true)
  })

  it("stays live through the grace after the last presenter closes", () => {
    const { room } = run(empty, [0, hello("p1", "presenter")], [0, hello("p2", "presenter")], [5, close("p1")])
    expect(room.graceUntil).toBeNull()

    const closed = run(room, [7, close("p2")])
    expect(closed.broadcasts).toEqual([true])
    expect(closed.room.graceUntil).toBe(7 + gracePeriod)
    expect(state(closed.room).presenterLive).toBe(true)
  })

  it("ends live when the alarm fires after the grace", () => {
    const { room, broadcasts } = run(
      empty,
      [0, hello("p", "presenter")],
      [0, hello("v", "viewer")],
      [1, close("p")],
      [1 + gracePeriod, Event.AlarmFired()]
    )
    expect(broadcasts.at(-1)).toBe(true)
    expect(room.graceUntil).toBeNull()
    expect(state(room)).toEqual({
      _tag: "State",
      position: { slide: 0, step: 0 },
      presenterLive: false,
      viewers: 1,
      buildId: "b1"
    })
  })

  it("cancels the grace when a presenter reconnects", () => {
    const { room } = run(empty, [0, hello("p", "presenter")], [1, close("p")], [4, hello("p-again", "presenter")])
    expect(room.graceUntil).toBeNull()
    expect(state(room).presenterLive).toBe(true)

    const stale = step(room, Event.AlarmFired(), 1 + gracePeriod)
    expect(stale.broadcast).toBe(false)
    expect(state(stale.room).presenterLive).toBe(true)
  })

  it("keeps the position after the presenter leaves", () => {
    const { room } = run(empty, [0, hello("p", "presenter")], [0, goto("p", 3)], [1, close("p")], [2, Event.AlarmFired()])
    expect(state(room).position).toEqual({ slide: 3, step: 0 })
  })

  it("drops what fails to decode", () => {
    const { room } = run(empty, [0, hello("p", "presenter")])
    for (
      const data of [
        "garbage",
        "{}",
        JSON.stringify({ _tag: "Goto" }),
        JSON.stringify({ _tag: "Goto", position: { slide: "1", step: 0 } }),
        JSON.stringify({ _tag: "Goto", position: { slide: 1.5, step: 0 } }),
        JSON.stringify({ _tag: "Hello", role: "admin", buildId: "b1" }),
        JSON.stringify({ _tag: "State", position: { slide: 1, step: 0 }, presenterLive: true, viewers: 0, buildId: "b1" })
      ]
    ) {
      const next = step(room, Event.Received({ socket: "p", data }), 1)
      expect(next.broadcast).toBe(false)
      expect(next.room).toBe(room)
    }
  })

  it("ignores a close from a socket that never said hello", () => {
    const { room } = run(empty, [0, hello("p", "presenter")])
    expect(step(room, close("anonymous"), 1)).toEqual({ room, broadcast: false })
  })
})
