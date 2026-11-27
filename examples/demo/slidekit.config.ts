import { Deck } from "slidekit"
import { canvas } from "./src/slides/canvas.ts"
import { intro } from "./src/slides/intro.ts"
import { outro } from "./src/slides/outro.ts"
import { position } from "./src/slides/position.ts"
import { steps } from "./src/slides/steps.ts"

export default Deck.make({
  title: "Slidekit demo",
  slides: [intro, position, steps, canvas, outro]
})
