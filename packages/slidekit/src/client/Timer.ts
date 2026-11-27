import { Subscription, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Clock, Schedule, Schema, Stream } from "effect"

/** `startedAt` is `null` from a mount or a reset until the clock's first reading. */
export const TimerModel = Schema.Struct({ startedAt: Schema.NullOr(Schema.Number), now: Schema.Number })
export type TimerModel = typeof TimerModel.Type

export const TimerMessage = UiSchema.TaggedEnum({
  Ticked: { now: Schema.Number },
  ClickedReset: {}
})

const pad = (n: number) => String(n).padStart(2, "0")

/** The time since the start as `mm:ss`. Minutes go past 59 rather than adding hours. */
export const format = (model: TimerModel): string => {
  const seconds = model.startedAt === null ? 0 : Math.max(0, Math.floor((model.now - model.startedAt) / 1000))
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
}

/**
 * The presenter's elapsed time, from when it first shows. It reads the clock rather than counting ticks, so a
 * throttled background tab still shows the right time when it comes back.
 */
export const Timer = Html.component({ name: "Timer", model: TimerModel, message: TimerMessage }).make({
  init: () => ({ startedAt: null, now: 0 }),

  update: {
    Ticked: ($, { now }) => $.evolve({ now, startedAt: (startedAt) => startedAt ?? now }),
    ClickedReset: ($) => $.evolve({ startedAt: null })
  },

  // Keyed on the start, so a reset restarts the clock and the seconds turn over in step with the new start.
  subscriptions: ({ model }) => [
    Subscription.make("clock", model.startedAt, () =>
      Stream.fromEffectSchedule(Clock.currentTimeMillis, Schedule.spaced("1 second")).pipe(
        Stream.map((now) => TimerMessage.Ticked({ now }))
      ))
  ],

  view: (h, model) =>
    h.div.class("flex items-center gap-2").children(
      h.span
        .class("font-mono text-2xl font-medium tabular-nums tracking-tight text-ink")
        .attr("role", "timer")
        .attr("aria-label", "Elapsed time")
        .children(format(model)),
      h.button
        .class(
          "rounded-full px-2.5 py-1 font-mono text-[11px] text-ink/60 uppercase tracking-wider ring-1 ring-line transition-colors hover:bg-line/60 hover:text-accent"
        )
        .attr("type", "button")
        .on("click", TimerMessage.ClickedReset())
        .children("Reset")
    )
})
