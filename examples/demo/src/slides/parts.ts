import type { Html } from "@effect/ui/html"

export const Eyebrow = <M>(h: Html.H<M>, text: string) =>
  h.p.class("font-mono text-[28px] font-medium tracking-[0.2em] text-accent uppercase").children(text)

export const Title = <M>(h: Html.H<M>, text: string) =>
  h.h1.class("mt-8 max-w-[1400px] text-[112px] leading-[1.02] font-semibold tracking-[-0.035em]").children(text)

/** Shown from `at` on, sliding up into place. */
export const reveal = (step: number, at: number) =>
  [
    "transition duration-500 ease-out",
    step >= at ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
  ].join(" ")

export const Page = <M>(h: Html.H<M>) => h.div.class("flex h-full flex-col justify-center px-[160px] py-[120px]")
