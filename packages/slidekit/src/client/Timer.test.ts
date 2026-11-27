import { HtmlLocator, HtmlPlay } from "@effect/ui/html/testing"
import { TestHost } from "@effect/ui/testing"
import { describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { Timer } from "./Timer.ts"

const timer = HtmlLocator.role("timer")

describe("Timer", () => {
  it.effect("counts the time since it first showed, and starts over on reset", () =>
    Effect.gen(function*() {
      const play = yield* HtmlPlay.make(Timer, {})
      yield* play.expect(timer).toHaveText("00:00")
      yield* TestClock.adjust("65 seconds")
      yield* play.expect(timer).toHaveText("01:05")
      yield* TestClock.adjust("2 hours")
      yield* play.expect(timer).toHaveText("121:05")

      yield* play.click(HtmlLocator.role("button", { name: "Reset" }))
      yield* play.expect(timer).toHaveText("00:00")
      yield* TestClock.adjust("3 seconds")
      yield* play.expect(timer).toHaveText("00:03")
    }).pipe(Effect.scoped, Effect.provide(TestHost.layer())))
})
