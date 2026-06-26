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
- **`bridge.e2e.ts`** — mocks the `bridgeStatusFn` server-function response to feed
  the UI canned in-game/bridge state (linked, protocol mismatch, no-game, stale
  peer, bind error) with **no running game**. This is the pattern for stress-
  testing anything driven by the bridge (live research/TURD/built sync, custom
  recipes): intercept the RPC, assert the UI. The mock rebuilds TanStack Start's
  seroval wire format and sets the `x-tss-serialized` header the client requires.

## CI

Not wired into the default `check` job (it needs a browser + a booted dev server).
Run it on demand, or add a dedicated job that does `npm install` + `npx playwright
install --with-deps chromium` here.
