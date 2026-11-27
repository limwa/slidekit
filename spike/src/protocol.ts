import { Schema } from "effect"

export const Role = Schema.Literals(["presenter", "viewer"])
export type Role = typeof Role.Type

export const Position = Schema.Struct({
  slide: Schema.Int,
  step: Schema.Int
})
export type Position = typeof Position.Type

export const ClientMessage = Schema.TaggedUnion({
  Hello: { role: Role },
  Goto: { position: Position }
})
export type ClientMessage = typeof ClientMessage.Type

export const ServerMessage = Schema.TaggedUnion({
  State: {
    position: Position,
    presenterLive: Schema.Boolean,
    viewers: Schema.Int
  }
})
export type ServerMessage = typeof ServerMessage.Type

export const ClientWire = Schema.fromJsonString(ClientMessage)
export const ServerWire = Schema.fromJsonString(ServerMessage)
