import { Mount } from "@effect/ui"
import { Effect, Queue, Schema, Stream } from "effect"

/** Keeps `--slidekit-scale` on the node at the largest scale that fits a `width` by `height` canvas in its content box. */
export const FitCanvas = Mount.makeStream(
  "FitCanvas",
  { args: { width: Schema.Number, height: Schema.Number } },
  (node: HTMLElement, { width, height }) =>
    Stream.callback<never>(() =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const fit = () => {
            const style = getComputedStyle(node)
            const innerWidth = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
            const innerHeight = node.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
            const scale = Math.max(0, Math.min(innerWidth / width, innerHeight / height))
            node.style.setProperty("--slidekit-scale", String(scale))
          }
          fit()
          const observer = new ResizeObserver(fit)
          observer.observe(node)
          return observer
        }),
        (observer) => Effect.sync(() => observer.disconnect())
      )
    )
)

export type SwipeDirection = "next" | "previous"

const minDistance = 50

/** Reports a horizontal one-finger swipe: leftward is `"next"`, rightward is `"previous"`. */
export const TrackSwipe = Mount.makeStream(
  "TrackSwipe",
  {},
  (node: HTMLElement) =>
    Stream.callback<SwipeDirection>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          let start: { readonly x: number; readonly y: number } | null = null
          const onStart = (event: TouchEvent) => {
            const touch = event.touches.length === 1 ? event.touches[0] : undefined
            start = touch === undefined ? null : { x: touch.clientX, y: touch.clientY }
          }
          const onEnd = (event: TouchEvent) => {
            const touch = event.changedTouches[0]
            if (start === null || touch === undefined) return
            const dx = touch.clientX - start.x
            const dy = touch.clientY - start.y
            start = null
            if (Math.abs(dx) >= minDistance && Math.abs(dx) > 1.5 * Math.abs(dy)) {
              Queue.offerUnsafe(queue, dx < 0 ? "next" : "previous")
            }
          }
          node.addEventListener("touchstart", onStart, { passive: true })
          node.addEventListener("touchend", onEnd, { passive: true })
          return () => {
            node.removeEventListener("touchstart", onStart)
            node.removeEventListener("touchend", onEnd)
          }
        }),
        (remove) => Effect.sync(remove)
      )
    )
)
