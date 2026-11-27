import { Context, Effect, Layer, Option, Queue, Schedule, Schema, Stream, SubscriptionRef } from "effect"
import * as Socket from "effect/socket/Socket"
import { ClientWire, type Position, type Role, type ServerMessage, ServerWire } from "../protocol.ts"

type State = Extract<ServerMessage, { _tag: "State" }>

const encodeClient = Schema.encodeSync(ClientWire)
const decodeServer = Schema.decodeUnknownOption(ServerWire)

export class SyncClient extends Context.Service<SyncClient, {
  readonly states: Stream.Stream<State>
  readonly goto: (position: Position) => Effect.Effect<void>
}>()("slidekit/SyncClient") {
  static readonly layer = (role: Role) =>
    Layer.effect(SyncClient, make(role)).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal))
}

const make = (role: Role) =>
  Effect.gen(function*() {
    const latest = yield* SubscriptionRef.make<State | null>(null)
    // Only the newest Goto matters, so older ones are dropped while offline.
    const outbox = yield* Queue.sliding<string>(1)
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`

    const session = Effect.gen(function*() {
      const socket = yield* Socket.makeWebSocket(url)
      const { write } = yield* socket.writer
      const pull = yield* Socket.readerString(socket)
      yield* write(encodeClient({ _tag: "Hello", role }))
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
      goto: (position: Position) => Queue.offer(outbox, encodeClient({ _tag: "Goto", position })).pipe(Effect.asVoid)
    }
  })
