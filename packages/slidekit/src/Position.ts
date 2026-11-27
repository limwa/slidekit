import type { Deck } from "./Deck.ts"

export interface Position {
  readonly slide: number
  readonly step: number
}

export const make = (slide: number, step: number): Position => ({ slide, step })

const within = (n: number, max: number): number =>
  Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 0), max) : 0

const stepsOf = (deck: Deck, slide: number): number => deck.slides[slide]!.steps

export const first = (_deck: Deck): Position => make(0, 0)

export const last = (deck: Deck): Position => {
  const slide = deck.slides.length - 1
  return make(slide, stepsOf(deck, slide) - 1)
}

export const clamp = (deck: Deck, position: Position): Position => {
  const slide = within(position.slide, deck.slides.length - 1)
  return make(slide, within(position.step, stepsOf(deck, slide) - 1))
}

export const isFirst = (deck: Deck, position: Position): boolean => equals(clamp(deck, position), first(deck))

export const isLast = (deck: Deck, position: Position): boolean => equals(clamp(deck, position), last(deck))

export const equals = (a: Position, b: Position): boolean => a.slide === b.slide && a.step === b.step

export const next = (deck: Deck, position: Position): Position => {
  const { slide, step } = clamp(deck, position)
  if (step + 1 < stepsOf(deck, slide)) return make(slide, step + 1)
  if (slide + 1 < deck.slides.length) return make(slide + 1, 0)
  return make(slide, step)
}

export const previous = (deck: Deck, position: Position): Position => {
  const { slide, step } = clamp(deck, position)
  if (step > 0) return make(slide, step - 1)
  if (slide > 0) return make(slide - 1, stepsOf(deck, slide - 1) - 1)
  return make(slide, step)
}

/** The route path of a position, 1-based: `{ slide: 2, step: 1 }` prints as `"3/2"`, shown as `/#/3/2`. */
export const print = (position: Position): string => `${position.slide + 1}/${position.step + 1}`

/**
 * Reads a route path such as `"3/2"`, `"/3/2"` or `"#/3/2"` and clamps it to the deck. A missing step is
 * step 1, and a path that isn't one or two positive integers is the first position.
 */
export const parse = (deck: Deck, path: string): Position => {
  const match = /^#?\/?(\d+)(?:\/(\d+))?\/?$/.exec(path)
  if (match === null) return first(deck)
  return clamp(deck, make(Number(match[1]) - 1, Number(match[2] ?? "1") - 1))
}

/** Each step of the deck in order, counted from 0: the index of the first step is 0 and of the last is `total - 1`. */
export const index = (deck: Deck, position: Position): number => {
  const { slide, step } = clamp(deck, position)
  let count = step
  for (let i = 0; i < slide; i++) count += stepsOf(deck, i)
  return count
}

export const total = (deck: Deck): number => deck.slides.reduce((sum, slide) => sum + slide.steps, 0)
