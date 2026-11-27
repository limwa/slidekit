import { Slide } from "slidekit"
import { Eyebrow, Page, reveal, Title } from "./parts.ts"

const points = [
  ["{ slide, step }", "is the only state a viewer needs."],
  ["/#/3/2", "names every position, so any screen can be shared and reloaded."],
  ["No animation", "decides what a position shows. A late joiner sees the same screen."]
] as const

export const position = Slide.make({
  steps: points.length + 1,
  notes: "Reveal one point per step.",
  view: (h, { step }) =>
    Page(h).children(
      Eyebrow(h, "01 · position"),
      Title(h, "One position, every screen"),
      h.ul.class("mt-20 space-y-10").children(
        ...points.map(([lead, rest], index) =>
          h.li.key(lead).class("flex items-baseline gap-8 text-[44px] leading-snug", reveal(step, index + 1)).children(
            h.span.class("font-mono text-[30px] text-accent").children(String(index + 1).padStart(2, "0")),
            h.span.children(h.strong.class("font-semibold").children(lead), " ", rest)
          )
        )
      )
    )
})
