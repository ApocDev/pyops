---
title: Data pipeline
description: Follow Factorio reference data from a headless dump through normalization, synthesis, SQLite import, cost analysis, icons, drift detection, and block refresh.
outline: [2, 3]
---

# Data pipeline

PyOps derives its planning model from the user's Factorio installation instead of shipping
a fixed recipe database. A sync runs Factorio against the enabled mod set, imports the
resolved prototypes into the active project, and refreshes every projection that depends
on them.

The orchestrator is `app/src/server/dump.server.ts`. The user-facing workflow is documented
under [Sync game data](../getting-started/sync-game-data).

## Pipeline overview

A complete sync runs these stages in order:

1. Verify that Factorio is not already running.
2. Write and enable the temporary `pyops-dump` helper mod.
3. Run `factorio --dump-data`.
4. Run `factorio --dump-prototype-locale`.
5. Optionally run `factorio --dump-icon-sprites`.
6. Disable the helper mod.
7. Import prototypes and localized names into the active project database.
8. Synthesize planner recipes for engine behavior without ordinary crafting recipes.
9. Optionally rebuild the generated icon atlas.
10. Compute intrinsic good and recipe costs.
11. Apply newly discovered declarative prototype renames to saved blocks.
12. Record mod provenance, advance the solve-projection generation, and refresh stale
    blocks.

`startDataSync()` returns immediately and runs the work in the server process. The UI polls
`syncState()` and maps each `SyncPhase` through `app/src/lib/sync-steps.ts` to render the
progress dialog.

Icon dumping is optional because it starts the full game renderer and is substantially
slower than prototype and locale dumping. An ordinary data sync reuses the existing atlas.

## Failure safety

Factorio holds an exclusive lock on its user-data directory. The sync checks the process
list before changing `mod-list.json`; if detection is unavailable, the dump attempt remains
the fallback and known lock errors are translated into the same user-facing message.

Once the helper is enabled, all Factorio dump commands run inside a `try/finally` that
disables it again. The helper changes planner-facing prototypes and must never remain
enabled for normal play.

Factorio can exit successfully even when the data stage printed an error. The command
wrapper therefore checks captured output for Factorio's error banner rather than trusting
the exit code alone.

The prototype-table replacement and synthetic pass run through the import transaction.
Mod provenance and the solve generation are written only after import, optional atlas work,
cost analysis, and rename application have completed. A failed run retains its phase, raw
diagnostic log, friendly error, and completion timestamp for the UI.

## Dump helper

`writeHelperMod()` creates `pyops-dump` in the Factorio mods directory. Its crawler marker
activates the planner integration supplied by `pypostprocessing`, allowing Py-specific
structures such as TURD choices and smart-farm behavior to appear in the dump.

The planner integration targets a permissive crawler, while PyOps invokes Factorio's real
prototype validator. The helper's data stages normalize the resulting prototypes so the
engine can complete the dump. Among other repairs, it:

- normalizes recipe result shapes;
- supplies required icons and fluid-box volumes;
- removes recipes whose result prototype does not exist and cleans their unlock effects;
- rebuilds TURD sub-technology unlock effects;
- clears selected Lua module-cache entries before Py recreates reset prototype tables;
- exports TURD recipe replacements through a `mod-data` prototype.

The importer identifies a TURD choice structurally from its master technology and synthetic
selection gate. The helper's replacement map becomes `turd_replacements` rows used when a
project applies a branch selection.

## Prototype import

`app/src/db/import-factorio.ts` parses `data-raw-dump.json` and every sibling
`*-locale.json` file. It replaces reference tables in the active SQLite database while
leaving user-owned planning tables intact.

A large modpack's dump can be bigger than V8's maximum string length (about 512 MB), so the
importer never decodes it as one string. `app/src/db/read-dump.ts` scans the raw bytes for
each top-level prototype type and parses each type's slice on its own.

