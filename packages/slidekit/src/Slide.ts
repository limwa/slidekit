import type { View } from "@effect/ui"
import type { Html } from "@effect/ui/html"

export interface Context {
  readonly step: number
}

export type View = (h: Html.H<never>, context: Context) => View.Input<never>

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
