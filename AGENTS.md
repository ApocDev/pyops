# PyOps — agent guide

A web-based factory planner and in-game ops assistant for Factorio (Pyanodons) —
think YAFC, but web-based, simpler, with deep in-game integration and AI-assisted
planning. See `README.md` for the product pitch and credits.

## Repository layout

This is a single repo with three cooperating parts:

- **`app/`** — the [TanStack Start](https://tanstack.com/start) application, which
  is the whole product: React UI **and** backend (server functions + Nitro routes)
  in one process. Hosts the SQLite store, the block solver, the Factorio UDP
  bridge, the data-dump + icon pipeline, and the AI assistant. This is where almost
  all work happens. It has its own `AGENTS.md`/`CLAUDE.md` (Vite+ toolchain notes).
  `app/src-tauri/` is the Tauri **desktop shell** that wraps this server in a native
  window and packages it into a self-contained bundle (vendored Node + bundled
  resources) with self-update — see [`docs/desktop.md`](docs/desktop.md).
- **`mod/`** — the Factorio mod (`pyops`, Factorio 2.0): in-game panel, UDP link to
  the app, data-dump trigger, Helmod-style production-block view, and the
  request-combinator planner. Pure Lua, no build step.
- **`scripts/`** — dev-only helpers (currently `tunnel-dev`, to expose the dev
  server through a tunnel). Not part of the app build.

Per-project SQLite stores live in `projects/*.db` (each self-describes its name in
its own `meta`); `app-config.json` holds app-level config (active project + the
OpenRouter key/model). Both live under the app's **data dir** — the working dir in
dev, a per-OS user-data dir for a packaged build, overridable via `PYOPS_DATA_DIR`
(see `app/src/server/paths.ts`). All are generated/gitignored.

## App architecture (`app/src/`)

- `routes/` — TanStack file-based routes. UI pages (`block`, `factory`, `browse`,
  `whatif`, `coherence`, `turd`, `assistant`, `tasks`, …) plus API routes (`api.chat.ts`,
  `mcp.ts`).
- `server/` — server-side modules (run only on the backend):
  - `factorio.ts`, `dump.ts` — load/query the Factorio data dump.
  - `factory-solve.ts`, `cost-analysis.ts`, `effects.ts`, `additives.ts` — planning logic.
  - `agent.ts`, `agent-tools.ts` — the AI assistant (AI SDK v6 + OpenRouter,
    read-only tools + propose-then-apply writes: draft-a-block, draft-a-plan,
    revise-a-block's rate).
  - `bridge/` — UDP bridge to the mod. `protocol.ts` defines the wire contract;
    **`PROTOCOL_VERSION` must stay in lockstep with the same constant in
    `mod/control.lua`** (each side warns on mismatch).
- `solver/` — pure-TS sparse **linear system** per "block" (`block.ts`,
  `linalg.ts`). A pinned output goal + `Match` items become equations;
  `export`/`import` items are free boundary flows. Recipes and splits are
  user-chosen, so there is no LP/optimizer. Handles Py's cyclic recipe chains and
  reports fractional building counts.
- `db/` — Drizzle ORM over `better-sqlite3`. `schema.ts` is the source of truth;
  `import-factorio.ts` loads the dump; `synthesize.ts` builds pass-2 synthetic
  recipes (mining/boiling/burning/spoiling, temperature variants). Quality is
  intentionally not modelled (Py has none); fluid temperatures **are**.
- `lib/`, `components/` — React UI (shadcn/Radix + Tailwind v4).

## Build & verify (the `app/` toolchain)

The app uses **Vite+** (the `vp` CLI), not plain Vite/pnpm scripts. Run commands
from inside `app/`:

- `vp install` — install deps (after pulling).
- `vp config --no-agent` — one-time per clone: installs the git pre-commit hook
  (runs `vp staged` from `app/`, applying the `staged` checks in `vite.config.ts`
  — format/lint/typecheck plus the design-system guard — to staged files). Hook
  wiring is local git config, so each clone runs this once.
- `vp check` — format + lint + typecheck. **End state of any change must be a clean
  `vp check`**, including pre-existing lint in files you touch.
- `vp test` — run the Vitest suite (e.g. `block.test.ts`, `effects.test.ts`,
  `icons.test.tsx`).
- `vp dev` / `pnpm dev` — dev server on port 3000.
- `cd app/e2e && npm install && npm test` — the standalone Playwright E2E suite (its
  own package, isolated from the app's nightly toolchain pins): route smoke tests,
  the UDP-bridge round-trip, and `responsive.e2e.ts`, which screenshots every route
  across a desktop/tablet/phone matrix and **asserts no route scrolls sideways** at
  tablet/phone widths. See `app/e2e/README.md`.
- DB schema: edit `src/db/schema.ts`, then `vp run db:generate <name>` to write a
  migration under `drizzle/` (a name is required, so files stay meaningful).
  `server/provision.ts` applies the migrations **in-process** on first connect to
  each project db. `db:studio` opens the drizzle DB browser. A Factorio dump loads
  through the in-app data sync.
- Desktop shell: `vp run tauri dev` runs the app in a native window; `vp run tauri
  build` packages a bundle (run `src-tauri/vendor-node.sh` first). Releases are
  automated by **release-please** (one product version) — **don't hand-edit the
  version** in `version.txt` / `app/package.json` / `Cargo.toml` / `tauri.conf.json` /
  `mod/info.json`; it bumps them all in lockstep from conventional commits. See
  [`docs/desktop.md`](docs/desktop.md).

If setup/runtime/package-manager behavior looks wrong, run `vp env doctor`.

## The Factorio mod (`mod/`)

Pure Lua, edited in place — no build step. Key files: `control.lua` (panel +
bridge + live-state sync), `summary.lua` (production-block view), `combinator.lua`
(request-combinator planner), `data.lua`/`settings.lua` (prototypes/settings).

- **After editing anything in `mod/`, reload the mod before verifying it.** If the
  running save already has the PyOps developer bridge command loaded, use the MCP
  `gameReloadMods` tool; otherwise ask the user to reload Factorio once. Don't run
  the old desktop click reload script yourself. The mod is verified hands-on
  in-game or through bridge screenshots.
- Pure, game-free helpers have an automated suite under `mod/tests/`, run inside
  Factorio via [`factorio-test`](https://github.com/GlassBricks/FactorioTest)
  (busted-style). It's wired through a `control.lua` hook that's inert unless the
  `factorio-test` mod is present, and gated CI lives in
  `.github/workflows/mod-test.yml` (manual — needs a Factorio binary). See
  `mod/tests/README.md`. Game-API logic (entities/blueprints/GUI) is still
  hands-on.
- Never assume Py mechanics or Factorio 2.0 API behavior — read the data dump or
  the relevant Lua and cite the exact value/line.

## Conventions

- **Never `git commit`, create branches, or switch branches unless explicitly
  asked.** Writing/saving files is fine; committing is not.
- Keep features as focused modules. Prefer adding new files over growing
  `factorio.ts`/`queries.ts` into catch-alls.
- **UI work follows the design system** — [`docs/design.md`](docs/design.md): theme
  tokens (never raw palette colors), the `components/ui` primitives (never
  hand-rolled buttons/inputs/badges), square corners, `PageHeader`/`EmptyState`/
  `Skeleton`, and loading/empty/error states on every async surface.
- Readable text sizes in UI: floor at `text-sm`; `text-xs` only for true fine print.
- **Always display localized names, never internal names.** User-facing UI shows the
  `display` (localized) name of an item/fluid/recipe/tech. Internal names (e.g.
  `iron-pulp-07`) are for keys, lookups, and icon resolution only — never rendered as
  the visible label. Fall back to the internal name only when a display is genuinely
  missing, and prefer a hover/tooltip (or `title`) if the raw id is still useful.
  (Exception: the AI assistant's backtick chips intentionally take an internal name
  and render it as an icon + display.)
- Finish features end-to-end (including UI); don't ration live verification runs.
- **Keep docs in sync with the code as part of the change, not after.** When a
  change adds/renames/removes a user-facing surface (a page, tab, setting, install
  flow, env var, CLI command) or alters how a subsystem works, update the docs in
  the same pass:
  - User-facing behavior, setup, config → [`README.md`](README.md).
  - How a subsystem works → the matching file in [`docs/`](docs/) (architecture,
    data-pipeline, solver, bridge, ai-assistant, design).
  - A structural or workflow change (new top-level dir, build/verify step,
    convention) → this `AGENTS.md`.

  After a change, grep the docs for now-stale names/paths/labels (e.g. a renamed
  route or page) and fix them. Treat a doc that contradicts the code as a bug.

## Commit messages — Conventional Commits

This repo uses [Conventional Commits](https://www.conventionalcommits.org) so
changelogs can be generated from history. (The "don't commit unless asked" rule
above still stands — this is how to format the message _when_ you do commit.)

Format the subject as `type(scope): summary`:

- **type** (required): `feat` (new user-facing capability), `fix` (bug fix),
  `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`. `feat` and `fix` are
  the ones that drive the changelog.
- **scope** (optional but encouraged): the area touched — e.g. `app`, `mod`,
  `solver`, `bridge`, `db`, `data`, `cybersyn`, `agent`, `docs`, `settings`.
- **summary**: imperative mood, lower-case, no trailing period, ≤ ~72 chars
  ("add OS-aware companion-mod installer", not "Added installer.").

Body (optional, after a blank line): explain the _why_ and any notable choices,
wrapped at ~72 cols. Footer: reference GitHub issues (`Refs #27`, or `Closes #27`
to auto-close).

**No AI attribution.** Do not add `Co-Authored-By:` trailers, "Generated with…"
lines, or any other AI/tool attribution to commit messages.

Breaking changes: add `!` before the colon (`feat(db)!: …`) and/or a
`BREAKING CHANGE:` footer describing the migration.

**Prefer small, targeted commits** — one logical change each, so every commit maps
to a clean changelog entry. Split unrelated changes (a feature vs. its docs, two
independent fixes, a refactor vs. a behavior change) into separate commits rather
than bundling them under one dominant type. Only combine changes that are genuinely
inseparable.

Examples:

```
feat(settings): rename Data page to Settings with vertical tabs
fix(solver): clamp speed multiplier at 0.2 to match Factorio
docs(bridge): document the companion-mod installer and status indicator
refactor(db): extract synthetic-recipe pass into synthesize.ts
```

## Issue tracking — GitHub via `gh`

Work is tracked in GitHub Issues at `ApocDev/pyops`. Use the `gh` CLI:

- `gh issue list` / `gh issue view <n>` — browse/read issues.
- `gh issue create -t … -b … -l "area: …"` — open one (use existing labels; see
  `gh label list`).
- `gh issue close <n>` / `gh issue reopen <n>`, `gh issue comment <n> -b …`.
- `gh pr list` / `gh pr create`, etc.
- Milestones are managed in the GitHub UI (or via `gh api`).

**Keep the tracker in sync as part of the work, not after.** When a change finishes
something an open issue describes, close it (a short comment noting the commit is
nice). When work surfaces a real deferred follow-up (something parked, an explicit
"do this later"), open an issue for it so it isn't lost — don't leave it only in
chat. Reference issues from commits where it applies (`Refs #29`, `Closes #29`).
Don't retroactively file issues for already-shipped work just to have a paper trail
— the Conventional-Commits changelog already records that; the tracker is for
planned and outstanding work.

Commit/issue references like `#27` refer to GitHub issues. The app itself stores
no data in GitHub — all tasks/plans/recipes/icons live in the local SQLite store;
GitHub is only this repo's dev tracker.