Project metadata is not a reference table. Only a handful of its keys describe the dump, and
the importer overwrites exactly those; everything else in it belongs to someone else and
survives a sync untouched. That includes display preferences, the research horizon, factory
pins, the live research, built-machine, production-stat, and branch-selection state the mod
bridge syncs in, and the applied-rename baseline — clearing that last one would silently
re-baseline mod renames, so a pending rename would never reach saved blocks.

After both import passes complete, the importer writes `data_format_version` to project
metadata. `REFERENCE_DATA_FORMAT_VERSION` in `app/src/lib/data-format.ts` describes the
meaning of normalized reference rows, independently of the SQLite schema version. The shared
reference-data drift check compares the stored and current versions alongside mod drift. A
non-empty project with a missing or different version gets the existing re-sync prompt; an empty
project remains in the normal first-sync flow.

### Reusing an existing dump

Factorio writes each dump into `script-output` and nothing removes it, so the previous
`data-raw-dump.json` is always still there. A sync can therefore skip the game entirely and
re-import that file, which is the right move whenever the importer changed but the game did
not — and it is the only path that works while Factorio is running, since producing a dump
needs the engine's instance lock.

Whether reuse is sound depends on two facts the file's timestamp cannot carry. The enabled
mod set may have changed, in which case the game would now dump different prototypes; this
reuses the existing mod-drift signal. The dump helper may also have changed, and because the
helper patches prototypes during the dump, its edits are part of the file's meaning.

Every project reads the same dump file, so the helper's fingerprint is stored with the file.
Right after `--dump-data`, the sync writes `pyops-dump-provenance.json` next to
`data-raw-dump.json`, holding a fingerprint of the helper's sources, the dump's
modification time, and the game's `base` mod version. The sync reads that version from
`data/base/info.json` in the install that holds the game binary, because `base` is not in
the mods folder. The reuse check trusts that sidecar only when its time matches the file
on disk. Without a matching sidecar, as for a dump made before the sidecar existed, it falls
back to the fingerprint the project stamped into `meta`, but only if that project imported
this same file. Otherwise the helper is unknown, which warns but does not block reuse.

Each sync also stamps `dump_mtime` and `dump_helper_fingerprint` into the project's `meta`,
recording which dump it imported. A reuse run stamps the dump's own helper, not the current
one. The decision is a pure function over these readings, so it can be tested without a
filesystem.

### Normalization

The importer converts Factorio's flexible prototype shapes into stable relational rows:

- recipes, ingredients, products, categories, unlocks, and technologies;
- items, fluids, machines, mining drills, modules, beacons, labs, and fuels;
- energy-source details, pollution, crafting categories, and allowed effects. A stored
  `allowed_effects` of null means every effect and `[]` means none. A prototype that sets
  the key, even to an empty table, is taken as written. A missing key falls back to its
  type's default: none for crafting machines, every effect for labs and mining drills.
  Boilers, generators, pumps, reactors, and agricultural towers are not effect receivers
  and store `[]`;
- each module's quality effect (`eff_quality`) and each recipe's `allow_quality` (engine
  default true). Quality output is not modelled, so these only gate module choice: a
  module with a positive quality effect never reaches a machine whose `allowed_effects`
  lacks quality, and the pickers, templates, and auto-fill never offer one. Pyanodons has
  no module with a positive quality effect, so this changes nothing there;
- each electric machine's and lab's constant drain (`drain_w`). The dump only has a `drain`
  key when the prototype sets one; otherwise the engine default applies, which is
  `energy_usage / 30` for crafting machines (assembling machines, furnaces, rocket silos) and
  zero for labs, mining drills, and other types. Null for non-electric sources;
- each crafting machine's, mining drill's, and lab's effect receiver: its base effect, effect
  limits, and whether modules and beacons apply (engine defaults filled in; null when the
  prototype sets none). Quality's base effect and limits are stored too (default limits
  0 to 1000), though nothing reads them yet;
- each recipe's `allow_speed`, `allow_consumption`, and `allow_pollution` (engine default
  true). Module placement does not read them yet;
