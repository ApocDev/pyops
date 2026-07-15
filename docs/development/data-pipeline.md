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

After both import passes complete, the importer writes `data_format_version` to project
metadata. `REFERENCE_DATA_FORMAT_VERSION` in `app/src/lib/data-format.ts` describes the
meaning of normalized reference rows, independently of the SQLite schema version. The shared
reference-data drift check compares the stored and current versions alongside mod drift. A
non-empty project with a missing or different version gets the existing re-sync prompt; an empty
project remains in the normal first-sync flow.

### Normalization

The importer converts Factorio's flexible prototype shapes into stable relational rows:

- recipes, ingredients, products, categories, unlocks, and technologies;
- items, fluids, machines, mining drills, modules, beacons, and fuels;
- energy-source details, pollution, crafting categories, and allowed effects;
- logistics prototypes and technology-driven stack bonuses;
- productivity effects, TURD replacements, and rocket constants.

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

Every synthetic row records a `kind` and `source_entity`, allowing the UI and downstream
logic to distinguish it from an ordinary craft without special name parsing.

## Modelling conventions created during import

### Temperature identity

Fluid ingredients retain minimum and maximum temperatures; products retain their exact
temperature. The compute layer expands relevant fluid flows into temperature-qualified
identities before solving and folds them back into localized fluid rows for display.

Generators receive one synthetic recipe for each usable input temperature because output
depends on available thermal energy. Temperature-fed machines store the drain information
required to turn their heat source into a real solver flow.

Solar-panel prototypes with a custom `solar_coefficient_property` use the matching Nauvis
surface property as their planning multiplier. When the mod also publishes matching
`-min` and `-max` properties, the synthetic recipe retains that range while the solver uses
the planner value. Py wind turbines, for example, publish their average wind speed for
planners and their runtime speed bounds separately. Synthetic generator machines use the
item named by `placeable_by`, so building research gates hidden child entities correctly.
Alternate `-blank` runtime states that point to the same placeable item are not exposed as
duplicate recipes.

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
folded into stored energy use.

### Logistics and research effects

Belts, loaders, and inserters store only the prototype fields needed by
`app/src/lib/logistics.ts`. Crafting machines also store tile dimensions derived from their
selection or collision box. The block editor combines those dimensions with whole mover
counts, fuel/byproduct access, and active fluid connections to warn when loading access needs
more physical buildings than production capacity alone.

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
