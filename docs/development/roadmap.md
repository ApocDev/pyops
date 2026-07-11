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
- **#25 closes epic #31** — it's the last open child of the planning-model epic.
- **#24 assumes #68's direction** — data-gated (not mod-detected) UI; #68 is
  closed with the nav gating shipped, but #24 inherits its philosophy.

## Wave 0 — DONE (2026-07-03)

Closed: #86, #95 (verified already-shipped), #79, #75, #84, #72, #54 (implemented
via parallel worktree agents, reviewed + live-verified on main). Follow-up filed:
#111 (dead package.json "pnpm" field) under epic #89, which stays open as the
standing toolchain bucket.

## Wave 1 — DONE (2026-07-03)

The safety net shipped: #82 (backup/share, closed), #90 (undo — server core +
Ctrl+Z UI + editor rehydration, closed), #85 (snapshots + diff, closed), #83
(destructive-action consistency — AlertDialog, counts in delete copy, undo
toasts; closes on push). #78 delivered its hotkey layer + minimal palette and
STAYS OPEN re-scoped to the remainder (goods search, recents, help sheet).

## Wave 2 — DONE (2026-07-03)

Planner correctness, all landed: #93, #92, #94, #96 (batch A), #25 (closed epic
#31), #99, #110's interim warnings (batch B), #113, #115 (batch C), then the
solver rewrite #91 (LP core, gesture model, IIS diagnosis, pins, whole machines
via #98, v1 deleted), #110's full temperature-identity model, and #114
(temperature-fed fluid drains). The solver details live in [Block solver](solver.md); the
tracker records the details.

## Wave 3 — DONE (2026-07-03)

The assistant batch (closes epic #30 with #72 from Wave 0): #11 coherence audit
tool (with data-driven byproduct disposal verdicts — the dump's 3159 pyvoid
recipes; corrected the prompt's wrong "hard mode cannot void" guidance), #12
revise recipe set (propose-then-apply beyond rates), #13 one-click follow-up
chips, #15 per-call gameEval approval gate (+ a pyops-allow-eval mod kill
switch), #14 push created blocks in-game. Conversational round-trips and the
mod-side kill switch still want a live pass (API key + game).

## Wave 4 — DONE except #107's visual pass (2026-07-03)

Batch A landed 2026-07-03: #87 (filtered-list primitive), #97 (recipe
explorer), #100 (dependency explorer), #80 (sortable machines table), and the
#78 palette remainder. Batch B landed 2026-07-03: #81 (shared query/route
error+loading convention), #106 (sticky page headers), #101 (block
sankey/flow view). #16 (help drawers) landed with Wave 5. **#107** (light theme)
shipped its mechanism — a working light/dark/system toggle — but STAYS OPEN for
the human visual contrast pass across every route (inherently a screenshot
review; light mode is now reachable to do it).

## Wave 5 — DONE (2026-07-03)

#76 sub-blocks v2 landed: a display-only row group can be promoted to a
separately-solved composed module whose only parent-facing surface is its
boundary contract (nested solveBlockLp → synthetic recipe the parent solves
over). Closes epic #33. Deferred follow-ups are noted in [Block solver](solver.md)
(user-editable per-group made, sub-block IIS cards, nested sub-blocks, sub-block
spoilRates).

## Wave 6 — live data + mod batch (closes epic #34)

Bridge + Lua context loads once; verification is hands-on in-game.

| Issue                                   | Effort | Notes                                                                                                                                       |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| #109 mod UI design pass                 | L      | The in-game panel design + completion (Blocks tab, summary layout, style pruning). Absorbs #4. Independent enough to pull forward whenever. |
| #4 summary panel width                  | M      | Folded into #109; the naive stretchable approach was tried and reverted — needs the layout rework.                                          |
| #88 below-plan alerts                   | M      | Live-data alerts against planned rates.                                                                                                     |
| #3 select machine in-game → focus block | M      | Bridge + protocol addition.                                                                                                                 |
| #102 train logistics math               | L      | Payload/cadence on factory links.                                                                                                           |
| #2 time-series metrics                  | XL     | Prometheus-style live factory data; the wave's big one.                                                                                     |

## Wave 7 — strategic finisher

| Issue                      | Effort | Notes                                                                                                                                                           |
| -------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #24 quality support (epic) | XL     | Broadening beyond Py. Everything before it makes it cheaper (LP solver, recipe synthesis coverage, data-gated UI per #68's shipped direction). Last on purpose. |

## Epics — close as children land

| Epic               | State after this audit                                             |
| ------------------ | ------------------------------------------------------------------ |
| #89 toolchain      | children done; stays open as a standing bucket (#111 landed there) |
| #31 planning model | **closed 2026-07-03** (#25 was the last child)                     |
| #30 assistant      | Wave 3 + #72                                                       |
| #33 composition    | #76 + #85                                                          |
| #35 UI/UX polish   | bulk of Waves 0/1/4                                                |
| #34 live data      | Wave 6                                                             |
