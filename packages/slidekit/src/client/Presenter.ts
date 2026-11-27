import { Command, Head, Mount, Router, Subscription, UiSchema } from "@effect/ui"
import { Html, HtmlSubscription } from "@effect/ui/html"
import { Effect, Schema, Stream } from "effect"
import * as Deck from "../Deck.ts"
import * as Position from "../Position.ts"
import { State } from "../protocol.ts"
import { type SwipeDirection, TrackSwipe } from "./gestures.ts"
import { PresenterLogin, requestStatus } from "./PresenterLogin.ts"
import { routeOf, ViewerRoute } from "./routes.ts"
import { FitStage, Stage } from "./Stage.ts"
import { Reload, SendGoto, SyncClient } from "./SyncClient.ts"
import { Timer } from "./Timer.ts"

export const PresenterProps = Schema.Struct({ route: ViewerRoute, host: Schema.String, buildId: Schema.String })

/**
 * Where `/present` is. It asks the Worker for its session first, then shows the login until the presenter signs in.
 * Only `Presenting` connects to the room, so the socket opens with the session cookie and closes on sign-out.
 * `live` is the room's last State, `null` until the first one arrives.
 */
export const Screen = Schema.TaggedUnion({
  CheckingSession: {},
  SigningIn: {},
  Presenting: { live: Schema.NullOr(State), signingOut: Schema.Boolean }
})
export type Screen = typeof Screen.Type

const checkingSession: Screen = { _tag: "CheckingSession" }
const signingIn: Screen = { _tag: "SigningIn" }
const presenting: Screen = { _tag: "Presenting", live: null, signingOut: false }

export const PresenterModel = Schema.Struct({ route: ViewerRoute, screen: Screen })

export const PresenterMessage = UiSchema.TaggedEnum({
  CompletedCheckSession: { signedIn: Schema.Boolean },
  SignedInLogin: {},
  ChangedRoute: { route: ViewerRoute },
  ReceivedState: { state: State },
  RequestedNext: {},
  RequestedPrevious: {},
  ClickedSignOut: {},
  CompletedSignOut: {}
})
export type PresenterMessage = typeof PresenterMessage.Type

/** Asks the Worker whether the session cookie is valid. Any answer but 200 means signing in. */
export class CheckSession extends Command.Service<CheckSession>()("slidekit/CheckSession", {
  args: {},
  success: PresenterMessage
}) {
  static readonly layer = this.toLayer(Effect.succeed(() =>
    requestStatus("/present/session").pipe(
      Effect.map((status) => PresenterMessage.CompletedCheckSession({ signedIn: status === 200 }))
    )
  ))
}

/** Asks the Worker to clear the session cookie. */
export class SignOut extends Command.Service<SignOut>()("slidekit/SignOut", { args: {}, success: PresenterMessage }) {
  static readonly layer = this.toLayer(Effect.succeed(() =>
    requestStatus("/present/logout", { method: "POST" }).pipe(Effect.as(PresenterMessage.CompletedSignOut()))
  ))
}

const swiped = (direction: SwipeDirection): PresenterMessage =>
  direction === "next" ? PresenterMessage.RequestedNext() : PresenterMessage.RequestedPrevious()

const button =
  "grid size-8 place-items-center rounded-frame transition-colors hover:bg-line/60 hover:text-accent disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-current"
const label = "font-mono text-[11px] font-medium tracking-[0.2em] text-ink/50 uppercase"

/**
 * The presenter for one deck, at `/present`: the current slide, the next position, the notes, the elapsed time and
 * the viewers. The route in the URL hash is the position, and every move is sent to the room once it has joined.
 */
