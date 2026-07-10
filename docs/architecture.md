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
   │  mod/ (Factorio 2.1)  │                          │  Factorio data dumps   │
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
├── mod/              Factorio 2.1 companion mod (Lua, no build step)
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

Every writable project connection uses the same SQLite policy before migrations
or application queries run: WAL journal mode, a 5-second busy timeout,
foreign-key enforcement, and `synchronous=NORMAL`. WAL keeps readers moving while
SQLite serializes writers; the timeout absorbs brief overlap with imports and
desktop lifecycle operations. Cache size, temporary storage, memory mapping, and
automatic checkpoint thresholds stay at SQLite's defaults instead of becoming
another application memory/cache policy. Short-lived read-only handles (project
listing, validation, and backup) get the same timeout and integrity setting but
do not try to change the database's persistent journal mode or their irrelevant
write-durability setting.

Because connections are cached, migrations added while the server is running (the
dev-server case) are **not** picked up — the fix is a restart. The app shell polls a
cheap drift check (`app/src/server/db-migrations.server.ts`: bundled
`drizzle/meta/_journal.json` vs the active db's `__drizzle_migrations` rows) and
shows a "restart the app to apply" banner when any are pending; migrations are never
auto-applied at runtime.

## Export / import (#82)

Two surfaces under **Settings › Backup & share**:

- **Project backup** — the whole project as its `.db` file. `GET /api/backup`
  streams an online-backup snapshot of the active db (better-sqlite3's backup API,
  so it's consistent while the app runs); `POST /api/backup?name=…` installs an
  uploaded db as a **new** project (validated, fresh id, never overwriting; the
  bundled migrations upgrade an older backup on first connect). A route handler
  because both directions move a whole file (`app/src/routes/api.backup.ts`,
  `app/src/server/backup.server.ts`).
- **Block / plan JSON** — shareable, versioned envelopes (`{ pyops: 1, kind:
"block" | "plan", … }`) carrying a block's full editor doc (goals, recipes,
  per-recipe picks) — a plan adds sidebar folders. The pure logic (validation,
  legacy-doc migration, name-collision suffixing) is `app/src/lib/plan-export.ts`;
  the db side is `app/src/server/export.server.ts` (server fns in
  `export-fns.ts`). Imports always create **new** blocks (suffixed names, remapped
  folders) and re-solve them; references the target's data dump doesn't have are
  flagged broken — the same degrade path as mod drift — never rejected. Single
  blocks also export from the block editor's toolbar. Snapshots (#85) build on the
  same serialization.

The block editor keeps the solve server-authoritative without solving the same
document twice. Opening a block solves the SQLite-loaded document once; edits
are coalesced for a short idle window, then one `saveBlockFn` request solves and
persists the document and returns that exact solve for the UI. Module auto-fill
hints follow lazily from the solved row rates and never invoke the LP. External
writes (undo and snapshot restore) rehydrate and solve the new persisted
document, while the existing `updatedAt` guard still rejects stale-tab saves.
Save requests are serialized per editor; edits made during an in-flight solve
collapse into one follow-up save of the newest document, so responses cannot
land out of order.

## Block snapshots (#85)

Per-block restore points, complementing undo (which unwinds recent edits):
a snapshot freezes a block's full definition — the face (name/icon/enabled) as
columns plus the editor doc as JSON, the **same serialization as the export
envelope's block** — into a `block_snapshots` row. Two kinds:

- **manual** — the user's named points ("Snapshot now" in the block editor's
  history drawer, label optional), kept until deleted.
- **auto** — taken silently before destructive/structural writes: block delete,
  snapshot restore, scale-to-demand/assistant resizes, and (throttled to one per
  10-minute editing burst) ordinary saves. Capped at the newest 20 per block,
  pruned on write; deduped against the newest snapshot so repeat operations
  don't stack identical rows.

The logic lives in `app/src/server/snapshots.server.ts` (server fns in
`snapshot-fns.ts`); the drawer is `app/src/components/block/snapshot-sheet.tsx`.
**Restore** replaces the block's definition in place (identity — id, folder,
sort order — preserved): it auto-snapshots the current state first, re-solves
through the normal persist machinery, and runs as ONE tracked undo action, so a
restore is both undoable and re-restorable. **Diff** (`app/src/lib/block-diff.ts`,
pure) compares a snapshot against the live editor doc — goals added/removed/
re-rated, recipes added/removed/toggled, machine/fuel/module/beacon picks,
made marks, pins, spoil plans — rendered in the scale-plan drawer's from → to
language with display names resolved server-side. Snapshot bookkeeping itself is
not a planning edit: `block_snapshots` carries no undo triggers and every
capture runs `{ undo: false }`, and rows deliberately survive block deletion
(a recycle bin; restore-from-deleted UI is future work).

