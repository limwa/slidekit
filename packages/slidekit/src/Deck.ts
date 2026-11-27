import type { NonEmptyReadonlyArray } from "effect/Array"
import type { Slide } from "./Slide.ts"

export interface AspectRatio {
  readonly width: number
  readonly height: number
}

export type Transition = "fade" | "none"

export interface Deck {
  readonly title: string
  readonly slides: NonEmptyReadonlyArray<Slide>
  readonly aspectRatio: AspectRatio
  readonly transition: Transition
}

export const make = (options: {
  readonly title: string
  readonly slides: NonEmptyReadonlyArray<Slide>
  readonly aspectRatio?: AspectRatio
  readonly transition?: Transition
}): Deck => {
  if (options.slides.length === 0) {
    throw new RangeError("Deck.make: a deck needs at least one slide")
  }
  const aspectRatio = options.aspectRatio ?? { width: 16, height: 9 }
  if (!(aspectRatio.width > 0 && aspectRatio.height > 0)) {
    throw new RangeError("Deck.make: aspectRatio needs a positive width and height")
  }
  return {
    title: options.title,
    slides: options.slides,
    aspectRatio,
    transition: options.transition ?? "fade"
  }
}

export const canvasWidth = 1920

export const canvasHeight = (deck: Deck): number =>
  Math.round(canvasWidth * deck.aspectRatio.height / deck.aspectRatio.width)
