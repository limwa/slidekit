import * as Cloudflare from "@alchemy.run/cloudflare"
import { WorkerEnvironment } from "alchemy/Workers/WorkerEnvironment"
import { Clock, Effect, Schema } from "effect"
import { HttpServerRequest } from "effect/http/HttpServerRequest"
import * as Attempts from "../auth/Attempts.ts"
import type { Position } from "../Position.ts"
import { type Role, ServerWire } from "../protocol.ts"
import * as RoomState from "../room/RoomState.ts"

/** The env binding that holds the build id the Worker was deployed with. */
export const buildIdBinding = "SLIDEKIT_BUILD_ID"

/** The header in which the Worker tells the room the role it granted a socket. The Worker drops any copy a client sends. */
export const roleHeader = "x-slidekit-role"

/** What a socket carries through hibernation: its id, the role the Worker granted it, and whether it said Hello. */
interface Attachment {
  readonly id: string
  readonly role: Role
  readonly joined: boolean
}

const positionKey = "position"
const graceKey = "graceUntil"
const attemptsKey = "loginAttempts"
const start: Position = { slide: 0, step: 0 }

const encodeServer = Schema.encodeSync(ServerWire)

const attachmentOf = (socket: Cloudflare.WebSocket): Attachment | null => socket.deserializeAttachment<Attachment>()

/**
 * The room Durable Object. It rebuilds a `RoomState.Room` from its sockets' attachments and its storage on every
 * event, steps it, and performs what changed: storage, the grace alarm, attachments and the broadcast. It also keeps
 * the deck's count of presenter logins, which the Worker checks before it checks a code.
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
            if (attachment?.joined) roles.set(attachment.id, attachment.role)
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
            const joined = next.sockets.has(own.id)
            if (joined !== own.joined) socket!.serializeAttachment<Attachment>({ ...own, joined })
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

      const attempts = (scope: string) =>
        state.storage.get<unknown>(attemptsKey).pipe(Effect.map((stored) => Attempts.within(stored, scope)))

      return {
        fetch: Effect.gen(function*() {
          const request = yield* HttpServerRequest
          const role: Role = request.headers[roleHeader] === "presenter" ? "presenter" : "viewer"
          const [response, socket] = yield* Cloudflare.upgrade()
          socket.serializeAttachment<Attachment>({ id: crypto.randomUUID(), role, joined: false })
          return response
        }),
        webSocketMessage: Effect.fn(function*(socket: Cloudflare.WebSocket, data: string | ArrayBuffer) {
          const attachment = attachmentOf(socket)
          if (attachment === null) return
          const text = typeof data === "string" ? data : new TextDecoder().decode(data)
          yield* handle(RoomState.Event.Received({ socket: attachment.id, role: attachment.role, data: text }), socket)
        }),
        webSocketClose: Effect.fn(function*(socket: Cloudflare.WebSocket, code: number, reason: string) {
          yield* closed(socket)
          // Recent compatibility dates answer the close themselves, and then close() throws.
          const answered = yield* Effect.exit(socket.close(code, reason))
          if (answered._tag === "Failure") yield* Effect.logDebug("close already answered", answered.cause)
        }),
        webSocketError: (socket: Cloudflare.WebSocket) => closed(socket),
        alarm: () => handle(RoomState.Event.AlarmFired()),
        /**
         * Begins a presenter login, counted within `scope` (see `Attempts.scope`). `at` names it to `succeededLogin`
         * once its code checks out.
         */
        beginLogin: (scope: string) =>
          Effect.gen(function*() {
            const now = yield* Clock.currentTimeMillis
            const begun = Attempts.begin(yield* attempts(scope), now)
            yield* state.storage.put(attemptsKey, begun.attempts)
            return { allowed: begun.allowed, at: now }
          }),
        succeededLogin: (scope: string, at: number) =>
          Effect.gen(function*() {
            yield* state.storage.put(attemptsKey, Attempts.succeeded(yield* attempts(scope), at))
          })
      }
    })
  })
) {}
