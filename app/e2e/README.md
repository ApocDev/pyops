# E2E tests (Playwright)

End-to-end tests that drive the real app in a browser — catching what unit tests
can't: router wiring, SSR/hydration, and server-function plumbing against real
reference data.

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
npm test                    # boots both dev servers and runs everything
```

## Two servers: read-only vs mutating

The suite is split into two Playwright projects with their own `vp dev` server
each (see `playwright.config.ts`):

- **`chromium`** — the specs in this directory. Runs **read-only** against a dev
  server on port 3100 (`E2E_PORT`) whose data dir is the app's real one, i.e.
  the **active project DB** (`projects/*.db`) with real reference data. Nothing
  here writes planning data.
- **`mutating`** — the specs in `mut/`. These **edit blocks, delete things, and
  create projects**, so they get a second dev server on port 3101
  (`E2E_MUT_PORT`) whose `PYOPS_DATA_DIR` points at a scratch directory,
  `e2e/.mut-data`. Before that server boots, `seed-mut-data.mjs` wipes the
  scratch dir and copies the real data dir's `app-config.json` and every
  `projects/*.db` into it (via sqlite's online-backup API, so a db the
  read-only server holds open still copies consistently) — the mutating specs
  see real recipes/items with **zero risk to your data**.

  The seeding is chained into the mutating server's `webServer` command rather
  than a Playwright `globalSetup`, because Playwright starts webServers *before*
  globalSetup runs — the copy has to land before the server opens the db.

The two servers also set separate `PYOPS_NITRO_BUILD_DIR` values. Nitro's
default dev build directory is shared by every process in a checkout; without
this isolation, concurrent hot-reload workers can overwrite each other's build
artifacts and intermittently surface `ECONNRESET` in Vite's browser overlay.

Locally (`reuseExistingServer`) a still-running server from a previous run is
reused **without re-seeding**, so scratch state accumulates across quick
iterations; the mutating specs are written for that — every entity they touch is
one they created themselves, under a per-run unique name (see `mut/helpers.ts`).
A cold `npm test` always starts from a fresh copy. Stop any of your own `vp dev`
before `npm install` here — an install while the server runs can corrupt things.

## Suites

Read-only (this directory):

- **`smoke.e2e.ts`** — every top-level route loads with no page error; workspace
  navigation stays active across its views; `/explore` shows recipes by localized display
  name.
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
- **`responsive.e2e.ts`** — screenshots every route across a desktop/tablet/phone
  matrix and asserts no route scrolls sideways at tablet/phone widths.
- **`theme.e2e.ts`** — verifies light/dark preference switching and persistence, then runs
  Axe's rendered color-contrast rule across representative routes in both themes.

Mutating (`mut/`, against the isolated server):

- **`palette.e2e.ts`** — the Ctrl+K / `/` command palette: open/close semantics
  (including the '/'-suppressed-in-inputs rule), fuzzy page search with
  Enter-to-navigate, finding a block by display name, server-side goods search
  jumping to Explore search, recently visited blocks/goods on an empty query,
  and the `?` shortcut help sheet (hotkey + palette action).
- **`undo.e2e.ts`** — a goal-rate edit lands on the undo stack under its
  descriptive name (the nav affordance's tooltip), Ctrl+Z reverts it inside the
  open editor and the revert survives a reload; the empty stack toasts
  "Nothing to undo".
- **`snapshots.e2e.ts`** — the block history drawer: manual labelled snapshot,
  the snapshot-vs-current diff (from → to), restore rehydrating the editor, and
  the automatic "before restore" point.
- **`destructive.e2e.ts`** — block delete confirms via an AlertDialog naming the
  block and its contents, Cancel keeps it, Confirm toasts with a working Undo;
  task delete fires immediately with an undo toast and no dialog.
- **`backup.e2e.ts`** — Settings › Backup & share: the project backup download
  is a real sqlite file; a single block's JSON export re-imports as a new
  " (2)"-suffixed block.
- **`project-dialog.e2e.ts`** — the switcher's "new project…" dialog: create
  disabled on empty/whitespace names, Escape cancels, creating writes a fresh db
  to the scratch dir and lands on Settings › Game data (then switches back).
- **`reactor-layout.e2e.ts`** — a heat block's reactor row: picking a 2×2 farm
  applies the neighbour bonus (×3 heat, a third of the reactors) and persists.
- **`module-presets.e2e.ts`** — module templates (#99): save a row's loadout as
  a preset from the modules dialog, star it as the default template, and a
  compatible new recipe row starts with that loadout baked in.
- **`recipe-order.e2e.ts`** — recipe selection keeps the best currently unlocked
  recipe above cheaper choices that are only available in the future horizon.

## CI

Not wired into the default `check` job (it needs a browser + a booted dev server).
Run it on demand, or add a dedicated job that does `npm install` + `npx playwright
install --with-deps chromium` here.
