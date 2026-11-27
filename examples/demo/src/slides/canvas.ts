import { Slide } from "slidekit"
import { Eyebrow, Page, reveal, Title } from "./parts.ts"

export const canvas = Slide.make({
  steps: 2,
  notes: "Resize the window to show the canvas scaling.",
  view: (h, { step }) =>
    Page(h).children(
      Eyebrow(h, "03 · canvas"),
      Title(h, "1920 wide, always"),
      h.div.class("mt-16 flex items-center gap-20").children(
        h.div.class("relative aspect-video w-[760px] rounded-frame border-[3px] border-ink/80 bg-paper").children(
          h.div.class("absolute inset-0 bg-[linear-gradient(to_right,rgb(59_26_12/0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgb(59_26_12/0.08)_1px,transparent_1px)] bg-size-[76px_76px]"),
          h.span.class("absolute top-6 left-7 font-mono text-[26px] text-ink/70").children("1920 × 1080"),
          h.span.class(
            "absolute right-7 bottom-6 rounded-full bg-accent px-6 py-2 font-mono text-[24px] text-cream",
            reveal(step, 1)
          ).children("scaled, not reflowed")
        ),
        h.p.class("max-w-[640px] text-[40px] leading-snug text-ink/75").children(
          "Every viewer sees the same layout, from a phone to a projector."
        )
      )
    )
})
