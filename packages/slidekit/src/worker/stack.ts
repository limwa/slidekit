import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Alchemy from "alchemy"
import { Effect } from "effect"
import Deck, { DeckOptions } from "./Deck.ts"

/** The Alchemy stack of one deck. Slidekit builds it, so a deck project holds no `alchemy.run.ts`. State stays in the deck's `.alchemy/`. */
export const make = (options: DeckOptions) =>
  Alchemy.Stack(
    "slidekit",
    { providers: Cloudflare.providers(), state: Alchemy.localState() },
    Effect.gen(function*() {
      const deck = yield* Deck
      return { url: deck.url }
    }).pipe(Effect.provideService(DeckOptions, options))
  )
