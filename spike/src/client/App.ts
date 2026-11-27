import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { Html, HtmlSubscription } from "@effect/ui/html"
import { Effect, Layer, Schema, Stream } from "effect"
import { Position, Role, ServerMessage } from "../protocol.ts"
import { SyncClient } from "./SyncClient.ts"

const SLIDES = [
  { title: "Slidekit spike", points: ["Effect UI renders this page", "Alchemy deployed it", "A Durable Object syncs it"] },
  { title: "One position", points: ["{ slide, step }", "is all that sync carries"] },
  { title: "End state", points: ["depends only on the position"] }
] as const

const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max)

const next = ({ slide, step }: Position): Position =>
  step + 1 < SLIDES[slide]!.points.length
    ? { slide, step: step + 1 }
    : { slide: clamp(slide + 1, SLIDES.length - 1), step: slide + 1 < SLIDES.length ? 0 : step }

const previous = ({ slide, step }: Position): Position =>
  step > 0
    ? { slide, step: step - 1 }
    : slide > 0
    ? { slide: slide - 1, step: SLIDES[slide - 1]!.points.length - 1 }
    : { slide, step }

const State = ServerMessage.cases.State

export const AppMessage = UiSchema.TaggedEnum({
  ReceivedState: { state: State },
  PressedNext: {},
  PressedPrevious: {}
})

class SendGoto extends Command.Service<SendGoto>()("spike/SendGoto", { args: { position: Position } }) {
  static readonly layer = this.toLayer(
    Effect.gen(function*() {
      const sync = yield* SyncClient
      return ({ position }) => sync.goto(position)
    })
  )
}

const AppNoDeps = Html.component({
  name: "App",
  props: Schema.Struct({ role: Role }),
  model: Schema.Struct({ state: Schema.NullOr(State) }),
  message: AppMessage
}).make({
  init: () => ({ state: null }),
  update: {
    ReceivedState: ($, { state }) => $.evolve({ state }),
    PressedNext: ($) => $.model.state ? $.run(SendGoto.make({ position: next($.model.state.position) })) : $.model,
    PressedPrevious: ($) =>
      $.model.state ? $.run(SendGoto.make({ position: previous($.model.state.position) })) : $.model
  },
  subscriptions: ({ props }) => [
    Subscription.make(
      "room",
      Stream.unwrap(SyncClient.use((sync) => Effect.succeed(sync.states))).pipe(
        Stream.map((state) => AppMessage.ReceivedState({ state }))
      )
    ),
    props.role === "presenter" && HtmlSubscription.shortcuts([
      { key: "ArrowRight", message: AppMessage.PressedNext() },
      { key: " ", message: AppMessage.PressedNext() },
      { key: "PageDown", message: AppMessage.PressedNext() },
      { key: "ArrowLeft", message: AppMessage.PressedPrevious() },
      { key: "PageUp", message: AppMessage.PressedPrevious() }
    ])
  ],
  view: (h, model) => {
    const presenter = h.props.role === "presenter"
    const state = model.state
    if (state === null) {
      return h.main.class("grid min-h-screen place-items-center bg-cream text-ink").children("Connecting…")
    }
    const { slide, step } = state.position
    const current = SLIDES[clamp(slide, SLIDES.length - 1)]!
    return h.main.class("flex min-h-screen flex-col bg-paper p-6 text-ink sm:p-10").children(
      h.section.class(
        "flex flex-1 flex-col justify-center rounded-sm border border-line bg-cream px-8 py-12 sm:px-24"
      ).children(
        h.p.class("font-mono text-sm tracking-widest text-accent uppercase").children(
          `Slide ${slide + 1} of ${SLIDES.length}`
        ),
        h.h1.class("mt-4 text-4xl font-semibold tracking-tight sm:text-6xl").children(current.title),
        h.ul.class("mt-10 space-y-4 text-xl sm:text-2xl").children(
          ...current.points.map((point, index) =>
            h.li.class(
              "transition duration-300",
              index <= step ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
            ).children(point)
          )
        )
      ),
      h.footer.class("mt-4 flex items-center justify-between font-mono text-sm").children(
        h.span.class("text-accent").children(presenter ? "presenter" : "viewer"),
        h.span.children(
          state.presenterLive ? "live" : "no presenter",
          ` · ${state.viewers} viewer${state.viewers === 1 ? "" : "s"}`
        ),
        presenter
          ? h.span.class("flex gap-3").children(
            h.button.class("px-2 hover:text-accent").on("click", AppMessage.PressedPrevious()).children("←"),
            h.span.children(`${slide + 1}/${SLIDES.length} ${step}/${current.points.length - 1}`),
            h.button.class("px-2 hover:text-accent").on("click", AppMessage.PressedNext()).children("→")
          )
          : h.span.children(`${slide + 1}/${SLIDES.length} ${step}/${current.points.length - 1}`)
      )
    )
  }
})

export const App = (role: Role) =>
  AppNoDeps.pipe(Component.provide(SendGoto.layer.pipe(Layer.provideMerge(SyncClient.layer(role)))))
