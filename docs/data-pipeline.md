# Data pipeline

Everything in PyOps starts from the game itself. PyOps runs Factorio headlessly to
dump its fully-resolved prototype data, then imports it into SQLite. This is
orchestrated end-to-end from **Settings › Game data** in the UI
(`app/src/server/dump.ts`):

1. **Write a helper mod** (`pyops-dump`) into your Factorio mods folder and enable
   it. It sets `data.data_crawler = "yafc pyops"`, which makes `pypostprocessing`
   run its planner integration — TURD sub-techs become real technologies, farm
   recipes get representable fluids, etc. A `data-final-fixes.lua` then patches up
   anything that integration leaves engine-invalid (1.x-style recipe results,
   missing icons, broken TURD unlock effects) and exports the TURD
   recipe-replacement map as mod-data.
2. **Dump** via `factorio --dump-data`, `--dump-prototype-locale`, and optionally
   `--dump-icon-sprites`. (Icons load the *full* game/renderer and are slow, so
   they're opt-in; data + locale dump in seconds.)
3. **Disable the helper mod again** — it must never be active during normal play.
4. **Import** the dump into SQLite (`app/src/db/import-factorio.ts`), then
   synthesize the recipes the engine doesn't model as recipes: mining, boiling,
   burning, spoiling, and per-temperature fluid variants
   (`app/src/db/synthesize.ts`).
5. **Rebuild the icon atlas** (`scripts/build-icon-atlas.mjs`): pack the dumped
   sprites into content-hash-deduped 4096² sheets + a `(type, name) → slot`
   manifest, served `immutable`.
6. **Compute cost analysis** — a YAFC-style LP that assigns each good an intrinsic
   cost (`app/src/server/cost-analysis.ts`, a port of YAFC's `CostAnalysis.cs`).

The enabled mod set is fingerprinted (a hash of mod names) and stamped into the DB,
so the planner knows which version of the game its data reflects.

Saved blocks additionally carry a **per-block reference fingerprint**
(`blockReferenceFingerprint`, `app/src/db/queries.ts`): a hash over the *current*
definitions of just the recipes and goal goods that block references. Unlike the
global mod-name hash, it changes when a referenced recipe is altered in place (an
in-place mod update) or disappears, so staleness registers for exactly the blocks
that are affected. When a block references a recipe or goal good that no longer
exists, `computeBlock` refuses to solve it — solving the surviving subset would
silently produce wrong rates — and instead returns `broken` with the missing
references. The block's input doc and its last-good cached I/O are preserved
untouched (so re-enabling the mod or re-importing restores it), the block view and
sidebar flag it, and `recomputeAllBlocks` skips overwriting its cache. (Pure renames
are intended to be auto-applied during the dump — planned in #26 — so this broken
fallback is reserved for references that genuinely changed meaning or disappeared.)

## Why a helper mod

`pypostprocessing` already ships a YAFC/planner integration, but it triggers only
when a crawler marker is present and was written against YAFC's lenient Lua crawler
rather than the real engine validator. The `pyops-dump` helper supplies that marker
and then repairs the fallout so a real `--dump-data` run succeeds: it normalizes
1.x-style `result =` recipes, fills in missing icons and fluid-box volumes, drops
recipes whose result item never got created (and scrubs the now-dangling
`unlock-recipe` tech effects), and rebuilds TURD sub-tech unlock effects that the
integration leaves empty. It's strictly a dump-time tool — `dump.ts` enables it,
runs the dumps, and disables it again in a `finally` block so it never lingers for
normal play.

## Data model notes

The schema (`app/src/db/schema.ts`) models Factorio reference data plus PyOps'
own planning state (blocks, groups, TURD selections, cost analysis, meta). A few
deliberate choices:

- **Quality is not modelled** — Py has none.
- **Fluid temperatures are** — ingredients carry a min/max range, products an exact
  temperature; the synthetic-recipe pass generates per-temperature variants.
- **Energy is pseudo-fluids** — `pyops-electricity` and `pyops-heat` flow through
  the model as goods (1 unit = 1 MJ) so a reactor recipe gets sized to a block's
  heat draw, but they're filtered out of normal import/byproduct lists and surfaced
  separately as power/heat in watts.
