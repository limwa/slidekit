import { Slide } from "slidekit"
import { Eyebrow, Page, reveal, Title } from "./parts.ts"

const lines = [
  "Slide.make({",
  "  steps: 3,",
  "  view: (h, { step }) =>",
  "    h.li.class(step >= 1 ? \"opacity-100\" : \"opacity-0\")",
  "})"
]

export const steps = Slide.make({
  steps: 3,
  notes: "Step 1 highlights the class, step 2 shows the rule.",
  view: (h, { step }) =>
    Page(h).children(
      Eyebrow(h, "02 · steps"),
      Title(h, "Steps are classes"),
      h.div.class("mt-16 grid grid-cols-[1.25fr_1fr] items-start gap-16").children(
        h.pre.class("rounded-frame bg-ink px-14 py-12 font-mono text-[30px] leading-[1.7] text-cream").children(
          ...lines.map((line, index) =>
            h.div.key(String(index)).class(
              "transition-colors duration-300",
              index === 3 && step >= 1 ? "text-accent" : ""
            ).children(line)
          )
        ),
        h.div.class("space-y-8 text-[38px] leading-snug").children(
          h.p.class(reveal(step, 1)).children("Tailwind classes keyed on the step do the motion."),
          h.p.class("text-ink/70", reveal(step, 2)).children(
            "The end state depends only on the position, never on an animation that finished."
          )
        )
      )
    )
})
