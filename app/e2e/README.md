# E2E tests (Playwright)

End-to-end tests that drive the real app in a browser against the **active project
DB** (`projects/*.db`) — catching what unit tests can't: router wiring, SSR/
hydration, and server-function plumbing against real reference data.

## Why this is its own package

The app's toolchain pins several deps to `latest`/nightly tags (`vite`, `vitest`,
`nitro`, …). Running `pnpm add` in the app re-resolves those tags and can pull a
`nitro-nightly` that breaks `vp test`. To stay clear of that, this E2E suite is a
**standalone npm package** with its own `node_modules` — installing/updating
Playwright here never touches the app's lockfile. `vp check`/`vp test` ignore
`e2e/**`.

## Running

```bash
cd app/e2e
npm install                 # first time (Playwright + browsers)
npx playwright install chromium   # if browsers aren't cached yet
npm test                    # boots `vp dev` in ../ and runs the suite
```

`npm test` starts its own dev server on port 3100 (`E2E_PORT` to override) and
tears it down after. Stop any of your own `vp dev` before installing deps — an
install while the server runs can corrupt things.

## Suites

- **`smoke.e2e.ts`** — every top-level route loads with no page error; the nav
  renders; `/browse` shows recipes by localized display name.
- **`bridge.e2e.ts`** — stands up a real `node:dgram` socket and **is the mod**:
  it sends the app's UDP bridge the same `bridge.ping` datagrams Factorio would,
  so the app's real socket → parse → `lastPeer` → `bridgeStatus` → UI path runs
  end-to-end (linked, protocol mismatch) with **no running game** and **no mocked
  responses**. Because nothing fabricates the RPC payload, it carries no
  dependency on TanStack Start's wire format. This is the pattern for the whole
  bridge surface: drive it with real datagrams, assert the UI. It also generalizes
  to the app→mod direction — bind the fake-mod socket and assert the app *sent* the
  expected datagram on a UI action, or reply with canned mod data to drive
  request/response flows (inspect, build positions, assistant tool calls). State
  pushes (`state.research`/`state.built`) mutate the active project DB, so run
  those against a throwaway project rather than your live one.

## CI

Not wired into the default `check` job (it needs a browser + a booted dev server).
Run it on demand, or add a dedicated job that does `npm install` + `npx playwright
install --with-deps chromium` here.
