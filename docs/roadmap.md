# Implementation roadmap

The order for burning down the open issue backlog. Built from a full read of every
open issue (bodies, comments, cross-references) plus code verification of
"possibly already done" candidates, 2026-07-03. **The tracker is the source of
truth for _what_ each issue is; this file only records the _order_ and _why_.**

Maintenance: when a wave's issues close, delete its section. When new issues land,
slot them into a wave (or add one) as part of filing them. If this file and the
tracker disagree about an issue's state, the tracker wins — fix this file.

Effort key: **S** hours · **M** a day-ish · **L** multi-day · **XL** a week+.

## Sequencing constraints discovered in the issue bodies

These drive the wave order; violating them creates rework:

- **#78 before #90** — undo's Ctrl+Z rides the global hotkey layer that the
  command palette issue introduces. Build the hotkey layer first (the palette UI
  itself can trail).
- **#82 before #85** — snapshots build on the export/serialization format.
- **#90 before #83** — destructive-action consistency consumes undo (its
  soft-delete toast is explicitly superseded by real undo).
- **#91 before #98** — whole-machine MIP counts need the LP solve.
- **#25 closes epic #31** — it's the last open child of the planning-model epic.
- **#24 assumes #68's direction** — data-gated (not mod-detected) UI; #68 is
  closed with the nav gating shipped, but #24 inherits its philosophy.

## Wave 0 — DONE (2026-07-03)

Closed: #86, #95 (verified already-shipped), #79, #75, #84, #72, #54 (implemented
via parallel worktree agents, reviewed + live-verified on main). Follow-up filed:
#111 (dead package.json "pnpm" field) under epic #89, which stays open as the
standing toolchain bucket.

## Wave 1 — the safety net

The theme: after this wave, no edit in the planner is scary. Order matters
(constraints above).

| Issue | Effort | Notes |
|---|---|---|
| #78 command palette / hotkey layer | M | Pulled forward from UI polish: #90 needs its global-hotkey substrate. Ship the hotkey layer + a minimal palette; fancy search can iterate later. |
| #82 export/import backup | L | Project backup + shareable block/plan JSON. Also the serialization groundwork #85 builds on, and cheap insurance for user data. |
| #90 undo system | XL | The client prerequisite is **done** (doc store with clean `hydrate()`, shipped in v0.5.0 — see the issue comments). Remaining: the `undo_log` table + triggers migration, the mutation wrapper threaded through every mutating server fn (opt-out), action grouping, retention, Ctrl+Z + undo-menu UI, and pushing reverted docs into open editors. |
| #83 destructive-action consistency | M | **Done**: `ui/alert-dialog.tsx` + `ConfirmDialog` replaced every `window.confirm` (block delete states recipe/goal counts; project/mod/chat dialogs say they're not undoable); small undo-logged deletes fire immediately with an Undo toast (`deletedToast` in `lib/undo-client.ts`). |
| #85 plan snapshots | L | Named restore points, diff, restore-into-open-editor (same `hydrate()` plumbing as undo). Closes epic #33 together with #76. |

## Wave 2 — planner correctness (batch: solver + data context)

| Issue | Effort | Notes |
|---|---|---|
| #93 `ignored_by_productivity` bug | M | The only open `bug`. Per-product flag treated all-or-nothing; affects solve accuracy. |
| #92 research-driven productivity | L | Mining productivity + per-recipe productivity techs applied to solves, gated on the research horizon. |
| #94 reactor neighbour bonus | M | Heat generation modelling tweak; independent, slot anywhere in the wave. |
| #96 synthesize planting/agriculture + rocket products | L | Data-pipeline pass 2 additions; directly affects existing Vrauk/Native-flora-style blocks. |
| #25 fluid-fuel energy commodity | L | `energy:fluid` fungible demand. **Closing this closes epic #31.** |
| #110 fluid-temp variants as distinct goods | L | YAFC-style (fluid, temperature) identity in the solve; range consumers pool matching variants. Land the cheap interim first (per-producer temp warnings — S), full model with/after #91. |
| #91 solver v2: LP (HiGHS) | L | The wave's centerpiece; gate for #98, a foundation #76 wants, and the natural home for #110's range-pooling. |
| #98 whole-machine mode (MIP) | M | Integer building counts on top of #91. |
| #99 module templates | M | Partially done (a `module_presets` table + save/load shipped). Remaining: template icons, real compatibility filtering, default/auto-apply. |

