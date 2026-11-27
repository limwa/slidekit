import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { ClientWire, type ClientMessage, type Role } from "../protocol.ts"
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

/** A socket the Worker opened with `role`, and the events it can cause. */
const socket = (id: string, role: Role) => {
  const raw = (data: string) => Event.Received({ socket: id, role, data })
  const send = (message: ClientMessage) => raw(encode(message))
  return {
    raw,
    hello: send({ _tag: "Hello", buildId: "b1" }),
    goto: (slide: number, step = 0) => send({ _tag: "Goto", position: { slide, step } }),
    close: Event.Closed({ socket: id })
  }
}
const presenter = (id: string) => socket(id, "presenter")
const viewer = (id: string) => socket(id, "viewer")

describe("RoomState", () => {
  it("lets only presenter sockets move the position", () => {
    const p = presenter("p")
    const v = viewer("v")
    const { room, broadcasts } = run(
      empty,
      [0, p.hello],
      [0, v.hello],
      [1, v.goto(4)],
      [2, p.goto(2, 1)],
      [3, presenter("stranger").goto(5)]
    )
    expect(state(room).position).toEqual({ slide: 2, step: 1 })
    expect(broadcasts).toEqual([true, true, false, true, false])
  })

  it("takes the role the Worker granted, not the one a Hello claims", () => {
    const v = viewer("v")
    const claim = JSON.stringify({ _tag: "Hello", role: "presenter", buildId: "b1" })
    const { room, broadcasts } = run(empty, [0, v.raw(claim)], [1, v.goto(3)])
    expect(broadcasts).toEqual([true, false])
    expect(state(room)).toMatchObject({ position: { slide: 0, step: 0 }, presenterLive: false, viewers: 1 })

    const p = presenter("p")
    const moved = run(room, [2, p.raw(JSON.stringify({ _tag: "Hello", role: "viewer", buildId: "b1" }))], [3, p.goto(3)])
    expect(state(moved.room)).toMatchObject({ position: { slide: 3, step: 0 }, presenterLive: true, viewers: 1 })
  })

  it("counts viewers, once per socket", () => {
    const b = viewer("b")
    const { room } = run(empty, [0, viewer("a").hello], [0, b.hello], [0, b.hello], [0, presenter("p").hello])
    expect(state(room).viewers).toBe(2)
    expect(state(run(room, [1, viewer("a").close]).room).viewers).toBe(1)
  })

  it("is not live until a presenter says hello", () => {
    const room = run(empty, [0, viewer("v").hello]).room
    expect(state(room).presenterLive).toBe(false)
    expect(state(run(room, [1, presenter("p").hello]).room).presenterLive).toBe(true)
  })

  it("stays live through the grace after the last presenter closes", () => {
    const p1 = presenter("p1")
    const p2 = presenter("p2")
    const { room } = run(empty, [0, p1.hello], [0, p2.hello], [5, p1.close])
    expect(room.graceUntil).toBeNull()

    const closed = run(room, [7, p2.close])
    expect(closed.broadcasts).toEqual([true])
    expect(closed.room.graceUntil).toBe(7 + gracePeriod)
    expect(state(closed.room).presenterLive).toBe(true)
  })

  it("ends live when the alarm fires after the grace", () => {
    const p = presenter("p")
    const { room, broadcasts } = run(
      empty,
      [0, p.hello],
      [0, viewer("v").hello],
      [1, p.close],
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
    const p = presenter("p")
    const { room } = run(empty, [0, p.hello], [1, p.close], [4, presenter("p-again").hello])
    expect(room.graceUntil).toBeNull()
    expect(state(room).presenterLive).toBe(true)

    const stale = step(room, Event.AlarmFired(), 1 + gracePeriod)
    expect(stale.broadcast).toBe(false)
    expect(state(stale.room).presenterLive).toBe(true)
  })

  it("keeps the position after the presenter leaves", () => {
    const p = presenter("p")
    const { room } = run(empty, [0, p.hello], [0, p.goto(3)], [1, p.close], [2, Event.AlarmFired()])
    expect(state(room).position).toEqual({ slide: 3, step: 0 })
  })

  it("drops what fails to decode", () => {
    const p = presenter("p")
    const { room } = run(empty, [0, p.hello])
    for (
      const data of [
        "garbage",
        "{}",
        JSON.stringify({ _tag: "Goto" }),
        JSON.stringify({ _tag: "Goto", position: { slide: "1", step: 0 } }),
        JSON.stringify({ _tag: "Goto", position: { slide: 1.5, step: 0 } }),
        JSON.stringify({ _tag: "Hello" }),
        JSON.stringify({ _tag: "State", position: { slide: 1, step: 0 }, presenterLive: true, viewers: 0, buildId: "b1" })
      ]
    ) {
      const next = step(room, p.raw(data), 1)
      expect(next.broadcast).toBe(false)
      expect(next.room).toBe(room)
    }
  })

  it("ignores a close from a socket that never said hello", () => {
    const { room } = run(empty, [0, presenter("p").hello])
    expect(step(room, viewer("anonymous").close, 1)).toEqual({ room, broadcast: false })
  })
})
