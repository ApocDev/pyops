# Architecture

PyOps is **one app** plus a **game mod**. There is no separate backend service —
the [TanStack Start](https://tanstack.com/start) app _is_ the backend: React UI in
the browser, and server functions + Nitro routes running server-side in the same
process. SQLite, the solver, the UDP bridge, the data pipeline, and the AI all
live as server-side modules.

```
┌──────────────────────────── app/ (TanStack Start) ────────────────────────────┐
│                                                                                │
│   React UI (routes/, components/, lib/)                                        │
│        │  server functions (createServerFn) + Nitro API routes                 │
│        ▼                                                                        │
│   server/  ── factorio data · solver · cost LP · AI agent · bridge             │
│   solver/  ── pure-TS linear-system block solver                               │
│   db/      ── Drizzle ORM over better-sqlite3 (per-project .db files)          │
│                                                                                │
└──────────────▲────────────────────────────────────────────────▲───────────────┘
               │ localhost UDP (bridge)                           │ reads
               │                                                  │
   ┌───────────┴───────────┐                          ┌───────────┴───────────┐
   │  mod/ (Factorio 2.0)  │                          │  Factorio data dumps   │
   │  in-game panel +      │   factorio --dump-data   │  data-raw-dump.json,   │
   │  live-state sync      │ ───────────────────────▶ │  locale, icon sprites  │
   └───────────────────────┘                          └────────────────────────┘
```

The pieces, in their own docs:

- **[Data pipeline](data-pipeline.md)** — Factorio dump → SQLite + icon atlas.
- **[Block solver](solver.md)** — turning a block of chosen recipes into run-rates
  and machine counts, plus the factory-level what-if.
- **[Factorio bridge](bridge.md)** — the UDP link to the companion mod.
- **[AI assistant](ai-assistant.md)** — the planning agent and MCP surface.

## Repository layout

```
pyops/
├── app/              TanStack Start app — UI + backend (the whole product)
│   ├── src/
│   │   ├── routes/        file-based routes: UI pages + API routes
│   │   ├── components/    shared React UI (shadcn/Radix + Tailwind v4)
│   │   ├── lib/           icons, recipe cards, modals
│   │   ├── server/        server-only modules (data, solver glue, bridge, AI)
│   │   ├── solver/        pure-TS linear-system block solver + tests
│   │   └── db/            Drizzle schema, import, synthesize, queries
│   ├── src-tauri/         Tauri desktop shell + packaging (see desktop.md)
│   ├── drizzle/           generated SQL migrations, applied in-process
│   ├── icon-data/         generated icon atlas (gitignored)
│   ├── projects/          per-project .db files, each self-named (gitignored)
│   └── app-config.json    app-level config: active project + AI key/model (gitignored)
├── mod/              Factorio 2.0 companion mod (Lua, no build step)
│   ├── control.lua        panel + UDP bridge + live-state sync
│   ├── summary.lua        Helmod-style production-block view
│   ├── combinator.lua     in-game request-combinator planner
│   └── data.lua, settings.lua
├── scripts/          dev-only helpers (tunnel-dev)
└── docs/             this documentation
```

The app uses **[Vite+](https://viteplus.dev/)** (the `vp` CLI) as its toolchain —
Vite, Rolldown, Vitest, Oxlint, Oxfmt under one wrapper — not the bare
`pnpm dev`/`pnpm build` scripts. See [`AGENTS.md`](../AGENTS.md) for the command
reference.

**Responsive UI.** The desktop layout degrades to tablet/phone/Steam Deck rather
than assuming a wide screen. The global nav collapses to a hamburger drawer below
the width where its full bar fits (~1400px, so the 1280px Deck uses the drawer);
the fixed left rails (block, browse, assistant, tasks) collapse below `md` via a
shared `SidebarShell` built on a `Sheet` drawer primitive (radix Dialog); and the
dense data tables (factory, whatif) stack into labelled cards on phones via a
shared `StatCell` instead of squeezing fixed columns. Reordering uses dnd-kit so
it works by touch — the recipe rows via a drag grip, and the block sidebar via
whole-row drag (mouse needs a small move, touch a short press-hold, so a tap still
opens and an immediate finger-drag still scrolls). A Playwright harness,
[`app/e2e/responsive.e2e.ts`](../app/e2e/responsive.e2e.ts), screenshots every
route across a desktop/tablet/phone matrix and asserts no route scrolls sideways
at tablet/phone widths.

## Per-project databases

Each "project" (usually a different mod list) is its own SQLite file under
`projects/`. The files are the source of truth — there's no registry: each db
self-describes its name/createdAt in its own `meta`, and the active project id
lives in `app-config.json`. The `db` export (`app/src/db/index.server.ts`) is a proxy
that always points at the active connection, so the query layer never changes when
you switch. Schema is provisioned in-process: on first connect (and when creating a
project) the bundled `drizzle/` migrations are applied via drizzle-orm's `migrate()`
(`app/src/server/provision.ts`), so no dev tooling is needed at runtime. A new
project starts empty; you then run a [data sync](data-pipeline.md) to fill it. The
relevant code lives in `app/src/server/projects.ts`, `app/src/server/provision.ts`,
and `app/src/db/index.server.ts`.
