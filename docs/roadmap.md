# Slidekit roadmap

This file turns [`design.md`](design.md) into phases. Each phase ends in a check on the real surface and in one or more commits.

## Repository layout

```
package.json            Bun workspace root (private)
packages/slidekit/      the published package
examples/demo/          the test-bed deck, a workspace member
```

`packages/slidekit` exports:

| Subpath | Contents |
| --- | --- |
| `slidekit` | Authoring API: `Deck`, `Slide`, and their types |
| `slidekit/client` | The browser runtime: viewer, chrome, routing, and the theme CSS |
| `slidekit/worker` | The Worker and the room Durable Object (phase 2) |
| `bin` `slidekit` | The CLI |

## How a deck becomes an app

A deck project holds `slidekit.config.ts`, its slides, and `public/`. It holds no `index.html`, no Vite config, and no Alchemy stack.

The CLI writes those into a hidden `.slidekit/` directory in the deck project, which git ignores:

- `.slidekit/index.html` loads `.slidekit/entry.ts`.
- `.slidekit/entry.ts` imports the deck from `../slidekit.config.ts` and calls `mount(deck)` from `slidekit/client`.
- `.slidekit/styles.css` imports Tailwind and the slidekit theme, with `@source` lines for the deck's `src/` and for `slidekit/client`.

The CLI then runs Vite programmatically with `.slidekit/` as the root and `../public` as the public directory. The CLI owns the Vite config and the Tailwind plugin.

## Core shapes

```ts
// slidekit
interface Slide {
	readonly steps: number // >= 1
	readonly notes: string
	readonly view: <M>(h: Html.H<M>, context: { readonly step: number }) => View.Input<M> // generic in M, so a slide can render but never send a message
}

interface Deck {
	readonly title: string
	readonly slides: NonEmptyReadonlyArray<Slide>
	readonly aspectRatio: { readonly width: number; readonly height: number } // default 16:9, canvas 1920 wide
	readonly transition: "fade" | "none"
}

// Position is 0-based in code and 1-based in the URL hash: /#/1/1 is { slide: 0, step: 0 }.
interface Position {
	readonly slide: number
	readonly step: number
}
```

`Deck.make` and `Slide.make` fill the defaults and check the arguments: `steps >= 1` and at least one slide.

Position arithmetic (`next`, `previous`, `clamp`, `first`, `last`, and parsing and printing the hash) lives in one pure module. The viewer, the presenter, and the room all use it.

## Phases

### Phase 1. Package, authoring API, viewer

- [x] Bun workspace with `packages/slidekit` and `examples/demo`. One `effect` version, the spike's pins.
- [x] `Deck.make` and `Slide.make`, and the pure position module with unit tests.
- [x] The viewer: the fixed canvas scaled to fit, the inset frame, and the chrome (progress bar, deck URL, dots, arrows, the `slide/total` and `step/maxStep` counters, fullscreen).
- [x] Hash routing through `BrowserRouter.layerHash`. Reloading `/#/3/2` shows slide 3, step 2.
- [x] Input: ←, →, Space, PageUp, PageDown, swipe, chrome arrows, and `F` for fullscreen.
- [x] The crossfade between slides, and `transition: "none"`.
- [x] The default theme as Tailwind `@theme` tokens, with self-hosted Geist and Geist Mono.
- [x] `slidekit dev`, Vite only, serving `examples/demo`. `slidekit build` writes `.slidekit/dist`.
- [x] `examples/demo` with at least four slides that use steps.

**Check:** run `slidekit dev` in `examples/demo`. In a browser, step through every slide with the keyboard and the chrome. Reload on a deep link. Resize the window to phone width and to a wide window, and confirm that the canvas keeps its ratio and the gutter.

### Phase 2. Sync

- [x] The room from the spike, plus the 10-second grace alarm and `buildId`.
- [x] The Worker, serving `/ws` and leaving the rest to assets.
- [x] Client sync: following, detached, **Back to live**, and reload on a `buildId` mismatch.
- [x] `slidekit dev` also runs the Worker and room locally.
- [x] Tests: the room logic with `@effect/vitest`, and the viewer state machine with Effect UI's `Story` or `Play`.
- [x] Delete `spike/`, and destroy its deployment.

**Check:** two browser tabs on `slidekit dev`. Moving the presenter moves the viewer. Navigating in the viewer detaches it, and **Back to live** returns it.

### Phase 3. Presenter

- [ ] Presenter code hash and cookie signing key as Worker secrets.
- [ ] `/present` login, the signed `HttpOnly` cookie, and the cookie check on the presenter socket.
- [ ] The presenter view: current slide, next slide, notes, elapsed timer, and viewer count.

**Check:** a wrong code is refused. A viewer socket that claims the presenter role cannot move the deck.

### Phase 4. CLI lifecycle

- [ ] `slidekit deploy` through `Alchemist.plan` and `Alchemist.apply`, with the stack built inside slidekit.
- [ ] `slidekit destroy` and `slidekit code rotate`.
- [ ] `slidekit init`.

**Check:** `slidekit init` a new deck, deploy it, present it from a phone, and destroy it.
