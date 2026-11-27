# Slidekit spike

This spike proves that Effect UI, Alchemy v2, and a Durable Object WebSocket work together on one `effect` version. It is throwaway code. The real package follows [`docs/design.md`](../docs/design.md).

## Pinned versions

| Package | Version |
| --- | --- |
| `effect`, `@effect/platform-*` | `4.1.4`, the version Alchemy's repo pins |
| `alchemy`, `@alchemy.run/cloudflare` | `2.0.0-beta.87` |
| `@effect/ui` | snapshot `22128c6` from pkg.pr.new |

`bun pm ls` shows a single `effect` in the tree.

## What it covers

- `src/protocol.ts` defines the wire protocol as Effect Schemas. The client and the room import the same file.
- `src/Room.ts` is the room Durable Object. It uses hibernatable WebSockets, keeps each socket's role in its attachment, stores the position, and broadcasts `State`. It accepts `Goto` from presenters only, and it drops messages that fail to decode.
- `src/Deck.ts` is the Worker. It sends `/ws` to the room. Static assets serve every other path, with the single-page app fallback for `/present`.
- `src/client/` is the Effect UI app. `SyncClient` wraps `effect/socket` and reconnects every second. `App` follows the room's position. At `/present` it adds ←/→ buttons and keyboard shortcuts.
- `alchemy.run.ts` is the stack, with local state in `.alchemy/`.

## What it leaves out

The spike does not cover the presenter code, the cookie, the `buildId` reload, the 10-second grace period, following and detaching, hash routing, the fixed canvas, or the chrome. Any client that opens `/present` is a presenter.

It also has no Vite HMR loop. `dev` serves a prebuilt `dist/` through a Worker with `assets`. `Cloudflare.Website.Vite` does not fit here, because it deploys an assets-only Worker unless the build emits a server entry. A custom `fetch` plus the room needs this shape, or `Website.StaticSite` with `main`. How `slidekit dev` gets HMR is still open.

## Run it

Enter the dev shell from the repo root with `nix develop`, or let `direnv` load it.

```sh
bun install
bun run dev      # vite build, then alchemy dev on http://localhost:1337
bun run deploy   # vite build, then alchemy deploy to workers.dev
bun run destroy
```

Open `/` in one tab and `/present` in another. The arrows in the presenter tab move both tabs.
