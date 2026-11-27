import type { Html } from "@effect/ui/html"
import * as Deck from "../Deck.ts"
import type * as Position from "../Position.ts"
import { FitCanvas } from "./gestures.ts"

/** The mount for the element a `Stage` sits in: it scales the deck's canvas to fit that element's content box. */
export const FitStage = (deck: Deck.Deck) => FitCanvas({ width: Deck.canvasWidth, height: Deck.canvasHeight(deck) })

/**
 * The deck at `position`: the inset frame around the canvas, scaled by the `FitStage` on an element around it. With
 * `fade`, every slide is in the canvas and the current one crossfades in. Without, only the current one is.
 */
export const Stage = <M>(
  h: Html.H<M>,
  deck: Deck.Deck,
  position: Position.Position,
  options: { readonly fade: boolean }
) => {
  const width = Deck.canvasWidth
  const height = Deck.canvasHeight(deck)
  const shown = options.fade ? deck.slides.map((slide, index) => ({ slide, index })) : [
    { slide: deck.slides[position.slide]!, index: position.slide }
  ]
  const slides = shown.map(({ index, slide }) => {
    const current = index === position.slide
    const step = index < position.slide ? slide.steps - 1 : index > position.slide ? 0 : position.step
    return h.section
      .key(String(index))
      .class(
        "absolute inset-0",
        options.fade && "transition-[opacity,visibility] duration-200 ease-out",
        current ? "visible opacity-100" : "invisible opacity-0"
      )
      .attr("aria-hidden", current ? undefined : "true")
      .attr("inert", current ? undefined : "")
      .children(slide.view(h, { step }))
  })
  return h.div
    .class("relative overflow-hidden rounded-frame bg-cream shadow-[0_1px_2px_rgb(59_26_12/0.06)] ring-1 ring-line")
    .style({
      width: `calc(${width}px * var(--slidekit-scale, 0))`,
      height: `calc(${height}px * var(--slidekit-scale, 0))`
    })
    .children(
      h.div
        .class("absolute top-0 left-0 origin-top-left")
        .style({ width: `${width}px`, height: `${height}px`, transform: "scale(var(--slidekit-scale, 0))" })
        .children(...slides)
    )
}
