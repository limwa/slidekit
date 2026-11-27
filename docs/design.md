# Slidekit design

Slidekit is a TypeScript library and CLI for slideshows that viewers watch live. You write a deck in TypeScript with Effect. Slidekit deploys it to your own Cloudflare account. When a presenter is live, every viewer's screen follows the presenter's position.

This document records the decisions behind v1 and the reasons for them. [`GLOSSARY.md`](../GLOSSARY.md) defines the terms.

## Who it is for

Slidekit is for technical people and for AI agents. An agent must be able to create a deck and deploy it end to end. A skill collection that teaches agents the procedures is planned. It waits until the API stops moving.

## Product shape

Slidekit is a toolkit that you host yourself, not a hosted service.

- Each deck deploys as one Worker in the author's Cloudflare account.
- v1 serves each deck at `<deck>.<account>.workers.dev`. Custom domains come later.
- Slidekit runs no infrastructure of its own, so it has no tenancy, billing, or account model.

## Stack

Effect runs on every layer.

| Layer | Choice |
| --- | --- |
| Runtime and package manager | Bun only. Node is not supported. |
| Core library | `effect` v4 |
| View layer | Effect UI (`@effect/ui`) |
| Styles | Tailwind v4 through `@tailwindcss/vite` |
| Infrastructure and deploy | Alchemy v2 (`alchemy`, `@alchemy.run/cloudflare`) |
| CLI | `effect/cli` |
| Tests | `@effect/vitest` and Effect UI test utilities |

Effect UI and Alchemy v2 are both previews. Slidekit pins exact versions of both and of `effect`. They must share one `effect` instance, or Layers and Schemas break. Alchemy's `effect` version is the anchor. Slidekit uses the newest Effect UI snapshot that works with it.

Slidekit wraps Effect UI in its own authoring API (`Deck`, `Slide`). Upstream changes then land in slidekit once, not in every deck.

## Authoring a deck

A deck is its own small project, with one deck per Worker:

```
my-talk/
	slidekit.config.ts
	src/slides/*.ts
	public/
```

`slidekit init` creates the project. The project name becomes the Worker name and so the `workers.dev` subdomain. Several decks in one repo are several projects in a workspace.

An explicit array sets the slide order. Reordering is then a one-line diff that the type checker sees.

```ts
export default Deck.make({
	title: "Git on the edge",
	slides: [intro, problem, repoIndex],
})
```

Most slides hold no state of their own. They only render differently per step. The default slide is a pure function of its step:

```ts
export const repoIndex = Slide.make({
	steps: 2,
	notes: "Ask the room before revealing D1.",
	view: (h, { step }) => h.div.class("...").children(/* ... */),
})
```

A slide that needs local interactivity, such as a live demo, embeds a full Effect UI component instead. Its state stays local to each viewer.

Speaker notes are one plain string per slide. Markdown notes and notes per step can come later.

v1 ships no kit of content components. The first real deck will show which patterns repeat, and those become primitives then.

v1 supports one language per deck.

## Animation

Animations are mostly declarative. Tailwind classes depend on `step`, and `transition-*` utilities do the motion:

```ts
h.li.class(step >= 1 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4", "transition")
```

An imperative timeline, such as a Web Animations sequence, runs as an Effect UI Command in `switch` mode. A jump to another position interrupts it.

One rule holds everywhere. **The end state of a step depends only on the position.** It never depends on an animation that finished. A viewer who joins late, or who jumps straight to slide 18, sees the same screen as a viewer who watched every step.

Between slides, the frame crossfades for about 200 ms. A deck can set `transition: "none"`.

## The viewer

Slides render on a fixed logical canvas of 1920×1080, scaled to fit the window. Each deck can set its own aspect ratio. A fixed canvas means the presenter and every viewer see the same layout. Reflowing slides would make a "synchronised view" meaningless.

The canvas sits in an inset frame with a gutter on every side. Slidekit owns all the chrome around the frame:

- A thin progress bar along the top edge.
- The deck URL at the bottom left.
- Progress dots at the bottom centre.
- At the bottom right, the ←/→ buttons, a `slide/total` counter, a `step/maxStep` counter, and a fullscreen button.

