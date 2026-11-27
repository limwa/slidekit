import { Command, Head, Mount, Router, Subscription, UiSchema } from "@effect/ui"
import { Html, HtmlSubscription } from "@effect/ui/html"
import { Effect, Schema, Stream } from "effect"
import * as Deck from "../Deck.ts"
import * as Position from "../Position.ts"
import { Role, State } from "../protocol.ts"
import { FitCanvas, type SwipeDirection, TrackSwipe } from "./gestures.ts"
import { routeOf, ViewerRoute } from "./routes.ts"
import { Reload, SendGoto, SyncClient } from "./SyncClient.ts"

export const ViewerProps = Schema.Struct({ route: ViewerRoute, host: Schema.String, role: Role, buildId: Schema.String })

/**
 * How the client relates to the room. A viewer is `Free` with no live presenter, `Following` the presenter's
 * position while one is live, or `Detached` after navigating away from it. A presenter is always `Presenting`.
 */
export const Mode = Schema.TaggedUnion({ Free: {}, Following: {}, Detached: {}, Presenting: {} })
export type Mode = typeof Mode.Type

const free: Mode = { _tag: "Free" }
const following: Mode = { _tag: "Following" }
const detached: Mode = { _tag: "Detached" }
const presenting: Mode = { _tag: "Presenting" }

/** `live` is the room's last State, `null` until the first one arrives. */
export const ViewerModel = Schema.Struct({ route: ViewerRoute, mode: Mode, live: Schema.NullOr(State) })

export const ViewerMessage = UiSchema.TaggedEnum({
  ChangedRoute: { route: ViewerRoute },
  ReceivedState: { state: State },
  RequestedNext: {},
  RequestedPrevious: {},
  ClickedDot: { slide: Schema.Int },
  ClickedBackToLive: {},
  RequestedFullscreen: {}
})
export type ViewerMessage = typeof ViewerMessage.Type

const ToggleFullscreen = Command.make("ToggleFullscreen", {}, () =>
  Effect.promise(() =>
    (document.fullscreenElement === null
      ? document.documentElement.requestFullscreen()
      : document.exitFullscreen()).catch(() => undefined)
  ))

const swiped = (direction: SwipeDirection): ViewerMessage =>
  direction === "next" ? ViewerMessage.RequestedNext() : ViewerMessage.RequestedPrevious()

const button = "grid size-7 place-items-center rounded-frame transition-colors hover:bg-line/60 hover:text-accent disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-current"

