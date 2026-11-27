import { Schema } from "effect"

export const Role = Schema.Literals(["presenter", "viewer"])
export type Role = typeof Role.Type

export const Position = Schema.Struct({ slide: Schema.Int, step: Schema.Int })

export const ClientMessage = Schema.TaggedUnion({
  Hello: { role: Role, buildId: Schema.String },
  Goto: { position: Position }
})
export type ClientMessage = typeof ClientMessage.Type

export const ServerMessage = Schema.TaggedUnion({
  State: {
    position: Position,
    presenterLive: Schema.Boolean,
    viewers: Schema.Int,
    buildId: Schema.String
  }
})
export type ServerMessage = typeof ServerMessage.Type

export const State = ServerMessage.cases.State
export type State = typeof State.Type

export const ClientWire = Schema.fromJsonString(ClientMessage)
export const ServerWire = Schema.fromJsonString(ServerMessage)
