# Data pipeline

Everything in PyOps starts from the game itself. PyOps runs Factorio headlessly to
dump its fully-resolved prototype data, then imports it into SQLite. This is
orchestrated end-to-end from **Settings › Game data** in the UI
(`app/src/server/dump.server.ts`):

1. **Write a helper mod** (`pyops-dump`) into your Factorio mods folder and enable
   it. It sets `data.data_crawler = "yafc pyops"`, which makes `pypostprocessing`
   run its planner integration — TURD sub-techs become real technologies, farm
   recipes get representable fluids, etc. A `data-final-fixes.lua` then patches up
   anything that integration leaves engine-invalid (1.x-style recipe results,
   missing icons, broken TURD unlock effects) and exports the TURD
   recipe-replacement map as mod-data.
2. **Dump** via `factorio --dump-data`, `--dump-prototype-locale`, and optionally
   `--dump-icon-sprites`. (Icons load the _full_ game/renderer and are slow, so
   they're opt-in; data + locale dump in seconds.)
3. **Disable the helper mod again** — it must never be active during normal play.
4. **Import** the dump into SQLite (`app/src/db/import-factorio.ts`), then
   synthesize the recipes the engine doesn't model as recipes: mining, boiling,
   burning, spoiling, planting (agricultural towers), rocket launches, and
   per-temperature fluid variants (`app/src/db/synthesize.ts`). Recipe categories
   come from Factorio 2.1's `categories` array, with the singular 2.0 `category`
   field retained as an import fallback.
5. **Rebuild the icon atlas** (`buildIconAtlas`, `app/src/server/icon-atlas.ts`):
   pack the dumped sprites into content-hash-deduped 4096² sheets + a
   `(type, name) → slot` manifest, written to the data dir's `icon-data/`. The app
   serves them at `/icons/*` (`app/src/routes/icons.$.ts`), cached `immutable` and
   cache-busted by the data fingerprint in the sheet URLs (`?v=…`).
6. **Compute cost analysis** — a YAFC-style LP that assigns each good an intrinsic
   cost (`app/src/server/cost-analysis.server.ts`, a port of YAFC's `CostAnalysis.cs`).
7. **Apply mod migrations** — read each enabled mod's `migrations/*.json` and
   auto-apply any newly-present prototype renames to saved blocks
   (`app/src/server/migrations.ts`; see drift resilience below).
8. **Refresh solve projections** — advance the SQLite-owned solve generation and
   re-solve each stale saved block once, after every reference-data writer has
   finished. Factory totals therefore never depend on an application cache or on
   remembering which in-memory layer to invalidate.

The enabled mod set is fingerprinted (a hash of mod names) and stamped into the DB,
so the planner knows which version of the game its data reflects. The full mod list
is persisted alongside it (`mod_list` in `meta`): each mod's name, **version**, and
enabled state (`readMods`, `app/src/server/dump.server.ts` — `mod-list.json` carries only
name + enabled, so versions are recovered from the `name_x.y.z.zip` entries in the
mods directory). This records the provenance of the reference data — shown on the
Settings → Game data tab — and gives drift detection and rename capture
a concrete previous state to diff against, not just a hash.

**Drift detection** (`modDriftFn`, `diffMods`/`redumpNeeded` in `dump.server.ts`) compares
the game's _current_ mod set against that persisted baseline, by name **and**
version, and categorizes the change (added / removed / enabled / disabled /
version-changed). `needsRedump` is true only when the _enabled_ mods or their
versions changed (disabled-mod churn doesn't affect the data). When drift is
detected a **guided modal** (`DriftModal`, opened via the shared `drift-store`)
pops with the categorized changes and an ignore/re-sync choice, then walks the dump
as a step-by-step progress flow (`lib/sync-steps.ts` maps each `SyncPhase` to a
labelled step) ending in a summary that links to the Factory block change-report. It
re-checks on app start, on project switch (a full reload), on bridge reconnect
(Factorio likely restarted), and every couple of hours; an ignored drift leaves a
small "data stale" chip in the nav to re-open the modal, and Settings → Game data
shows the same detail. Reading the mod set is cheap (two small file reads), so
checking often costs little.

Saved blocks additionally carry a **per-block solve fingerprint**
(`blockReferenceFingerprint`, `app/src/db/queries.server.ts`): a hash over the _current_
definitions of just the recipes and goal goods that block references, prefixed by
the current `solve_projection_generation` from SQLite `meta`. The generation
advances when imported reference data, research/productivity state, or TURD
selection changes. It makes projection validity a database fact: unchanged bridge
heartbeats do not advance it, and only rows from the current generation are treated
as fresh. The content hash still pinpoints an altered or vanished referenced recipe.

When a block references a recipe or goal good that no longer exists, `computeBlock`
refuses to solve it — solving the surviving subset would
silently produce wrong rates — and instead returns `broken` with the missing
references. The block's input doc and its last-good cached I/O are preserved
untouched (so re-enabling the mod or re-importing restores it), the block view and
sidebar flag it, and its old generation stamp remains stale rather than blessing
the preserved values as current.

**Pure renames are auto-applied during the dump** (`migrations.ts`), so this broken
fallback is reserved for references that genuinely changed meaning or disappeared.
Mods ship declarative `migrations/*.json` files (`{ "recipe": [["old","new"], …],
"item"/"fluid"/"entity": … }`) inside their zips; a mod's own Lua runtime can't read
other mods' migration files, but the backend reads them straight from the zips (via
`fflate`) or unpacked folders. Each dump records which migration files it has seen
(`migrations_applied` in `meta`, keyed by `mod/file`); a file newly present since the
last dump is a new rename, applied across every saved block's references — the
`goals`, `recipes`, the recipe-keyed `machines`/`fuels`/`modules`/`beacons` and
their member names, disposition keys, and `iconName`. The **first** run after this
ships only records the baseline and applies nothing (existing blocks already
reference current names), so renames fire only on a genuine future mod update. The
`.lua` migration files are procedural save-state scripts, not renames, and are
skipped.

## Why a helper mod

`pypostprocessing` already ships a YAFC/planner integration, but it triggers only
when a crawler marker is present and was written against YAFC's lenient Lua crawler
rather than the real engine validator. The `pyops-dump` helper supplies that marker
and then repairs the fallout so a real `--dump-data` run succeeds: it normalizes
1.x-style `result =` recipes, fills in missing icons and fluid-box volumes, drops
recipes whose result item never got created (and scrubs the now-dangling
`unlock-recipe` tech effects), and rebuilds TURD sub-tech unlock effects that the
integration leaves empty. On Factorio 2.1 it also evicts the Py modules that the
integration intentionally re-runs after resetting their globals, avoiding stale
`require` cache results. It's strictly a dump-time tool — `dump.server.ts` enables
it, runs the dumps, and disables it again in a `finally` block so it never lingers
for normal play.

## Data model notes

The schema (`app/src/db/schema.ts`) models Factorio reference data plus PyOps'
own planning state (blocks, groups, TURD selections, cost analysis, meta). A few
deliberate choices:

- **Quality is not modelled** — Py has none.
- **Fluid temperatures are** — ingredients carry a min/max range, products an exact
  temperature; the synthetic-recipe pass generates per-temperature variants.
- **Energy is pseudo-fluids** — `pyops-electricity`, `pyops-heat`, and
  `pyops-fluid-fuel` flow through the model as goods (1 unit = 1 MJ). Electricity
  and heat are filtered out of normal import/byproduct lists and surfaced
  separately as power/heat in watts; fluid fuel is a real matched flow (#115) that
  shows as an explicit "Fluid fuel (MJ)" import/export, rendered in power units.
  Reactors also persist their prototype's `neighbour_bonus`
  (`crafting_machines.neighbour_bonus`, #94) so the solver can scale heat output
  for an assumed reactor-farm layout.
- **Fluid fuel is fungible** (#25) — fluids carry no fuel category; an unfiltered
  `burns_fluid` energy source (Py: glassworks, smelter, antimony drills, the oil
  boiler) accepts _any_ fluid with a `fuel_value`, so those machines draw MJ from
  the shared `pyops-fluid-fuel` pool, fed by one synthetic `burn-fluid-<fluid>`
  conversion per fuel-valued fluid (1 unit → its `fuel_value` in MJ; 59 in the Py
  dump). A `fluid_box.filter` on the energy source pins the machine to that one
  fluid instead (Py oil/gas powerplants). `burns_fluid: false` sources are
  **temperature-fed** (#114): they drain their filter fluid for its heat content
  (Py uf6 reactors, compost plants, the solar tower). The import derives their
  drain via `db/fluid-energy.ts` and stores it on `crafting_machines`:
  `fluid_fuel_per_sec` (a fixed units/s — an explicit `fluid_usage_per_tick`, or
  the engine's derivation from the source's `maximum_temperature`, e.g.
  nuclear-reactor-mk01's 300 kW ÷ ((250° − 0.01°) × 20 J/°) ≈ 60.0024 uf6/s) and
  `fluid_fuel_energy_j` (usable J per unit — `scale_fluid_usage` sources like the
  compost plants follow the energy draw instead). `crafting_machines` carries
  `burns_fluid` + `fluid_fuel_filter`, and burner/fluid `effectivity` is folded
  into the stored `energy_usage_w` (fuel draw = energy ÷ effectivity).
- **Logistics prototypes** — `belts`, `loaders`, and `inserters` tables capture the
  bits needed to size belt/inserter counts per block row (the **Logistics** display,
  issue #21): belt/loader `speed`, and per-inserter `rotation_speed` /
  `extension_speed` / pickup+drop vectors / `bulk` / `max_belt_stack_size`. Stacking
  research lives in `tech_stack_bonuses` (one row per tech per effect:
  `belt-stack-size-bonus`, `inserter-stack-size-bonus`, `bulk-inserter-capacity-bonus`),
  summed over the in-effect tech set (`queries.stackBonuses`, following the research
  horizon) to derive the current belt placed-stack and inserter hand stack. The
  throughput math is a pure module (`app/src/lib/logistics.ts`) — belts are
  `speed × 480 × stack`; inserters use the swing model ported from the in-game
  `inserter-throughput-lib` (inventory→inventory case). The per-row arithmetic runs
  client-side so changing belt/inserter tier is instant (no re-solve).
- **Research productivity** (#92) — `tech_productivity_bonuses` captures the two
  flat-productivity tech effects (one row per tech per target): Factorio 2.0
  `change-recipe-productivity` keyed by its target recipe, and
  `mining-drill-productivity-bonus` under the sentinel key `''` (applies to every
  synthetic mining recipe). `queries.productivityBonuses` sums those over the
  in-effect tech set (gated by the research horizon like `stackBonuses`) and
  applies them in the solver's effects stage; in NOW mode, a
  `research_mining_productivity_bonus` meta value overrides the mining sum with
  an exact force bonus, including repeatable levels. The bridge sync writes that
  value from the running save, and the Planning horizon control can set it
  manually for modless play. The bridge also writes
  `research_recipe_productivity_bonuses`, an exact per-recipe map read from
  `LuaRecipe.productivity_bonus`; without that map, recipe productivity is derived
  from the researched-tech list. Recipes also carry
  `maximum_productivity` (the 2.0 productivity cap; NULL = engine default +300%
  — Py sets 1e6 on nearly every recipe).
- **Rocket logistics** (issue #22) — `items.weight` (rocket-lift weight) feeds an
  optional launches/min readout: `floor(rocket_lift_weight / weight)` per rocket,
  then `rate × 60 / capacity`. `rocket_lift_weight` and `default_item_weight` come
  from `utility-constants.default` (stashed in `meta` at import). Only ~15% of items
  set an explicit `weight`; the rest are runtime-derived from recipes, which Py's
  cyclic graph makes impractical to recompute, so unset items fall back to
  `default_item_weight` (flagged in the tooltip as an estimate).
