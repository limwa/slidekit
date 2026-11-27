import * as Cloudflare from "@alchemy.run/cloudflare"
import { Effect, Option, Schema } from "effect"
import { ClientWire, type Position, type Role, ServerWire } from "./protocol.ts"

interface Attachment {
  readonly role: Role | null
}

const POSITION_KEY = "position"
const START: Position = { slide: 0, step: 0 }

const decodeClient = Schema.decodeUnknownOption(ClientWire)
const encodeServer = Schema.encodeSync(ServerWire)

export default class Room extends Cloudflare.DurableObject<Room>()(
  "Room",
  Effect.gen(function*() {
    const state = yield* Cloudflare.DurableObjectState
    return Effect.gen(function*() {
      const roleOf = (socket: Cloudflare.WebSocket) => socket.deserializeAttachment<Attachment>()?.role ?? null

      // A closing socket can still be listed by getWebSockets, so the close handler names it.
      const broadcast = (closing?: Cloudflare.WebSocket) =>
        Effect.gen(function*() {
          const position = (yield* state.storage.get<Position>(POSITION_KEY)) ?? START
          const sockets = (yield* state.getWebSockets()).filter((socket) => socket.ws !== closing?.ws)
          const roles = sockets.map(roleOf)
          const message = encodeServer({
            _tag: "State",
            position,
            presenterLive: roles.includes("presenter"),
            viewers: roles.filter((role) => role === "viewer").length
          })
          for (const socket of sockets) {
            if (roleOf(socket) !== null) yield* socket.send(message)
          }
        })

      return {
        fetch: Effect.gen(function*() {
          const [response, socket] = yield* Cloudflare.upgrade()
          socket.serializeAttachment<Attachment>({ role: null })
          return response
        }),
        webSocketMessage: Effect.fn(function*(socket: Cloudflare.WebSocket, data: string | ArrayBuffer) {
          const text = typeof data === "string" ? data : new TextDecoder().decode(data)
          const message = decodeClient(text)
          if (Option.isNone(message)) return
          switch (message.value._tag) {
            case "Hello":
              socket.serializeAttachment<Attachment>({ role: message.value.role })
              return yield* broadcast()
            case "Goto":
              if (roleOf(socket) !== "presenter") return
              yield* state.storage.put(POSITION_KEY, message.value.position)
              return yield* broadcast()
          }
        }),
        webSocketClose: Effect.fn(function*(socket: Cloudflare.WebSocket, code: number, reason: string) {
          yield* broadcast(socket)
          // Recent compatibility dates answer the close themselves, and then close() throws.
          const closed = yield* Effect.exit(socket.close(code, reason))
          if (closed._tag === "Failure") yield* Effect.logDebug("close already answered", closed.cause)
        })
      }
    })
  })
) {}