A deck changes only theme tokens (colours, fonts, and radius) through Tailwind's `@theme`. The default theme is a warm cream background with burnt-orange and brown accents. Headings use Geist, and labels use Geist Mono. Both fonts are self-hosted, so a deck makes no third-party requests.

Routing uses the URL hash, `/#/:slide/:step`, with 1-based numbers. Every position has a URL that a viewer can share and reload.

Input:

- ←, →, Space, PageUp, and PageDown move between steps. Clickers send PageUp and PageDown, so they work too.
- On touch screens, a swipe moves between steps.
- The ←/→ buttons in the chrome move between steps.
- `F` toggles fullscreen.

## Sync

Sync carries one value: the position, `{ slide, step }`. Each viewer replays animations locally. The protocol leaves room for typed shared state per slide later.

### Room

Each deck has one Durable Object, the room. It holds the presenter and viewer WebSockets, using the hibernation API, so an idle deck costs almost nothing. It stores the last position, which then survives hibernation and redeploys. Two concurrent sessions of one deck are out of scope.

### Protocol

One `Schema` union of tagged messages, imported by the client and by the room:

| Message | Sender | Fields |
| --- | --- | --- |
| `Hello` | Any client, on connect | `buildId` |
| `Goto` | Presenter only | `position` |
| `State` | Room, broadcast | `position`, `presenterLive`, `viewers`, `buildId` |

The room decodes every incoming message and drops what fails to decode.