## Wave 3 — assistant (closes epic #30 with #72 from Wave 0)

| Issue | Effort | Notes |
|---|---|---|
| #11 coherence audit tool | M | Labeled `priority: next`. **Scope-check first**: the audit found `turdConsistency`'s factory-wide checks already cover part of this — confirm what's genuinely missing before building. |
| #12 revise recipe set | M | Completes propose-then-apply beyond rate changes; the doc store's `hydrate()` makes live-editor updates work. |
| #13 one-click follow-ups | S | Draft sub-block / route byproduct buttons on assistant output. |
| #15 gameEval approval gate | M | Per-call approval UI for in-game Lua eval. |
| #14 push block in-game | S | Cybersyn blueprint / bridge show from the assistant. |

## Wave 4 — UI leverage (mostly epic #35)

`#87 first` — three other issues want the primitive it extracts.

| Issue | Effort | Notes |
|---|---|---|
| #87 shared filtered-list primitive | M | Six pages hand-roll search; consumed by #78's palette iteration, #97, #100. |
| #97 recipe explorer | L | Ranked producers/consumers per good. |
| #100 dependency explorer | L | Transitive requires / required-by. |
| #80 Machines card on sortable table | M | Factory page consistency. |
| #81 error/loading states | M | The issue's "zero isError checks" premise is stale (nine exist now); remaining: root-level errorComponent/pendingComponent + a shared convention for the rest, incl. the two hand-rolled overlays noted when #86 closed. |
| #106 sticky page toolbars | S | |
| #16 help drawers | L | Images, worked examples, deeper coverage. |
| #101 sankey flow view | L | Visualization of solved block flows. |
| #107 light theme pass | M | Last in the wave, so it sees every new surface. |

## Wave 5 — composition

| Issue | Effort | Notes |
|---|---|---|
| #76 sub-blocks v2 | XL | Separately-solved modules with hidden internal goals. Deliberately after #91 (nested solves) and #90 (deep doc-model surgery with a safety net). Closes epic #33. |

## Wave 6 — live data + mod batch (closes epic #34)

Bridge + Lua context loads once; verification is hands-on in-game.

| Issue | Effort | Notes |
|---|---|---|
| #109 mod UI design pass | L | The in-game panel design + completion (Blocks tab, summary layout, style pruning). Absorbs #4. Independent enough to pull forward whenever. |
| #4 summary panel width | M | Folded into #109; the naive stretchable approach was tried and reverted — needs the layout rework. |
| #88 below-plan alerts | M | Live-data alerts against planned rates. |
| #3 select machine in-game → focus block | M | Bridge + protocol addition. |
| #102 train logistics math | L | Payload/cadence on factory links. |
| #2 time-series metrics | XL | Prometheus-style live factory data; the wave's big one. |

## Wave 7 — strategic finisher

| Issue | Effort | Notes |
|---|---|---|
| #24 quality support (epic) | XL | Broadening beyond Py. Everything before it makes it cheaper (LP solver, recipe synthesis coverage, data-gated UI per #68's shipped direction). Last on purpose. |

## Epics — close as children land

| Epic | State after this audit |
|---|---|
| #89 toolchain | children done; stays open as a standing bucket (#111 landed there) |
| #31 planning model | **one issue away** (#25) |
| #30 assistant | Wave 3 + #72 |
| #33 composition | #76 + #85 |
| #35 UI/UX polish | bulk of Waves 0/1/4 |
| #34 live data | Wave 6 |
