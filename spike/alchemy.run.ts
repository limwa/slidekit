import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Alchemy from "alchemy"
import { Effect } from "effect"
import Deck from "./src/Deck.ts"

export default Alchemy.Stack(
  "SlidekitSpike",
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function*() {
    const deck = yield* Deck
    return { url: deck.url }
  })
)
