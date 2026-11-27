import * as Cloudflare from "@alchemy.run/cloudflare"
import { WorkerEnvironment } from "alchemy/Workers/WorkerEnvironment"
import { Clock, Effect, Schema } from "effect"
import type { Position } from "../Position.ts"
import { type Role, ServerWire } from "../protocol.ts"
import * as RoomState from "../room/RoomState.ts"

/** The env binding that holds the build id the Worker was deployed with. */
export const buildIdBinding = "SLIDEKIT_BUILD_ID"

interface Attachment {
  readonly id: string
  readonly role: Role | null
}

const positionKey = "position"
const graceKey = "graceUntil"
const start: Position = { slide: 0, step: 0 }

const encodeServer = Schema.encodeSync(ServerWire)

const attachmentOf = (socket: Cloudflare.WebSocket): Attachment | null => socket.deserializeAttachment<Attachment>()

/**
 * The room Durable Object. It rebuilds a `RoomState.Room` from its sockets' attachments and its storage on every
 * event, steps it, and performs what changed: storage, the grace alarm, attachments and the broadcast.
 */
export default class Room extends Cloudflare.DurableObject<Room>()(
  "Room",
  Effect.gen(function*() {
    const state = yield* Cloudflare.DurableObjectState
    const env = yield* WorkerEnvironment
    return Effect.gen(function*() {
      const buildId = String(env[buildIdBinding] ?? "")

      const handle = (event: RoomState.Event, socket?: Cloudflare.WebSocket) =>
        Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          const sockets = yield* state.getWebSockets()
          const roles = new Map<string, Role>()
          // The event's socket counts even when a closing socket has already left `getWebSockets`.
          for (const attachment of [...sockets.map(attachmentOf), socket && attachmentOf(socket)]) {
            if (attachment?.role) roles.set(attachment.id, attachment.role)
          }
          const room: RoomState.Room = {
            buildId,
            position: (yield* state.storage.get<Position>(positionKey)) ?? start,
            sockets: roles,
            graceUntil: (yield* state.storage.get<number>(graceKey)) ?? null
          }

          const { room: next, broadcast } = RoomState.step(room, event, now)

          if (next.position !== room.position) yield* state.storage.put(positionKey, next.position)
          if (next.graceUntil !== room.graceUntil) {
            if (next.graceUntil === null) {
              yield* state.storage.delete(graceKey)
              yield* state.storage.deleteAlarm()
            } else {
              yield* state.storage.put(graceKey, next.graceUntil)
              yield* state.storage.setAlarm(next.graceUntil)
            }
          }
          const own = socket && attachmentOf(socket)
          if (own) {
            const role = next.sockets.get(own.id) ?? null
            if (role !== own.role) socket!.serializeAttachment<Attachment>({ id: own.id, role })
          }
          if (broadcast) {
            const message = encodeServer(RoomState.state(next))
            for (const peer of sockets) {
              const attachment = attachmentOf(peer)
              if (attachment && next.sockets.has(attachment.id)) yield* peer.send(message)
            }
          }
        })

      const closed = (socket: Cloudflare.WebSocket) => {
        const attachment = attachmentOf(socket)
        return attachment ? handle(RoomState.Event.Closed({ socket: attachment.id }), socket) : Effect.void
      }

      return {
        fetch: Effect.gen(function*() {
          const [response, socket] = yield* Cloudflare.upgrade()
          socket.serializeAttachment<Attachment>({ id: crypto.randomUUID(), role: null })
          return response
        }),
        webSocketMessage: Effect.fn(function*(socket: Cloudflare.WebSocket, data: string | ArrayBuffer) {
          const attachment = attachmentOf(socket)
          if (attachment === null) return
          const text = typeof data === "string" ? data : new TextDecoder().decode(data)
          yield* handle(RoomState.Event.Received({ socket: attachment.id, data: text }), socket)
        }),
        webSocketClose: Effect.fn(function*(socket: Cloudflare.WebSocket, code: number, reason: string) {
          yield* closed(socket)
          // Recent compatibility dates answer the close themselves, and then close() throws.
          const answered = yield* Effect.exit(socket.close(code, reason))
          if (answered._tag === "Failure") yield* Effect.logDebug("close already answered", answered.cause)
        }),
        webSocketError: (socket: Cloudflare.WebSocket) => closed(socket),
        alarm: () => handle(RoomState.Event.AlarmFired())
      }
    })
  })
) {}
