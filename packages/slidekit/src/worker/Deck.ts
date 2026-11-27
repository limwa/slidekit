import * as Cloudflare from "@alchemy.run/cloudflare"
import { Clock, Config, Context, Duration, Effect, Redacted, Schema } from "effect"
import * as Headers from "effect/http/Headers"
import { HttpServerRequest, schemaBodyJson } from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Code from "../auth/Code.ts"
import * as Session from "../auth/Session.ts"
import type { Role } from "../protocol.ts"
import Room, { buildIdBinding, roleHeader } from "./Room.ts"

/** The secret that holds the hash of the presenter code, as `Code.hash` writes it. */
export const codeHashBinding = "SLIDEKIT_PRESENTER_CODE_HASH"

/** The secret that holds the key that signs presenter sessions, as `Session.generateKey` writes it. */
export const sessionKeyBinding = "SLIDEKIT_SESSION_KEY"

/** What the Worker is deployed as, taken from the deck project when slidekit builds its stack. */
export interface DeckOptions {
  /** The Worker name, and so the `workers.dev` subdomain. */
  readonly name: string
  /** The built app, served as static assets. */
  readonly assets: string
  readonly buildId: string
}

// The runtime bundle evaluates the props again with no deck project around, so the defaults must be harmless there.
export const DeckOptions = Context.Reference<DeckOptions>("slidekit/DeckOptions", {
  defaultValue: () => ({ name: "slidekit", assets: "./dist", buildId: "" })
})

const LoginBody = Schema.Struct({ code: Schema.String })

const sessionCookie = {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
  path: "/"
} as const

const status = (code: number) => HttpServerResponse.empty({ status: code })

/**
 * The deck's Worker. It runs only for `/ws` and `/present/*`. Static assets serve every other path, `/present`
 * itself included. It hands `/ws` to the one room with the role the socket gets: presenter only when the client asks
 * with `?as=presenter` and has a valid session cookie, which `/present/login` sets for the right presenter code. A
 * viewer tab in a signed-in browser doesn't ask, so it stays a viewer.
 */
export default class Deck extends Cloudflare.Worker<Deck>()(
  "Deck",
  Effect.gen(function*() {
    const options = yield* DeckOptions
    return {
      main: import.meta.url,
      name: options.name,
      assets: {
        directory: options.assets,
        notFoundHandling: "single-page-application" as const,
        runWorkerFirst: ["/ws", "/present/*"]
      },
      env: { [buildIdBinding]: options.buildId },
      compatibility: { date: "2026-11-01" }
    }
  }),
  Effect.gen(function*() {
    const rooms = yield* Room
    const codeHash = yield* Config.Redacted(codeHashBinding)
    const sessionKey = yield* Config.Redacted(sessionKeyBinding)
    const secrets: Session.Secrets = { key: Redacted.value(sessionKey), codeHash: Redacted.value(codeHash) }
    const room = () => rooms.getByName("deck")

    const signedIn = (request: HttpServerRequest) =>
      Effect.gen(function*() {
        const token = request.cookies[Session.cookieName]
        return token !== undefined && (yield* Session.verify(token, secrets, yield* Clock.currentTimeMillis))
      })

    const login = Effect.gen(function*() {
      const body = yield* Effect.option(schemaBodyJson(LoginBody))
      if (body._tag === "None") return status(400)
      // The limit comes first, so a locked-out deck refuses even the right code.
      const { allowed, at } = yield* room().beginLogin()
      if (!allowed) return status(429)
      if (!(yield* Code.verify(body.value.code, secrets.codeHash))) return status(401)
      yield* room().succeededLogin(at)
      const token = yield* Session.sign(secrets, yield* Clock.currentTimeMillis)
      return yield* HttpServerResponse.setCookie(status(204), Session.cookieName, token, {
        ...sessionCookie,
        maxAge: Duration.seconds(Session.maxAge)
      })
    })

    return {
      fetch: Effect.gen(function*() {
        const request = yield* HttpServerRequest
        const url = new URL(request.url, "http://deck")
        switch (`${request.method} ${url.pathname}`) {
          case "GET /ws": {
            if (request.headers.upgrade !== "websocket") {
              return HttpServerResponse.text("Expected Upgrade: websocket", { status: 426 })
            }
            const asks = url.searchParams.get("as") === "presenter"
            const role: Role = asks && (yield* signedIn(request)) ? "presenter" : "viewer"
            // Setting the header replaces any copy the client sent.
            return yield* room().fetch(request.modify({ headers: Headers.set(request.headers, roleHeader, role) }))
          }
          case "POST /present/login":
            return yield* login
          case "GET /present/session":
            return status((yield* signedIn(request)) ? 200 : 401)
          case "POST /present/logout":
            return yield* HttpServerResponse.expireCookie(status(204), Session.cookieName, sessionCookie)
          default:
            return HttpServerResponse.text("Not found", { status: 404 })
        }
      }).pipe(Effect.catchTag("CookiesError", Effect.die))
    }
  })
) {}
