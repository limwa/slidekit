import { BrowserHost } from "@effect/ui/html"
import { Effect, Layer } from "effect"
import { App } from "./App.ts"

const role = location.pathname.startsWith("/present") ? "presenter" : "viewer"

Layer.launch(BrowserHost.mount(App(role), { role }, document.getElementById("root")!)).pipe(Effect.runFork)
