import { Data, Option, Schema } from "effect"
import type { Position } from "../Position.ts"
import { ClientWire, type Role, type State } from "../protocol.ts"

/** How long the presenter stays live after its last socket closes. */
export const gracePeriod = 10_000

/** What the room knows between events. The Durable Object rebuilds it from its sockets and storage on every event. */
export interface Room {
  readonly buildId: string
  readonly position: Position
  /** The sockets that said Hello, by the id in their attachment, with the role the Worker granted each. */
  readonly sockets: ReadonlyMap<string, Role>
  /** When the grace ends. Set only while no presenter socket is connected and the presenter is still live. */
  readonly graceUntil: number | null
}

export type Event = Data.TaggedEnum<{
  /** `role` is what the Worker granted the socket when it opened, never what the socket says. */
  Received: { readonly socket: string; readonly role: Role; readonly data: string }
  Closed: { readonly socket: string }
  AlarmFired: {}
}>
export const Event = Data.taggedEnum<Event>()

export interface Transition {
  readonly room: Room
  /** Whether every socket in `room.sockets` gets `state(room)`. */
  readonly broadcast: boolean
}

const decode = Schema.decodeUnknownOption(ClientWire)

const has = (room: Room, role: Role): boolean => [...room.sockets.values()].includes(role)

export const isLive = (room: Room): boolean => has(room, "presenter") || room.graceUntil !== null

export const state = (room: Room): State => ({
  _tag: "State",
  position: room.position,
  presenterLive: isLive(room),
  viewers: [...room.sockets.values()].filter((role) => role === "viewer").length,
  buildId: room.buildId
})

const unchanged = (room: Room): Transition => ({ room, broadcast: false })

const changed = (room: Room): Transition => ({ room, broadcast: true })

const withSocket = (room: Room, socket: string, role: Role | undefined): ReadonlyMap<string, Role> => {
  const sockets = new Map(room.sockets)
  if (role === undefined) sockets.delete(socket)
  else sockets.set(socket, role)
  return sockets
}

/** The room after `event` at time `now`. Only presenter sockets move the position, and undecodable messages change nothing. */
export const step = (room: Room, event: Event, now: number): Transition =>
  Event.$match(event, {
    Received: ({ socket, role, data }) =>
      Option.match(decode(data), {
        onNone: () => unchanged(room),
        onSome: (message) => {
          switch (message._tag) {
            case "Hello":
              return changed({
                ...room,
                sockets: withSocket(room, socket, role),
                graceUntil: role === "presenter" ? null : room.graceUntil
              })
            case "Goto":
              return room.sockets.get(socket) === "presenter"
                ? changed({ ...room, position: message.position })
                : unchanged(room)
          }
        }
      }),
    Closed: ({ socket }) => {
      const role = room.sockets.get(socket)
      if (role === undefined) return unchanged(room)
      const next = { ...room, sockets: withSocket(room, socket, undefined) }
      const lastPresenter = role === "presenter" && !has(next, "presenter")
      return changed(lastPresenter ? { ...next, graceUntil: now + gracePeriod } : next)
    },
    AlarmFired: () => room.graceUntil === null ? unchanged(room) : changed({ ...room, graceUntil: null })
  })
