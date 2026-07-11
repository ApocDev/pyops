---
title: Architecture
description: Understand the PyOps runtime topology, repository boundaries, state ownership, database lifecycle, and consistency model.
outline: [2, 3]
---

# Architecture

PyOps is one local application plus one optional Factorio mod. The TanStack Start process
serves the React UI and owns backend work; there is no separately deployed API service.
The Tauri desktop shell launches that local server and presents it in a native window.

<AppScreenshot
  src="/images/architecture-overview.webp"
  alt="Architecture diagram showing the Tauri shell, React UI, local PyOps server modules, and the Factorio Companion mod"
  caption="The desktop app owns planning and persistence locally. Factorio supplies reference data through dumps and live save state through the versioned localhost UDP bridge."
/>

Factorio also runs as a short-lived local data source during game-data sync. The app asks
the game executable to dump prototypes, localized names, and optional icon sprites, then
imports those outputs into the active project.

## Repository map

```text
pyops/
├── app/                         application package
│   ├── src/
│   │   ├── routes/              TanStack pages and Nitro/API routes
│   │   ├── components/          shared and page-specific React UI
│   │   ├── lib/                 client-safe models, state, and utilities
│   │   ├── server/              server functions and server-only subsystems
│   │   ├── solver/              HiGHS model, diagnosis, and sub-block composition
│   │   └── db/                  Drizzle schema, queries, import, and synthesis
│   ├── drizzle/                 generated and hand-written SQL migrations
│   ├── e2e/                     isolated Playwright package
│   └── src-tauri/               desktop shell, bundled resources, and packaging
├── mod/                         Factorio 2.1 Companion mod
├── scripts/                     development helpers
└── docs/                        independent VitePress package
```

The app and documentation are separate Vite+ packages with independent lockfiles. This
keeps VitePress and its Vite dependency out of the desktop application's runtime graph.

## Application boundaries

### Routes and components

`app/src/routes/` uses TanStack file-based routing. Most files render pages; API route files
handle streaming chat, backups, icon assets, and the MCP endpoint. Shared UI belongs under
`components/`; route-specific components use a matching subdirectory.

Client code reads and mutates server state through TanStack `createServerFn` wrappers and
React Query. Query keys are treated as cache ownership boundaries: a write invalidates the
families whose server-derived data changed.

### Server-only modules

Node APIs, SQLite access, Factorio processes, OpenRouter calls, the UDP socket, and other
backend work belong in `*.server.ts` modules. TanStack import protection rejects a client
bundle that reaches one of these modules.

Client-importable server-function wrappers may import a server-only module at the top level
only when it is referenced inside a `.handler()` body. The compiler replaces the handler
with an RPC stub and prunes that dependency from the client bundle. A plain helper that
needs server-only code must itself live in a `*.server.ts` module.

### Planning subsystems

The planning path is deliberately layered:

1. `db/` owns persisted reference and project records.
2. `server/block-compute.server.ts` resolves a saved block into solver inputs, effects,
   logistics, and display-ready results.
3. `solver/` owns the mathematical model and infeasibility diagnosis without UI or database
   dependencies.
4. Factory, Coherence, cost, and what-if modules aggregate cached block flows and solved
   blocks for cross-block analysis.

See [Block solver](./solver) for the constraint model and [Data pipeline](./data-pipeline)
for the reference-data boundary.

## State ownership

| State                                                                                          | Owner                                      | Lifetime                                |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------- |
| Blocks, groups, tasks, conversations, planning settings, synced prototypes, and live snapshots | One SQLite file under `projects/`          | Per project                             |
| Active project, stored OpenRouter key, and default model                                       | `app-config.json`                          | Per app installation                    |
| Generated icon sheets and manifest                                                             | `icon-data/`                               | Per app data directory; rebuilt by sync |
| Database migrations and Companion mod source                                                   | Bundled read-only resources                | Per app version                         |
| Active Assistant stream buffer and UDP socket status                                           | Server process memory                      | Until restart                           |
| Save, mods, and Factorio prototype source                                                      | Factorio installation and user-data folder | External to PyOps                       |

The resolved paths live in `app/src/server/paths.server.ts`. Packaged builds separate the
writable data directory from bundled resources. Source runs default writable state to the
`app/` working directory. See [Development configuration](./configuration) for overrides.