/** The viewer for one deck: the scaled canvas, the chrome and the input. The route in the URL hash is the position. */
export const Viewer = (deck: Deck.Deck) => {
  const width = Deck.canvasWidth
  const height = Deck.canvasHeight(deck)
  const total = Position.total(deck)
  const positionOf = (route: ViewerRoute) => Position.parse(deck, route.params["*"])
  const canonical = (route: ViewerRoute) => routeOf(positionOf(route))
  const isCanonical = (route: ViewerRoute) => ViewerRoute.print(route) === ViewerRoute.print(canonical(route))
  const goto = (position: Position.Position) => Router.replace(ViewerRoute, routeOf(position)).pipe(Command.asNoop)
  const fade = deck.transition === "fade" ? "transition-[opacity,visibility] duration-200 ease-out" : ""
  /** Navigating away from the live position detaches a follower. Only these inputs detach: a follow's own route change must not. */
  const modeAfterMove = (model: typeof ViewerModel.Type, target: Position.Position): Mode =>
    model.mode._tag === "Following" && !Position.equals(target, positionOf(model.route)) ? detached : model.mode

  return Html.component({
    name: "Viewer",
    props: ViewerProps,
    model: ViewerModel,
    message: ViewerMessage
  }).make({
    init: ($) => {
      const { role, route } = $.props
      const model = { route, mode: role === "presenter" ? presenting : free, live: null }
      return isCanonical(route) ? model : $.set(model).run(goto(positionOf(route)))
    },

    update: {
      ChangedRoute: ($, { route }) => {
        if (!isCanonical(route)) return $.evolve({ route }).run(goto(positionOf(route)))
        // A presenter that has joined the room moves it. Before the first State its moves are its own.
        return $.model.mode._tag === "Presenting" && $.model.live !== null
          ? $.evolve({ route }).run(SendGoto.make({ position: positionOf(route) }))
          : $.evolve({ route })
      },
      ReceivedState: ($, { state }) => {
        if (state.buildId !== $.props.buildId) return $.evolve({ live: state }).run(Reload.make({}))
        const target = Position.clamp(deck, state.position)
        const follow = (mode: Mode) =>
          Position.equals(target, positionOf($.model.route))
            ? $.evolve({ live: state, mode })
            : $.evolve({ live: state, mode }).run(goto(target))
        switch ($.model.mode._tag) {
          // A presenter takes the room's position once, when it joins, and moves on its own after that.
          case "Presenting":
            return $.model.live === null ? follow(presenting) : $.evolve({ live: state })
          case "Free":
          case "Following":
            return state.presenterLive ? follow(following) : $.evolve({ live: state, mode: free })
          case "Detached":
            return $.evolve({ live: state, mode: state.presenterLive ? detached : free })
        }
      },
      RequestedNext: ($) => {
        const target = Position.next(deck, positionOf($.model.route))
        return $.evolve({ mode: modeAfterMove($.model, target) }).run(goto(target))
      },
      RequestedPrevious: ($) => {
        const target = Position.previous(deck, positionOf($.model.route))
        return $.evolve({ mode: modeAfterMove($.model, target) }).run(goto(target))
      },
      ClickedDot: ($, { slide }) => {
        const target = Position.clamp(deck, Position.make(slide, 0))
        return $.evolve({ mode: modeAfterMove($.model, target) }).run(goto(target))
      },
      ClickedBackToLive: ($) =>
        $.model.live === null
          ? $.model
          : $.evolve({ mode: following }).run(goto(Position.clamp(deck, $.model.live.position))),
      RequestedFullscreen: ($) => $.run(ToggleFullscreen.make({}).pipe(Command.asNoop))
    },

    subscriptions: ({ model }) => [
      Router.subscription(ViewerRoute, model.route, (route) => ViewerMessage.ChangedRoute({ route })),
      Subscription.make(
        "room",
        Stream.unwrap(SyncClient.use((sync) => Effect.succeed(sync.states))).pipe(
          Stream.map((state) => ViewerMessage.ReceivedState({ state }))
        )
      ),
      HtmlSubscription.shortcuts([
        { key: "ArrowRight", message: ViewerMessage.RequestedNext() },
        { key: "PageDown", message: ViewerMessage.RequestedNext() },
        { key: " ", message: ViewerMessage.RequestedNext() },
        { key: "ArrowLeft", message: ViewerMessage.RequestedPrevious() },
        { key: "PageUp", message: ViewerMessage.RequestedPrevious() },
        { key: "f", message: ViewerMessage.RequestedFullscreen() },
        { key: "F", message: ViewerMessage.RequestedFullscreen() }
      ])
    ],

    head: () => [Head.title(deck.title)],

    view: (h, model) => {
      const liveDot = h.span.class("size-1.5 shrink-0 animate-pulse rounded-full bg-accent")
      const status = ({ live, mode }: typeof model) => {
        switch (mode._tag) {
          case "Free":
            return []
          case "Following":
            return [h.span.class("flex shrink-0 items-center gap-1.5 text-accent").children(liveDot, "Live")]
          case "Detached":
            return [
              h.button
                .class(
                  "flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 py-1 font-sans text-xs font-semibold text-cream shadow-sm transition-colors hover:bg-ink"
                )
                .attr("type", "button")
                .on("click", ViewerMessage.ClickedBackToLive())
                .children(h.span.class("size-1.5 rounded-full bg-cream"), "Back to live")
            ]
          case "Presenting":
            return [
              h.span.class("flex shrink-0 items-center gap-1.5 text-accent").children(
                liveDot,
                live === null ? "Connecting" : `Presenting · ${live.viewers} viewer${live.viewers === 1 ? "" : "s"}`
              )
            ]
        }
      }
      const position = positionOf(model.route)
      const steps = deck.slides[position.slide]!.steps
      const progress = total === 1 ? 1 : Position.index(deck, position) / (total - 1)

      const slides = deck.slides.map((slide, index) => {
        const current = index === position.slide
        const step = index < position.slide ? slide.steps - 1 : index > position.slide ? 0 : position.step
        return h.section
          .key(String(index))
          .class("absolute inset-0", fade, current ? "visible opacity-100" : "invisible opacity-0")
          .attr("aria-hidden", current ? undefined : "true")
          .attr("inert", current ? undefined : "")
          .children(slide.view(h, { step }))
      })

      const dots = deck.slides.map((_, index) =>
        h.button
          .key(String(index))
          .class("group grid h-7 w-3.5 place-items-center")
          .attr("type", "button")
          .attr("aria-label", `Slide ${index + 1}`)
          .attr("aria-current", index === position.slide ? "step" : undefined)
          .on("click", ViewerMessage.ClickedDot({ slide: index }))
          .children(
            h.span.class(
              "block size-1.5 rounded-full transition-colors",
              index === position.slide ? "bg-accent" : "bg-ink/20 group-hover:bg-ink/45"
            )
          )
      )

      return h.div
        .class("fixed inset-0 flex flex-col overflow-hidden bg-paper font-sans text-ink select-none")
        .onMount(TrackSwipe().pipe(Mount.map(swiped)))
        .children(
          h.div
            .class("absolute inset-x-0 top-0 h-[3px] bg-line/70")
            .attr("role", "progressbar")
            .attr("aria-valuemin", "0")
            .attr("aria-valuemax", String(total))
            .attr("aria-valuenow", String(Position.index(deck, position) + 1))
            .children(
              h.div
                .class("h-full origin-left bg-accent", fade && "transition-transform duration-200 ease-out")
                .style({ transform: `scaleX(${progress})` })
            ),
          h.main
            .class("grid min-h-0 flex-1 place-items-center px-3 pt-5 pb-1 sm:px-8 sm:pt-8")
            .onMount(FitCanvas({ width, height }))
            .children(
              h.div
                .class("relative overflow-hidden rounded-frame bg-cream shadow-[0_1px_2px_rgb(59_26_12/0.06)] ring-1 ring-line")
                .style({
                  width: `calc(${width}px * var(--slidekit-scale, 0))`,
                  height: `calc(${height}px * var(--slidekit-scale, 0))`
                })
                .children(
                  h.div
                    .class("absolute top-0 left-0 origin-top-left")
                    .style({
                      width: `${width}px`,
                      height: `${height}px`,
                      transform: "scale(var(--slidekit-scale, 0))"
                    })
                    .children(...slides)
                )
            ),
          h.footer
            .class("flex h-11 shrink-0 items-center gap-3 px-3 font-mono text-[11px] text-ink/70 sm:h-12 sm:px-8 sm:text-xs")
            .children(
              h.div.class("flex min-w-0 flex-1 items-center gap-3").children(
                ...status(model),
                h.span.class("min-w-0 truncate").children(h.props.host)
              ),
              h.nav.class("flex items-center").attr("aria-label", "Slides").children(...dots),
              h.div.class("flex flex-1 items-center justify-end gap-1 sm:gap-2").children(
                h.button
                  .class(button)
                  .attr("type", "button")
                  .attr("aria-label", "Previous")
                  .attr("disabled", Position.isFirst(deck, position) ? "" : undefined)
                  .on("click", ViewerMessage.RequestedPrevious())
                  .children("←"),
                h.button
                  .class(button)
                  .attr("type", "button")
                  .attr("aria-label", "Next")
                  .attr("disabled", Position.isLast(deck, position) ? "" : undefined)
                  .on("click", ViewerMessage.RequestedNext())
                  .children("→"),
                h.span.class("tabular-nums").attr("title", "Slide").children(
                  `${position.slide + 1}/${deck.slides.length}`
                ),
                h.span.class("tabular-nums text-ink/45").attr("title", "Step").children(
                  `${position.step}/${steps - 1}`
                ),
                h.button
                  .class(button)
                  .attr("type", "button")
                  .attr("aria-label", "Fullscreen")
                  .on("click", ViewerMessage.RequestedFullscreen())
                  .children(
                    h.svg.attr("viewBox", "0 0 16 16").attr("width", "14").attr("height", "14").attr("fill", "none")
                      .attr("stroke", "currentColor").attr("stroke-width", "1.5").children(
                        h.path.attr("d", "M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4")
                      )
                  )
              )
            )
        )
    }
  })
}
