import { Slide } from "slidekit"
import { Eyebrow, Page } from "./parts.ts"

const keys = [["← →", "step"], ["Space", "next"], ["F", "fullscreen"], ["Swipe", "on touch"]] as const

export const outro = Slide.make({
  view: (h) =>
    Page(h).children(
      Eyebrow(h, "fin"),
      h.h1.class("mt-10 text-[160px] leading-none font-semibold tracking-[-0.045em]").children("Thanks."),
      h.ul.class("mt-20 flex gap-6 font-mono text-[28px]").children(
        ...keys.map(([key, label]) =>
          h.li.key(key).class("flex items-center gap-4 rounded-frame border-2 border-line bg-paper/60 px-7 py-4").children(
            h.kbd.class("font-semibold text-accent").children(key),
            h.span.class("text-ink/70").children(label)
          )
        )
      )
    )
})