export const Presenter = (deck: Deck.Deck) => {
  const fade = deck.transition === "fade"
  const positionOf = (route: ViewerRoute) => Position.parse(deck, route.params["*"])
  const isCanonical = (route: ViewerRoute) => ViewerRoute.print(route) === ViewerRoute.print(routeOf(positionOf(route)))
  const goto = (position: Position.Position) => Router.replace(ViewerRoute, routeOf(position)).pipe(Command.asNoop)

  return Html.component({
    name: "Presenter",
    props: PresenterProps,
    model: PresenterModel,
    message: PresenterMessage
  }).make({
    init: ($) => {
      const { route } = $.props
      const step = $.set({ route, screen: checkingSession }).run(CheckSession.make({}))
      return isCanonical(route) ? step : step.run(goto(positionOf(route)))
    },

    update: {
      CompletedCheckSession: ($, { signedIn }) =>
        $.model.screen._tag === "CheckingSession" ? $.evolve({ screen: signedIn ? presenting : signingIn }) : $.model,
      SignedInLogin: ($) => $.evolve({ screen: presenting }),
      ChangedRoute: ($, { route }) => {
        if (!isCanonical(route)) return $.evolve({ route }).run(goto(positionOf(route)))
        // Once joined, a move goes to the room. Before the first State it stays local, so a fresh tab can't yank the
        // room back to the start.
        const { screen } = $.model
        return screen._tag === "Presenting" && screen.live !== null
          ? $.evolve({ route }).run(SendGoto.make({ position: positionOf(route) }))
          : $.evolve({ route })
      },
      ReceivedState: ($, { state }) => {
        const { screen } = $.model
        if (screen._tag !== "Presenting") return $.model
        const screenWith = { ...screen, live: state }
        if (state.buildId !== $.props.buildId) return $.evolve({ screen: screenWith }).run(Reload.make({}))
        // The presenter takes the room's position once, when it joins, and moves on its own after that.
        const target = Position.clamp(deck, state.position)
        return screen.live === null && !Position.equals(target, positionOf($.model.route))
          ? $.evolve({ screen: screenWith }).run(goto(target))
          : $.evolve({ screen: screenWith })
      },
      RequestedNext: ($) => $.run(goto(Position.next(deck, positionOf($.model.route)))),
      RequestedPrevious: ($) => $.run(goto(Position.previous(deck, positionOf($.model.route)))),
      ClickedSignOut: ($) => {
        const { screen } = $.model
        return screen._tag !== "Presenting" || screen.signingOut
          ? $.model
          : $.evolve({ screen: { ...screen, signingOut: true } }).run(SignOut.make({}))
      },
      CompletedSignOut: ($) => $.evolve({ screen: signingIn })
    },

    subscriptions: ({ model }) => [
      Router.subscription(ViewerRoute, model.route, (route) => PresenterMessage.ChangedRoute({ route })),
      model.screen._tag === "Presenting" &&
      Subscription.make(
        "room",
        Stream.unwrap(SyncClient.use((sync) => Effect.succeed(sync.states))).pipe(
          Stream.map((state) => PresenterMessage.ReceivedState({ state }))
        )
      ),
      // Only while presenting, so typing the code doesn't move the deck.
      model.screen._tag === "Presenting" &&
      HtmlSubscription.shortcuts([
        { key: "ArrowRight", message: PresenterMessage.RequestedNext() },
        { key: "PageDown", message: PresenterMessage.RequestedNext() },
        { key: " ", message: PresenterMessage.RequestedNext() },
        { key: "ArrowLeft", message: PresenterMessage.RequestedPrevious() },
        { key: "PageUp", message: PresenterMessage.RequestedPrevious() }
      ])
    ],

    head: () => [Head.title(`Presenter · ${deck.title}`)],

    view: (h, model) => {
      const { screen } = model
      switch (screen._tag) {
        case "CheckingSession":
          return h.div.class("fixed inset-0 grid place-items-center bg-paper font-mono text-xs text-ink/40").children(
            "Checking the session…"
          )
        case "SigningIn":
          return PresenterLogin(h, {
            props: { title: deck.title },
            onEmit: { SignedIn: () => PresenterMessage.SignedInLogin() }
          })
        case "Presenting":
          break
      }

      const position = positionOf(model.route)
      const slide = deck.slides[position.slide]!
      const atEnd = Position.isLast(deck, position)
      const next = Position.next(deck, position)
      const { live } = screen

      const status = live === null
        ? h.span.class("text-ink/50").children("Connecting…")
        : h.span.class("flex items-center gap-1.5 text-accent").children(
          h.span.class("size-1.5 animate-pulse rounded-full bg-accent"),
          `Live · ${live.viewers} viewer${live.viewers === 1 ? "" : "s"}`
        )

      const nextPreview = atEnd
        ? h.div
          .class("grid place-items-center rounded-frame font-mono text-xs tracking-wider text-ink/40 uppercase ring-1 ring-line ring-dashed")
          .style({ aspectRatio: `${deck.aspectRatio.width} / ${deck.aspectRatio.height}` })
          .children("End of deck")
        : h.div
          .class("grid place-items-center")
          .style({ aspectRatio: `${deck.aspectRatio.width} / ${deck.aspectRatio.height}` })
          .onMount(FitStage(deck))
          .children(Stage(h, deck, next, { fade: false }))

      return h.div
        .class("fixed inset-0 flex flex-col overflow-hidden bg-paper font-sans text-ink select-none")
        .onMount(TrackSwipe().pipe(Mount.map(swiped)))
        .children(
          h.header
            .class("flex h-14 shrink-0 items-center gap-4 border-b border-line px-4 font-mono text-xs sm:px-8")
            .children(
              h.div.class("flex min-w-0 flex-1 items-center gap-3").children(
                h.span.class("shrink-0 font-medium tracking-[0.2em] text-accent uppercase").children("Presenter"),
                h.span.class("min-w-0 truncate font-sans text-sm font-semibold").children(deck.title)
              ),
              status,
              Timer(h, {}),
              h.button
                .class("rounded-full px-3 py-1 text-[11px] tracking-wider text-ink/60 uppercase ring-1 ring-line transition-colors hover:bg-line/60 hover:text-accent disabled:opacity-50")
                .attr("type", "button")
                .disabled(screen.signingOut)
                .on("click", PresenterMessage.ClickedSignOut())
                .children("Sign out")
            ),
          h.main
            .class(
              "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-4 p-4 sm:gap-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,30%)] lg:grid-rows-[minmax(0,1fr)]"
            )
            .children(
              h.section
                .class("grid min-h-0 min-w-0 place-items-center")
                .attr("aria-label", "Current slide")
                .onMount(FitStage(deck))
                .children(Stage(h, deck, position, { fade })),
              h.aside.class("flex min-h-0 min-w-0 flex-col gap-6 overflow-auto").children(
                h.section.attr("aria-label", "Next").children(
                  h.h2.class(label).children(atEnd ? "Next" : next.slide === position.slide ? "Next step" : "Next slide"),
                  h.div.class("mt-2").children(nextPreview)
                ),
                h.section.class("flex min-h-0 flex-col").attr("aria-label", "Notes").children(
                  h.h2.class(label).children("Notes"),
                  slide.notes === ""
                    ? h.p.class("mt-2 text-base text-ink/40").children("No notes for this slide.")
                    : h.p.class("mt-2 text-lg leading-relaxed whitespace-pre-wrap").children(slide.notes)
                )
              )
            ),
          h.footer
            .class("flex h-12 shrink-0 items-center justify-end gap-2 border-t border-line px-4 font-mono text-xs text-ink/70 sm:px-8")
            .children(
              h.button
                .class(button)
                .attr("type", "button")
                .attr("aria-label", "Previous")
                .attr("disabled", Position.isFirst(deck, position) ? "" : undefined)
                .on("click", PresenterMessage.RequestedPrevious())
                .children("←"),
              h.button
                .class(button)
                .attr("type", "button")
                .attr("aria-label", "Next")
                .attr("disabled", atEnd ? "" : undefined)
                .on("click", PresenterMessage.RequestedNext())
                .children("→"),
              h.span.class("tabular-nums").attr("title", "Slide").children(`${position.slide + 1}/${deck.slides.length}`),
              h.span.class("tabular-nums text-ink/45").attr("title", "Step").children(`${position.step}/${slide.steps - 1}`)
            )
        )
    }
  })
}