## Undo (planning edits)

Multi-level undo for planning edits, built on the canonical
[SQLite trigger pattern](https://www.sqlite.org/undoredo.html): `AFTER
INSERT/UPDATE/DELETE` triggers on the **user-planning tables only** (blocks,
block_groups, module_presets, tasks, task_steps, task_links, notes — never
imported reference data, live-state tables, or caches like
`block_flows`/`block_machines`) write the inverse SQL of every row change into
`undo_log`. The triggers live in a migration (`drizzle/0004_undo_log.sql` —
hand-written there because drizzle can't model triggers) and only fire while a
current-action marker row exists in `undo_current`, so any write that bypasses
the wrapper is simply untracked (fail-soft), and the high-volume system writes
are excluded by construction.

One undo step = one user action: every mutating server-fn path runs through
`withUndoAction(name, fn)` (`app/src/server/undo-action.server.ts`), which opens
one action id + the marker, runs the mutation, and closes it — so "apply this
plan" pops as a single undo. Tracking is opt-out: system writes to planning
tables (cache re-solves, LLM-computed priorities, undo execution itself) pass
`{ undo: false }`. Undo is linear (strictly top-of-stack), the last 50 actions
are kept (trimmed on write), and the log is per project db.

`undoLast()` (`app/src/server/undo.server.ts`, exposed as
`undoStatusFn`/`undoLastFn` in `app/src/server/undo.ts`) executes the top
action's inverse statements in one transaction without re-logging, then
re-solves the touched blocks through the normal persist machinery so the
untracked caches stay consistent, and returns the changed block ids so open
editors can rehydrate. If a migration adds a column to a triggered table, that
table's triggers must be regenerated in the same migration —
`app/src/server/undo.test.ts` has a coverage check that fails when a trigger
goes stale.

On the client every undo trigger — Ctrl+Z (`components/undo-hotkey.tsx`, via
the hotkey layer and deliberately **not** `allowInInputs`, so text fields keep
native undo), the ↶ nav affordance (`components/undo-button.tsx`, tooltip =
top-of-stack name, disabled at depth 0), and the palette's "Undo last action" —
runs through `lib/undo-client.ts`'s `runUndo`: pop the stack, toast the result
(the shared toast primitive: `components/ui/toast.tsx` + `lib/toast-store.ts`),
invalidate the planning query families, and push the reverted doc into any open
block editor via the open-editor registry (`lib/block-editors.ts`) — the editor
registers a `hydrate` callback so its auto-save can't write pre-undo state
back, and an `onDeleted` escape for when the undo reverted the block's
creation. The editor also sends `baseUpdatedAt` (its hydration point) with
every save; a `{ conflict }` rejection (another tab/undo/assistant write got
there first) reloads the fresh doc and toasts instead of clobbering it. Editor
saves name themselves on the stack where the call site knows what changed
(`pendingAction` labels in the block doc store, merged by
`lib/undo-names.ts`); the debounced auto-save otherwise stays generic
(`Edit block "…"`).

Destructive actions ride the same rails (#83): a small undo-logged delete
(task, subtask, step, note, folder, module preset) fires immediately — no
confirm — and shows a toast whose **Undo** button is just a shortcut into
`runUndo` (`deletedToast`/`undoToast` in `lib/undo-client.ts`). Big or
irreversible deletes go through `ConfirmDialog`
(`components/confirm-dialog.tsx`, on the `ui/alert-dialog.tsx` primitive —
never `window.confirm`): block deletion states the recipe/goal counts being
destroyed (from `listBlocks`) and still gets the undo toast; project removal,
companion-mod removal, and chat deletion aren't in the undo log, so their
dialogs say so and their toasts carry no Undo button. In-editor row removals
(recipe rows, snapshot delete) keep their two-click arm instead — they mutate
the editor's local doc ahead of the debounced auto-save, so a toast-Undo could
pop the wrong action.
