import { Slide } from "slidekit"
import { Eyebrow, Page } from "./parts.ts"

export const intro = Slide.make({
  notes: "Welcome everyone. Arrow keys, space or a clicker move through the deck.",
  view: (h) =>
    Page(h).children(
      Eyebrow(h, "examples / demo"),
      h.h1.class("mt-10 text-[184px] leading-[0.95] font-semibold tracking-[-0.045em]").children(
        "Slides as code,",
        h.br,
        h.span.class("text-accent").children("watched live.")
      ),
      h.p.class("mt-14 max-w-[1100px] text-[40px] leading-snug text-ink/70").children(
        "A deck is a TypeScript module. Each slide is a pure view of its step."
      )
    )
})