A client never states its role in a message. The Worker grants the role when the socket opens, as [The presenter](#the-presenter) describes. The room keeps it in the socket's attachment and takes a `Goto` only from a presenter socket.

### Live presenter

The presenter is live while at least one presenter socket is connected. After the last presenter socket closes, the room keeps the presenter live for 10 more seconds. That grace period covers a Wi-Fi drop or a reload. A Durable Object alarm runs the timer. When the presenter stops being live, viewers stay on their current position and move freely.

### Following and detaching

While a presenter is live, a viewer follows by default. Any navigation by the viewer detaches it. A detached viewer sees a **Back to live** button that makes it follow again. With no live presenter, viewers move freely.

### Stale clients

A redeploy during a talk leaves open viewers running the old bundle. The room broadcasts the current `buildId`. A client whose `buildId` differs reloads at once. The hash keeps each viewer's own position across the reload. Clients also clamp any position that is out of range.

## The presenter

`/present` serves the same app bundle, which starts in presenter mode when it sees that path.

1. `slidekit deploy` generates a presenter code on the first deploy, or accepts one. It prints the code once.
2. The Worker stores only a hash of the code, as a secret. A second secret is the key that signs session cookies.
3. The `/present` login form posts to `/present/login`. The Worker checks the code and sets a signed `HttpOnly` cookie.
4. The presenter WebSocket requires that cookie.

Several presenter devices can be logged in at once, such as a laptop and a phone used as a remote. All of them can move the deck, and the last write wins. `slidekit code rotate` replaces the code and ends existing sessions.

The presenter view shows the current slide and step, the next position, the speaker notes, an elapsed timer, and the number of connected viewers. The next position is the next step of the slide, or the first step of the next slide. At the last position it reads "End of deck". The timer starts when the view first shows and has a reset.

### Presenter code

A code is 8 characters of Crockford's base32, the digits and the capitals without I, L, O, and U. That is 40 random bits. It shows as `ABCD-EFGH`. Input ignores case, dashes, and spaces, and reads O as 0 and I and L as 1.

The Worker's secret `SLIDEKIT_PRESENTER_CODE_HASH` holds `pbkdf2-sha256$<iterations>$<salt>$<hash>`. The hash is PBKDF2-SHA256 through WebCrypto, with a random 16-byte salt and 100000 iterations, which is the most workerd allows. The check compares in constant time.

### Session cookie

The secret `SLIDEKIT_SESSION_KEY` holds 32 random bytes. A token is `<issued at>.<HMAC-SHA256>`. The MAC covers the issue time and the whole code hash, so a new code ends every session with no stored list of sessions. That way `slidekit code rotate` only has to replace the hash secret. A token is valid for 12 hours.

The cookie is `slidekit_presenter`, set with `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`. Chromium accepts `Secure` on `http://localhost`, through the Vite proxy too, so `slidekit dev` uses the same cookie. Other browsers are unchecked.

### Who is a presenter

The Worker grants the presenter role at the `/ws` upgrade. It grants it only when the client asks, with `/ws?as=presenter`, and the request carries a valid session cookie. Every other socket is a viewer. The Worker tells the room the role in a header that it sets itself, which replaces any copy the client sent.

The client asks only from `/present`. A viewer tab in a signed-in browser carries the cookie too. If the cookie alone decided the role, that tab would count as a presenter and keep the deck live after the presenter left.

### Login limit

The room counts presenter logins for the whole deck. After 10 failures within 10 minutes, `/present/login` answers 429 until the oldest failure leaves the window, even for the right code. That keeps the 40-bit code out of reach of guessing. A login counts from the moment it begins and stops counting only if its code was right, so concurrent guesses can't slip past the limit. A success clears only its own attempt and leaves other failures in place.

The limit is per deck, not per client. Anyone can lock out new presenter logins for 10 minutes by sending wrong codes. Presenters who are already signed in keep working, because their cookies stay valid.

### Local dev

`slidekit dev` makes a fresh code and session key on every run, or takes the code from `SLIDEKIT_PRESENTER_CODE`. It binds both as the local Worker's secrets and prints the code at startup.

## The Worker

The Worker runs code only for `/present/*` and `/ws`. Cloudflare's static asset layer serves every other path directly, `/present` itself included. Hash routing makes that possible, because every deck URL is `/` or `/present` to the server.

| Route | Answer |
| --- | --- |
| `GET /ws` | The WebSocket upgrade, handed to the room with the granted role. |
| `POST /present/login` | Takes `{ "code": "..." }` as JSON. Answers 204 with the session cookie, 401 for a wrong code, or 429 when the login limit is reached. |
| `GET /present/session` | 200 with a valid session cookie, 401 without one. |
| `POST /present/logout` | 204, and clears the cookie. |

In `slidekit dev`, Vite proxies `/ws` and the three `/present/` routes to the local Worker, and serves `/present` itself.

## Deploy and local dev

Slidekit builds the Alchemy stack itself, and the stack stays hidden from authors and agents. The stack contains the Worker, the room Durable Object, the built Vite assets, the presenter code hash, and the cookie signing key. An escape hatch for extra bindings can come later.

Commands:

| Command | What it does |
| --- | --- |
| `slidekit init` | Creates a deck project. |
| `slidekit dev` | Runs Vite with HMR and runs the Worker and room locally in workerd. Sync works across two browser tabs. |
| `slidekit deploy` | Builds the deck and deploys it with `Alchemist.plan` and `Alchemist.apply`. |
| `slidekit code rotate` | Replaces the presenter code and ends presenter sessions. |
| `slidekit destroy` | Removes the deck's Cloudflare resources. |

Deploy state lives in the deck's `.alchemy/` directory, which git ignores. A remote state store becomes relevant once decks deploy from CI or from more than one machine.

Credentials come from `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, or from an Alchemy profile. No command prompts when those are set, so an agent can run every command.

## Repository

Slidekit starts as one package, `slidekit`, with subpath exports and a `bin`. The repo also holds an example deck, `examples/demo`, which is the test bed. The package splits only if worker and client dependencies start to fight in the bundle.

## Testing

- `@effect/vitest` covers the protocol and the room logic, run against Alchemy's local mode.
- Effect UI's headless `HtmlPlay` with `TestClock` covers the viewer state machine: following, detached, back to live, and stale build.
- A smoke test builds `examples/demo`.

v1 has no screenshot tests. Visual checks stay manual while the project is a prototype.

## First milestone: the spike

The spike proved that the three previews work together on one `effect` version. It was an Effect UI page that connected to the room over a WebSocket, deployed with Alchemy to workers.dev. Phase 2 replaced it, and it was deleted. Commit `4040305` holds its code and its README.

## Deferred

- Custom domains.
- An agent skill collection, installed by `slidekit init`.
- Several languages per deck.
- Audience participation, such as polls and reactions, built on the room.
- Typed shared state per slide.
- Server rendering and prerendering for link previews.
- A content component kit.
- Remote Alchemy state.
