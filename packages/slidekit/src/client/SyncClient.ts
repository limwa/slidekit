import { Command } from "@effect/ui"
import { Context, Effect, Layer, Option, Queue, Schedule, Schema, Stream, SubscriptionRef } from "effect"
import * as Socket from "effect/socket/Socket"
import type * as Position from "../Position.ts"
import { ClientWire, Position as PositionSchema, type Role, ServerWire, type State } from "../protocol.ts"

const encodeClient = Schema.encodeSync(ClientWire)
const decodeServer = Schema.decodeUnknownOption(ServerWire)

/** The client's socket to the room. It says Hello on every connect and reconnects every second. */
export class SyncClient extends Context.Service<SyncClient, {
  readonly states: Stream.Stream<State>
  readonly goto: (position: Position.Position) => Effect.Effect<void>
}>()("slidekit/SyncClient") {
  static readonly layer = (options: { readonly role: Role; readonly buildId: string }) =>
    Layer.effect(SyncClient, make(options)).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal))
}

const make = ({ buildId, role }: { readonly role: Role; readonly buildId: string }) =>
  Effect.gen(function*() {
    const latest = yield* SubscriptionRef.make<State | null>(null)
    // Only the newest Goto matters, so older ones are dropped while offline.
    const outbox = yield* Queue.sliding<string>(1)
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`

    const session = Effect.gen(function*() {
      const socket = yield* Socket.makeWebSocket(url)
      const { write } = yield* socket.writer
      const pull = yield* Socket.readerString(socket)
      yield* write(encodeClient({ _tag: "Hello", role, buildId }))
      yield* Queue.take(outbox).pipe(Effect.flatMap(write), Effect.forever, Effect.forkScoped)
      yield* pull.pipe(
        Effect.flatMap((frames) =>
          Effect.forEach(frames, (frame) =>
            Option.match(decodeServer(frame), {
              onNone: () => Effect.void,
              onSome: (state) => SubscriptionRef.set(latest, state)
            }))
        ),
        Effect.forever
      )
    }).pipe(Effect.scoped)

    yield* session.pipe(Effect.retry(Schedule.spaced("1 second")), Effect.forkScoped)

    return {
      states: SubscriptionRef.changes(latest).pipe(Stream.filter((state): state is State => state !== null)),
      goto: (position: Position.Position) =>
        Queue.offer(outbox, encodeClient({ _tag: "Goto", position })).pipe(Effect.asVoid)
    }
  })

/** Asks the room to move every follower to `position`. Only a presenter's Goto counts. */
export class SendGoto extends Command.Service<SendGoto>()("slidekit/SendGoto", { args: { position: PositionSchema } }) {
  static readonly layer = this.toLayer(
    Effect.gen(function*() {
      const sync = yield* SyncClient
      return ({ position }) => sync.goto(position)
    })
  )
}

/** Reloads the page, to pick up the bundle the room was built with. The hash keeps the position. */
export class Reload extends Command.Service<Reload>()("slidekit/Reload", { args: {} }) {
  static readonly layer = this.toLayer(Effect.succeed(() => Effect.sync(() => location.reload())))
}
