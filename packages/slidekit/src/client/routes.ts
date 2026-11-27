import { Route } from "@effect/ui"
import * as Position from "../Position.ts"

/** Every hash is one route: its rest is a position's route path, which `Position.parse` reads or falls back on. */
export const ViewerRoute = Route.union({
  At: Route.make("/*")
})
export type ViewerRoute = typeof ViewerRoute.Type

export const routeOf = (position: Position.Position): ViewerRoute =>
  ViewerRoute.At({ params: { "*": Position.print(position) } })