::: warning Preserve source-of-truth boundaries
Do not put project state in `app-config.json`, generated data in bundled resources, or
runtime-only bridge state in SQLite merely to make it convenient for one caller. These
boundaries make project backup, packaging, and process restart behavior predictable.
:::

## Project databases

Each project is a self-describing SQLite file. Its `meta` table stores the display name and
other project metadata, so no separate registry is required. `app-config.json` stores only
the active project ID.

`app/src/db/index.server.ts` exports a proxy over the active Drizzle connection. Project
switching changes the target connection and reloads the client so every route and query is
rebuilt against one consistent project.

### Provisioning and migrations

`app/src/db/schema.ts` is the schema source of truth. SQL migrations under `app/drizzle/`
are applied in-process on first connection by `app/src/server/provision.ts`; packaged users
do not need a migration CLI.

Connections are cached for the server lifetime. During development, adding a migration
requires a server restart before an already-open connection can apply it. A migration-drift
check compares the bundled journal with the active database and surfaces the required
restart in the UI.

### SQLite policy

Writable connections enable WAL journal mode, foreign keys, a five-second busy timeout,
and `synchronous=NORMAL`. WAL lets readers continue while SQLite serializes writes; the
busy timeout absorbs short overlap with imports, backups, and desktop lifecycle work.

Short-lived read-only handles are used for project discovery, validation, and backups.
They receive the relevant integrity and timeout settings without trying to change
persistent write policy.

## Consistency and recovery

### Server-authoritative block saves

The block editor does not solve an edit independently on the client. It coalesces changes,
sends the newest document to `saveBlockFn`, and renders the exact solved result returned by
the server. Requests are serialized per editor; edits made during an in-flight save become
one follow-up request.

Every save includes the document's base `updatedAt`. If another tab, undo, snapshot restore,
or Assistant action changed the block first, the server rejects the stale write and the
editor reloads the authoritative document instead of overwriting it.

### Undo

Undo uses SQLite triggers on user-planning tables. `withUndoAction()` creates an action
marker, performs one logical mutation, and lets table triggers record inverse SQL. System
writes such as imported reference data, caches, and solve refreshes run without a marker
and do not pollute the user's undo stack.

`undoLast()` applies one action's inverse statements in a transaction, re-solves affected
blocks, and returns their IDs so open editors can rehydrate. The client routes the nav
button, command-palette action, and keyboard shortcut through the same invalidation and
editor-hydration path.

When a migration changes a table covered by undo triggers, regenerate those triggers in
the same migration. `app/src/server/undo.test.ts` verifies that trigger columns match the
schema.

### Snapshots, backups, and exports

Block snapshots freeze a complete block definition for comparison and restoration. Manual
snapshots remain until deletion; automatic snapshots protect structural and destructive
edits and are pruned per block. Restore uses the normal persistence and solve path and is
itself undoable.

Project backup uses SQLite's online backup API to create a consistent database file while
the app is running. Import validates the file and installs it as a new project. Versioned
block/plan JSON is a narrower portability format; imports create new blocks and report
references missing from the receiving project's data.

## Integration boundaries

- [Factorio bridge](./bridge) owns the versioned UDP contract and live save state.
- [AI assistant](./ai-assistant) owns model requests, tool permissions, proposals, and
  conversation persistence.
- [Desktop app and releases](./desktop) owns process launch, resource paths, native-window
  behavior, packaging, and updates.
- [Design system](./design) owns visual primitives, responsive behavior, async states, and
  interaction conventions.

Keep these integrations behind server or shell boundaries so the planner remains usable
without the Companion mod, an OpenRouter key, or a desktop runtime.

## Verification

Architecture changes should be tested at the narrowest owning layer, then through the
affected user flow:

- pure solver and utility behavior with Vitest;
- database behavior with isolated temporary SQLite files;
- server-function and component contracts with focused tests;
- user-facing flows and responsive layout with the standalone Playwright suite;
- Companion mod behavior through Factorio tests where game-free and a live reload where it
  depends on the game API.

Run `vp check` and `vp test` from `app/` before handoff. User-facing changes also require
main-flow E2E coverage and matching user documentation.
