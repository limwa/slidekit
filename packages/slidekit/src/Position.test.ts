import { describe, expect, it } from "@effect/vitest"
import * as Deck from "./Deck.ts"
import * as Position from "./Position.ts"
import * as Slide from "./Slide.ts"

const slide = (steps: number) => Slide.make({ steps, view: (h) => h.div })

const deck = Deck.make({ title: "Test", slides: [slide(1), slide(3), slide(2)] })

const at = Position.make

describe("Position", () => {
  it("walks every step forward and back", () => {
    const forward = [at(0, 0)]
    while (!Position.isLast(deck, forward.at(-1)!)) forward.push(Position.next(deck, forward.at(-1)!))
    expect(forward).toEqual([at(0, 0), at(1, 0), at(1, 1), at(1, 2), at(2, 0), at(2, 1)])
    expect(forward.map((position) => Position.index(deck, position))).toEqual([0, 1, 2, 3, 4, 5])
    expect(Position.total(deck)).toBe(6)

    const back = [Position.last(deck)]
    while (!Position.isFirst(deck, back.at(-1)!)) back.push(Position.previous(deck, back.at(-1)!))
    expect(back).toEqual(forward.toReversed())
  })

  it("stays put at either end", () => {
    expect(Position.next(deck, Position.last(deck))).toEqual(at(2, 1))
    expect(Position.previous(deck, Position.first(deck))).toEqual(at(0, 0))
  })

  it("clamps out-of-range positions", () => {
    expect(Position.clamp(deck, at(9, 9))).toEqual(at(2, 1))
    expect(Position.clamp(deck, at(-1, -1))).toEqual(at(0, 0))
    expect(Position.clamp(deck, at(1, 7))).toEqual(at(1, 2))
    expect(Position.clamp(deck, at(Number.NaN, 1.5))).toEqual(at(0, 0))
    expect(Position.next(deck, at(1, 99))).toEqual(at(2, 0))
  })

  it("prints 1-based route paths", () => {
    expect(Position.print(at(0, 0))).toBe("1/1")
    expect(Position.print(at(2, 1))).toBe("3/2")
  })

  it("parses route paths in every written form", () => {
    expect(Position.parse(deck, "3/2")).toEqual(at(2, 1))
    expect(Position.parse(deck, "/3/2")).toEqual(at(2, 1))
    expect(Position.parse(deck, "#/3/2")).toEqual(at(2, 1))
    expect(Position.parse(deck, "#/3/2/")).toEqual(at(2, 1))
    expect(Position.parse(deck, "2")).toEqual(at(1, 0))
  })

  it("round-trips every position", () => {
    for (let position = Position.first(deck);; position = Position.next(deck, position)) {
      expect(Position.parse(deck, Position.print(position))).toEqual(position)
      if (Position.isLast(deck, position)) break
    }
  })

  it("clamps or falls back on bad route paths", () => {
    expect(Position.parse(deck, "99/99")).toEqual(at(2, 1))
    expect(Position.parse(deck, "2/99")).toEqual(at(1, 2))
    expect(Position.parse(deck, "0/0")).toEqual(at(0, 0))
    for (const path of ["", "/", "#/", "abc", "1/x", "-1/2", "1.5/1", "1/2/3", "%20"]) {
      expect(Position.parse(deck, path)).toEqual(at(0, 0))
    }
  })
})

describe("Slide.make and Deck.make", () => {
  it("fill the defaults", () => {
    const one = Slide.make({ view: (h) => h.div })
    expect(one.steps).toBe(1)
    expect(one.notes).toBe("")
    const made = Deck.make({ title: "T", slides: [one] })
    expect(made.aspectRatio).toEqual({ width: 16, height: 9 })
    expect(made.transition).toBe("fade")
    expect(Deck.canvasHeight(made)).toBe(1080)
    expect(Deck.canvasHeight(Deck.make({ title: "T", slides: [one], aspectRatio: { width: 4, height: 3 } }))).toBe(1440)
  })

  it("reject bad arguments", () => {
    expect(() => Slide.make({ steps: 0, view: (h) => h.div })).toThrow(RangeError)
    expect(() => Slide.make({ steps: 1.5, view: (h) => h.div })).toThrow(RangeError)
    expect(() => Deck.make({ title: "T", slides: [] as never })).toThrow(RangeError)
  })
})