- quality prototypes and the other quality fields (see [Quality data](#quality-data));
- logistics prototypes and technology-driven stack bonuses;
- productivity effects, TURD replacements, and rocket constants.

Labs are normalized separately from crafting machines. A lab has no crafting category and
runs no recipe: it consumes the science packs a technology names, at its researching speed,
over that technology's unit time. The `labs` table therefore stores the researching speed and
the ordered list of packs the lab accepts, which is the authoritative answer to what research
consumes — science packs are also ordinary recipe ingredients, so lab demand and recipe demand
are separate and additive. A lab's allowed module categories matter as much as a machine's:
Pyanodons' lab has no module slots and disallows speed effects, and its only modifier is an
external beacon driven by the Vatbrain biocomputer, whose module category no other prototype
accepts.

Technologies record both ways a research cost can be expressed. Lab-researched technologies
carry a unit count and unit time, and unit count multiplied by unit time gives the total lab
seconds. Trigger technologies are researched by performing an action instead, so they have no
unit at all; the importer stores the raw trigger prototype for display, and the unit columns
are null exactly when a trigger is present.

Recipe products with ranges are represented by their expected amount for planning. Product
probability, temperature, productivity exclusions, and the original range remain available
where the solver or UI needs them. The parser accepts the prototype variants Factorio may
emit, including recipe category arrays and singular categories. For Factorio 2.1 products it
stores the effective chance: the independent probability multiplied by the width of the shared
probability range. Legacy dumps with a single probability field remain supported.

Localized display names come from the locale dumps. When a recipe or machine inherits its
name from a product or placeable item, the importer uses that localized prototype name as a
fallback. Internal prototype names remain database keys.

### Synthetic recipes

Factorio models several production mechanisms outside ordinary crafting recipes.
`app/src/db/synthesize.ts` turns them into the same recipe/machine vocabulary used by the
block solver:

| Kind          | Planner representation                                      |
| ------------- | ----------------------------------------------------------- |
| Mining        | Resource products crafted by compatible drills              |
| Pumping       | Offshore-pump production                                    |
| Boiling       | Per-megawatt fluid heating recipes                          |
| Generation    | Machine and input-temperature-specific electricity recipes  |
| Fluid burning | Fuel-valued fluid converted into a shared energy good       |
| Spoiling      | Passive item-to-result conversion without a machine         |
| Planting      | Seed, growth time, agricultural tower, and harvest products |
| Rocket launch | Rocket parts and payload converted into launch products     |
| Research      | One science pack converted into research by a lab           |

Every synthetic row records a `kind` and `source_entity`, allowing the UI and downstream
logic to distinguish it from an ordinary craft without special name parsing.

### Research

A lab is its own prototype type with no crafting category, so the block solver cannot see
it. Synthesis registers each lab as a crafting machine under an invented research category
and gives that category one recipe per science pack the lab accepts: one pack becomes one
unit of research.

This makes a science consumer an ordinary block. Its rows are labs, so they take machines,
modules and beacons through the normal path — which is how Pyanodons' vatbrains apply, since
a vatbrain is a beacon broadcasting a productivity module that only labs accept. Because the
recipes allow productivity, a row's goal is the post-effects research rate and the pack
demand the solver derives from it is the pre-effects rate the factory must supply.

Each pack gets its own research good rather than contributing to a shared pool. A single
pool would let the solver satisfy a research target with whichever pack is cheapest instead
of the mix a lab actually consumes.

There is one recipe per pack, not one per technology. The pack mix is a property of what is
being researched, which a planner expresses by setting each row's rate; per-technology
recipes would add a row for every technology to say the same thing. Completion time is a
calculation over technology unit counts and unit times rather than a recipe.

A lab has no module slots of its own and does not accept speed effects, so its only modifier
is an external beacon. Pyanodons delivers that through the Vatbrain biocomputer: a machine
that consumes brain cartridges and, while it runs, has a script insert a productivity module
into a co-located hidden beacon. Both that beacon and its modules are hidden prototypes,
since a script rather than a player places them — so the picker surfaces a hidden beacon or
module only when the machine accepts a category that nothing visible carries. Matching on
categories rather than names keeps the rule free of mod knowledge, and a normally-moddable
machine still sees only its normal options. The dump helper reconstructs the machine and its
per-tier mapping — it lives in control-stage Lua the data stage cannot require — and exports
it as mod-data, the same route already used for branch replacements. Synthesis finds the
hidden carrier from the tier modules' category: the hidden beacon that accepts that category
and the fewest others. That picks Pyanodons' `hidden-beacon-vatbrain` over its TURD carrier,
which also accepts vatbrains, without depending on the carrier's name. Synthesis then turns
the mapping into a real, visible beacon named for the building actually placed, carrying the
carrier's distribution characteristics, the building's own power, and only the module
categories its tiers broadcast. The picker then
offers the biocomputer rather than a hidden prototype, and the sole-carrier rescue stops
firing because a visible beacon now covers the category.

Each tier's cartridge becomes beacon upkeep. The script enables the beacon only while the
craft runs, so the drain is a precondition for the effect rather than an optional cost: it
joins the block balance per beacon building, exactly as burner fuel does, and the factory
must source it.

Pyanodons also disables a machine whose AM/FM beacons interfere. Its control script compares
the beacons reaching a machine: with the `future-beacons` startup setting on, two of them may
not share an AM level or an FM level; with it off, they may not share both. The dump helper
reads the setting and exports the rule as mod-data. Each AM/FM beacon gets a list of groups
(`AM2` and `FM3`, or the single pair `AM2-FM3`), stored in `beacons.interference`. Two
beacons on one machine interfere when they share a group. The script's exempt alien-life
buildings are exported with every `-mk0x` tier spelled out and stored as
`crafting_machines.beacon_interference_exempt`. `app/src/lib/beacon-interference.ts` applies
the rule.

A lab consumes one of each pack per unit of research, so pack rates do not depend on the
recipe's craft time and are modelled exactly. Only the building count is time-sensitive:
real unit times span half a minute to twenty minutes across the technology tree, so the
recipe uses a representative craft time and a row's lab count is a reference figure.

## Modelling conventions created during import

### Temperature identity

Fluid ingredients retain minimum and maximum temperatures; products retain their exact
temperature. The compute layer expands relevant fluid flows into temperature-qualified
identities before solving and folds them back into localized fluid rows for display.

Generators receive one synthetic recipe for each usable input temperature because output
depends on available thermal energy. Temperature-fed machines store the drain information
required to turn their heat source into a real solver flow.

Ordinary solar panels plan at their full-day average: `performance_at_night` blended toward
`performance_at_day` by the day's average sunlight, scaled by Nauvis' `solar-power`
percentage. The day/night thresholds (`dusk`, `evening`, `morning`, `dawn`) are runtime
surface values that the data dump doesn't contain, so the import uses Factorio's defaults
(0.25, 0.45, 0.55, 0.75). Full sun until dusk and from dawn, darkness from evening to
morning, and linear fades between them average 0.7. The recipe keeps the night output as its
minimum and the noon output as its maximum.

Solar-panel prototypes with a custom `solar_coefficient_property` use the matching Nauvis
surface property as their planning multiplier. When the mod also publishes matching
`-min` and `-max` properties, the synthetic recipe retains that range while the solver uses
the planner value. Py wind turbines, for example, publish their average wind speed for
planners and their runtime speed bounds separately. Synthetic generator machines use the
item named by `placeable_by`, so building research gates hidden child entities correctly.
Alternate `-blank` runtime states that point to the same placeable item are not exposed as
duplicate recipes.

### Quality identity

The solver does not model quality, but the stored data has room for it. Normal quality is
always written as no quality at all. `block_flows`, `block_machines`, and `built_machines`
have a nullable `quality` column, and null means normal, so every Py row reads the same as
before. Block documents have no quality field, so every existing document reads as
all-normal.

The importer records whether the dump has quality in the `has_quality` metadata key, which
`dataCapabilities()` reports as `hasQuality`. It is true only when the dump's `normal`
quality has a `next` level, which only the quality mod sets. A recycler is not enough: the
Py dump has the `recycler` furnace and its recycling recipes, but normal is its only quality.
A project imported before the key existed reports `hasQuality: false` until its next sync.

### Quality data

The importer reads everything quality needs from the dump, but the solver does not use it
yet. A dump only holds the values a mod set, so the importer fills in Factorio 2.1's
documented defaults (`QualityPrototype` and `RecipePrototype` in
`doc-html/prototype-api.json`). `db/quality-import.ts` holds those rules.

- `qualities` has one row per quality prototype: `level`, `next`, `next_probability`,
  `chain_probability`, `hidden`, and the multipliers and bonuses the planner needs. With
  `default_multiplier` = 1 + 0.3 × level, the module, crafting speed, and lab speed
  multipliers default to it. Slot bonuses default to the level, `tool_durability_multiplier`
  to 1 + level, `chain_probability` to `next_probability` × 0.1 clamped to [0, 1], and the
  rest to 1. The Py dump has only `normal` (no `next`) and the engine's hidden
  `quality-unknown` placeholder. The quality mod adds uncommon, rare, epic, and legendary.
- `modules` stores each module's `<effect>_quality_multiplier`: how much of the module
  quality's multiplier each effect gets. Unset, it is 1 for a beneficial effect (positive
  speed, productivity, and quality; negative consumption and pollution) and 0 for a penalty.
- `tech_quality_unlocks` records `unlock-quality` technology effects, so the research horizon
  can tell which qualities are reachable.
- Machines store the flags that opt into quality bonuses. `crafting_machines` has
  `quality_affects_module_slots`, `quality_affects_energy_usage`, and the per-quality override
  maps `crafting_speed_quality_multiplier`, `energy_usage_quality_multiplier`, and
  `module_slots_quality_bonus`. These are false or null on the drill, lab, boiler, and
  generator rows pass 2 adds. `mining_drills` and `beacons` have `quality_affects_module_slots`,
  and `beacons` also has `distribution_effectivity_bonus_per_quality_level` (0.2 on vanilla
  and Py beacons). `labs` has `quality_affects_module_slots` and `uses_quality_drain_modifier`.
- `recipes.can_set_quality` says whether a recipe can run above normal. Unset, it is true
  for a parameter recipe or one with an item ingredient that sets none of `quality_min`,
  `quality_max`, and `quality_change`. So a recipe with only fluid ingredients runs at normal,
  though quality modules can still upgrade its products. Synthetic recipes from pass 2,
  including research, are always false. Fluids never have quality.

Factorio 2.1.7 divided every prototype quality effect by 10, multiplied `next_probability`
by 10, and added `chain_probability`. A dump taken with a `base` version older than 2.1.7 is
brought to the 2.1 scale. The importer gets that version from the dump's provenance sidecar.
When no version is known, such as a reused dump whose sidecar predates the field, it falls
back to the dump itself: the base game sets `chain_probability` on `normal` from 2.1.7 on, so
a `normal` without it reads as the older scale. A mod set could drop that field, which is why
the version decides whenever there is one. The `quality_scale_basis` metadata key and the sync
log record which path decided, and `factorio_version` holds the base version or `unknown`.
Module quality effects and a receiver's base quality effect are divided by 10. Each
quality's `next_probability` is multiplied by 10, and its raw value becomes the chain
probability, since 2.0 used it for every further step. The engine also floors a module's
quality-scaled quality effect more coarsely in 2.0. The importer records that precision in
the `quality_effect_step` metadata key: 0.0001 for 2.1 and 0.001 for 2.0.

### Energy goods

Electricity, heat, and fungible fluid-fuel energy use synthetic goods measured in
megajoules:

- `pyops-electricity` represents electrical production and machine draw;
- `pyops-heat` represents reactor and heat-system output;
- `pyops-fluid-fuel` represents energy supplied by an unfiltered fluid-burning source.

A rate of one unit per second equals one megawatt. Electricity and heat are presented in
power summaries rather than ordinary material imports. Fluid fuel remains an explicit
boundary flow because a designated supplier block can cover it.

Filtered fluid energy sources remain tied to their required fluid. Temperature-fed sources
derive usable joules per unit and either a fixed drain or an energy-following drain from the
prototype's fluid box and energy-source fields. Burner and fluid-source effectivity is
folded into stored energy use. For a temperature-fed source that folded figure only sizes the
fluid drain (Py's compost plant: 1 MW at effectivity 1000 stores 1 kW), so its block row
reports the drain as fuel and a power draw of zero.

### Logistics and research effects

Belts, loaders, and inserters store only the prototype fields needed by
`app/src/lib/logistics.ts`. An inserter's `base_stack_bonus` is the prototype's
`stack_size_bonus`. pycranes' auto-upgrade tiers (`crane-mk3u1` through `crane-mk3u8`)
import as their own rows; `logisticsOptions` folds them into the base crane, and the
hand-size math uses the tier the research bonus selects. The inserter throughput model
(swing ticks, belt pickup, belt drop) and its in-game calibration are described in that
module's header. Crafting machines also store tile dimensions derived from their
selection or collision box. The block editor combines those dimensions with whole mover
counts, fuel/byproduct access, and active fluid connections to warn when loading access needs
more physical buildings than production capacity alone.

Logistic robots and roboports feed the bot-count math in `app/src/lib/robots.ts`. A
robot row stores `speed`, `max_payload_size`, and its battery fields in joules
(`max_energy`, `energy_per_move`, `energy_per_tick`, `min_to_charge`, `max_to_charge`). A
roboport row stores `charging_energy` (watts per charging pad) and `logistics_radius`.
The force's `worker_robots_speed_modifier` and `worker_robots_storage_bonus` arrive with
`state.research`; they are one live value per force, so they don't follow the planning
horizon. The trip and charging model is described in that module's header.

Technology tables record belt-stack, inserter-stack, and bulk capacity bonuses. The client
can then recalculate row logistics and loading fit instantly when the selected tier or
planning horizon changes, without invoking the block solver. Loading fit checks available
perimeter positions only; belt and pipe route feasibility remains outside this model.

Recipe and mining productivity technology effects are stored separately. The effects stage
combines them with the active research horizon. In **Now** mode, bridge-synchronized force
bonuses can replace prototype-derived estimates with the save's exact mining and per-recipe
productivity values.

### Rocket logistics

Item weight and utility constants support the optional launches-per-minute estimate. An
explicit item weight determines payload capacity directly; otherwise the importer uses the
game's default item weight and the UI marks the result as an estimate.

## Cost analysis

After import, `app/src/server/cost-analysis.server.ts` runs a YAFC-style linear program that
assigns intrinsic costs to goods and recipes. Cost is explanatory metadata used for
comparison and prioritization; it does not choose the user's block recipe chain.

Barrel fill and empty recipes get a 100× logistics penalty, so fluids are never priced
through a barrel round trip and those recipes sort last in the recipe picker.
`app/src/lib/barreling.ts` finds them by Pyanodons' barrel categories (`py-barreling`,
`py-unbarreling`) or by vanilla's `fill-barrel` and `empty-barrel` subgroups, since vanilla
barrel recipes import as plain `crafting`. The dependency explorer and the goal shortcut use
the same check.

Cost analysis runs before saved blocks are refreshed so every downstream reader sees one
coherent reference-data generation.

## Icon atlas

When requested, `app/src/server/icon-atlas.ts` recursively reads Factorio's dumped PNGs,
hashes their bytes, and packs unique images into deterministic 4096×4096 sheets. Identical
sprites share one slot, while the manifest maps every logical `type/name` key to its sheet
and coordinates.

The builder processes one sheet at a time to cap peak raw-buffer memory. It resizes each
sprite into a uniform transparent cell and records unreadable sprites as skipped rather
than aborting the whole manifest.

The generated sheets and `manifest.json` live under the writable `icon-data/` directory and
are served through `app/src/routes/icons.$.ts`. Sheet URLs include the project's compact
data fingerprint when the manifest is read, preventing reuse across different enabled mod
sets.

Synthetic rows have no sprite of their own, so they borrow their subject's: a mining recipe
draws its resource, a fluid-burning conversion draws its fluid, and a research recipe and
the research good it produces both draw their science pack. Where the borrowed sprite alone
would be ambiguous, a small corner badge distinguishes it — a fuel glyph for fluid burning,
a flask for research — following the same overlay convention as the spoilage stopwatch.
Research badges every pack rather than substituting one generic glyph, because research
goods are per-pack by design and the pack is the distinction that matters. The purely
abstract pseudo-goods, which have no subject to borrow from, render as a glyph instead.

## Provenance and drift

Each successful sync stores two related values in project metadata:

- `data_fingerprint` — a compact hash of enabled mod names, also stamped into solved-data
  metadata and icon sheet URLs;
- `mod_list` — every detected mod's name, enabled state, and version.

Versions are recovered from packed or unpacked mod-directory entries because
`mod-list.json` contains only names and enabled flags. Base-game modules outside that
directory may have a null version.

`diffMods()` categorizes additions, removals, enable/disable changes, and version changes.
`redumpNeeded()` compares only enabled mod names and versions, so changes to disabled mods
do not invalidate reference data.

The app checks drift at lifecycle points where Factorio may have changed and periodically
while running. The same result drives the startup dialog, persistent navigation indicator,
and **Settings → Game data** detail.

## Following prototype renames

Enabled mods may contain declarative `migrations/*.json` files mapping item, fluid, recipe,
or entity names. `app/src/server/migrations.ts` reads them from zip archives or unpacked mod
directories and ignores procedural Lua migrations.

The first observed file set becomes the project's baseline. On later syncs, only newly
observed JSON files are applied, in filename order, so chained renames compose. Rename maps
update every saved block surface that can hold a prototype reference:

- goals, made-good rules, pins, and recipe lists;
- recipe-keyed machine, fuel, module, and beacon selections;
- entity and module names inside those selections;
- block icons.

Parsing is defensive: malformed entries, unreadable archives, and unsupported values are
skipped rather than failing the data sync. References that genuinely disappeared are not
guessed or deleted.

## Projection invalidation and broken blocks

`solve_projection_generation` in project metadata is the database-owned invalidation
clock. A completed data sync advances it after all reference writers finish. Research,
productivity, and TURD changes advance the same generation when they alter solver inputs.

Each saved block projection carries that generation plus a content fingerprint over the
recipes and goal goods it references. `resolveAllBlocks()` refreshes stale blocks once, and
factory-wide readers accept only projections from the current generation.

If a block references a missing recipe or goal good, `computeBlock()` does not solve a
surviving subset. It returns a broken result with the missing references, preserves the
input document and last known cached flow, and leaves the projection stale. Restoring the
mod or applying a valid rename can therefore recover the original block without data loss.

## Extending the pipeline

When importing a new prototype property or production mechanism:

1. Add the normalized schema fields and a named Drizzle migration.
2. Parse the Factorio shape in `import-factorio.ts` or synthesize it in `synthesize.ts`.
3. Keep raw prototype flexibility at the importer boundary; downstream modules should read
   one stable representation.
4. Update solver/effects consumers and invalidate the solve generation when the new value
   changes planning output.
5. Bump `REFERENCE_DATA_FORMAT_VERSION` when existing imported rows must be rebuilt for the
   change to take effect. Do not bump it for code changes that read the existing normalized rows
   without changing their meaning.
6. Add focused importer or synthesis fixtures covering missing and modded values.
7. Update the user guide only when the property creates a visible choice, result, or sync
   requirement.

Verify the importer and affected solver modules with `vp test`, then run a real sync against
the relevant mod set. Confirm reference counts, localized names, icon behavior when
applicable, drift metadata, and saved-block refresh before handoff.
