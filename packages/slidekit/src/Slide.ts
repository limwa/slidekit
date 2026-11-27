import type { View as UiView } from "@effect/ui"
import type { Html } from "@effect/ui/html"

export interface Context {
  readonly step: number
}

/** A slide is a pure view of its step. It is generic in the message type, so it can render but never send one. */
export type View = <M>(h: Html.H<M>, context: Context) => UiView.Input<M>

export interface Slide {
  readonly steps: number
  readonly notes: string
  readonly view: View
}

export const make = (options: {
  readonly steps?: number
  readonly notes?: string
  readonly view: View
}): Slide => {
  const steps = options.steps ?? 1
  if (!Number.isInteger(steps) || steps < 1) {
    throw new RangeError(`Slide.make: steps must be an integer >= 1, got ${steps}`)
  }
  return { steps, notes: options.notes ?? "", view: options.view }
}
