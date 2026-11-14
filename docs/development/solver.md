---
title: Block solver
description: Understand the HiGHS block model, gesture-derived constraints, effects, composed sub-blocks, persisted projections, and Factory Scenario analysis.
outline: [2, 3]
---

# Block solver

PyOps solves the recipe set a user selected; it does not choose an optimal recipe chain.
The block solver converts goals, boundary decisions, and pins into a linear program whose
variables are recipe executions per second.

The main implementation lives under `app/src/solver/`:

- `lp.ts` builds and solves the HiGHS model;
- `diagnose.ts` explains infeasible constraints;
- `temps.ts` expands temperature-sensitive fluid identities;
- `quality.ts` expands quality ranges and splits products by quality;
- `subblock.ts` composes separately solved row groups;
- `migrate.ts` normalizes persisted block documents at the solver boundary.

`app/src/server/block-compute.server.ts` resolves database records, machines, effects,
fuels, and presentation metadata around that pure core. Scenario's pinned factory model lives in
`app/src/server/factory-plan.server.ts`; the assistant's read-only scaling analysis remains in
`app/src/server/factory-solve.server.ts`.

## Core model

A block solve receives:

- one or more output or consumption goals;
- the user's enabled recipes;
- the set of goods that must be made inside the block;
- optional byproduct drains;
- exact-rate, capacity, or flow-share pins.

For each enabled recipe `r`, the model creates a nonnegative run-rate `xᵣ`. Ingredient and
product coefficients define the net rate of every good. The solve is lexicographic: it first
minimizes avoidable surplus beyond the saved goal rates, then minimizes total machine-seconds.
A tiny per-recipe epsilon gives zero-time synthetic recipes a deterministic cost in the second
stage. If HiGHS rejects only the tightly constrained machine tie-break because of numerical
rounding, the solver retains the preceding feasible minimum-surplus solution; an optional
tie-break cannot turn a feasible block into an infeasible one.

The objective is a sizing and tie-breaking mechanism. It never adds a recipe the user did
not select.

### Goals

A positive goal becomes a net-production floor:

```text
net(good) ≥ target rate
```

The goal remains one-sided so a fixed coproduct ratio may force a larger net output. The
goal-tightening stage removes only surplus that the selected recipe set can avoid, then the
machine objective chooses the smallest implementation of that tighter result. This matters for
coupled multi-goal blocks: a downstream recipe is not idled merely because exporting another
goal would use fewer buildings.

A negative goal represents a sink and becomes a net-consumption ceiling. Internally, all
rates are per second. The editor's seconds/minutes/hours unit changes input and display
only.

The solved good remains a canonical import for factory projections and flow graphs. In the
block editor it is already represented by the negative goal, so `displayImports` removes it
from the Block balance Imports list rather than rendering the same contract twice.

A stock goal stores an amount and replenishment window. The compute layer converts it to
`amount / window` for solving, then tags its persisted factory flow as stock replenishment
rather than continuous output.
Normalization derives that rate on every read, making `stock` plus `window` authoritative even
if an older document also contains a stale explicit rate.

A temporary campaign stores finite quantities, one shared duration, a confidence mode, and an
optional completion timestamp. Normalization turns every campaign quantity into an ordinary goal
rate before building the LP. **Expected** uses `quantity / duration`. The 90% and 95% modes find
the Poisson mean whose probability of producing at least the requested integer quantity reaches
the selected threshold, then divide that larger expected quantity by the duration. Recipe
coefficients still use their imported expected yields, including prototype probability and
minimum/maximum amounts; the campaign multiplier is an operational reserve across the finite
chain rather than a separate stochastic LP. Completion disables the block, so the persisted
campaign remains available to reactivate but contributes no enabled boundary flows.

The first goal anchors the block's name, scaling controls, and default icon. Additional
goals participate in the same solve without changing that identity.

### Made inside the block

A good in the block's `made` set receives:

```text
net(good) ≥ 0
```

This forbids an import from covering internal consumption while allowing excess production
to leave the block. Goal outputs are made implicitly.

Goods outside the set remain free boundaries. Net consumption becomes an import and net
production becomes an export. An incidental coproduct offsets an import at its natural
rate; it does not cause its source recipe to scale solely to cover demand.

When a made-good rule has no enabled producer, the rule cannot be enforced and degrades to
an ordinary boundary flow. A goal without a producer is reported separately as unmade so
the rest of an unfinished block can still solve.

### Byproduct drains

A drain requires a good's net flow to equal zero. It is used when the user selects a
net-consuming recipe for an exported byproduct. The drain makes production and consumption
match, so the selected route participates instead of remaining idle under the
machine-minimizing objective. This applies equally to terminal sinks and feedback
reprocessors: recycling a byproduct back into an earlier intermediate changes the solved
recipe mix while preserving the block's explicit goals.

`app/src/lib/sink-classify.ts` verifies that the selected recipe net-consumes the clicked
good before the editor creates the drain. The same gesture also marks the good as made so a
feedback recipe cannot import the byproduct and replace the block's real source.

The solved result also reports imports that an enabled in-block recipe could produce. The
UI uses that signal to expose the common missing-made-rule case directly.

### Pins

Pins are stored in building-oriented terms and converted to recipe rates using the selected
machine, modules, beacons, and effective crafting speed:

| Pin         | Constraint                                  | Meaning                                                   |
| ----------- | ------------------------------------------- | --------------------------------------------------------- |
| Exact count | `rate(recipe) = value`                      | Always run this capacity; supply pushes through the chain |
| Capacity    | `rate(recipe) ≤ value`                      | Do not exceed installed capacity                          |
| Share       | Consumer intake is a fraction of production | Route a good across multiple selected consumers           |

A share can use total production or the amount remaining after exact-count consumers take
their fixed portion. Temperature expansion may supply an explicit set of source identities
for the share base.

When exact-count pins cover every producer of a goal, they supersede that goal's solve floor.
The fixed producers then define output, while the saved goal remains the block's declared
intent and factory role. The result reports the difference so the UI can explain whether the
pinned capacity falls short. If an unpinned producer can make the same goal, the goal stays
binding: exact pins provide their fixed contribution and the other producers supply the
remainder. Capacity pins and exact pins elsewhere remain ordinary constraints and may make the
block infeasible.

## Temperature-sensitive fluids

The LP core treats names as opaque goods. `temps.ts` rewrites real fluid inputs and outputs before
the solve:

1. Each producer output becomes a `(fluid, temperature)` identity.
2. Each consumer range becomes a pool identity.
3. Zero-cost selector recipes convert every in-range temperature identity into the pool.
4. Consumers draw from the pool, allowing any mixture of valid temperatures.
5. A fluid goal uses an exact one-temperature pool when selected; an unselected goal uses its
   full displayed range.
6. A consume goal is one net-balance row. It sums the net flow of every temperature identity
   inside the goal's range: each produced temperature in that range, and each consumer pool
   whose accepted range overlaps it. Production minus consumption across that set must be at
   most the (negative) goal rate. For an item goal the row is the item's own net, so a fluid
   consume goal means the same thing: net consumption of that fluid at the goal's temperatures.
   - Produced temperatures outside the goal's range are not in the row, so they can't count
     toward it. Consumption they feed into an overlapping pool cancels out of the row, because
     their selector adds to the pool as much as the consumer takes from it.
   - The row constrains only the net, so pins and other goals decide how it is met.
   - The goal subsumes made marks on the goods in its row, as an item goal subsumes a made mark
     on its own item. Otherwise a made consumer pool could never import what the goal needs.
   - Each consumer pool's import carries the pool's range intersected with the goal's range. A
     165° goal feeding a ≥100° consumer imports 165°, and the factory planner only matches
     compatible suppliers to it.

Production that already runs feeds compatible consumers before anything crosses the block
boundary, as it does for an item. Because selectors cost an epsilon and boundary flows are free,
the first solve can export a pump's water and import the same water for a compatible consumer.
Whenever one fluid both exports and imports, a second pass keeps every real recipe at its solved
rate and re-solves only the selectors, minimizing the boundary flow of every produced temperature
and consumer pool. That routes the pump's water into the consumer, including when it takes a chain
of swaps: 15° water takes over a pool that accepts any temperature, freeing the 125° water that
fed it for a ≥90° consumer. Nothing is started or scaled to avoid an import, and
temperature compatibility is unchanged: 125° water still can't feed a ≤101° consumer.

The block keeps its imports and exports of one fluid apart, so a cold import and a hot export of
the same fluid both reach the factory.

This models range pooling rather than forcing one independent chain per exact temperature.
A made rule expands to its variants and pools. If no in-range producer exists, the result
can explain the required range, such as “nothing makes Water ≤101°”.

The block document can narrow one recipe ingredient's range or fluid goal to an exact
user-selected produced temperature. Producer-only blocks also expand, because their factory
boundary must retain the exact output temperature even when no local consumer observes it.
Synthetic PyOps energy goods remain bare.

Persisted boundary flows keep the canonical base fluid name plus structured exact/range
qualifier columns. Factory Overview presents those contracts as separate localized rows when the
fluid has multiple producible temperatures, without inventing fluid prototypes. Its drill-down
queries compare the same normalized qualifier key, so a one-point consumer range matches its exact
producer but a wider range remains a different connection.

## Quality

Quality is a second pure input transform, `expandQualities` in `quality.ts`. It runs before
composed sub-blocks and the temperature expansion. The LP core gains only one thing for it:
a count or capacity pin can bound the sum of several columns.

### Identity

A good at a quality is a quality key, written by `lib/quality.ts`. Normal is the bare name.
Any other quality is `name@quality`, such as `iron-plate@rare`. The same key is the solver's
internal good name, so `iron-plate` and `iron-plate@rare` are separate LP goods with
separate balances. Fluids never carry quality.

The block document names qualities the same way:

| Field                             | Meaning                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `rowQuality[recipe].min` / `.max` | The qualities the row runs at. Missing means normal only.          |
| `rowQuality[recipe].machine`      | The row's machine quality.                                         |
| `rowQuality[recipe].modules`      | The quality of the modules in the machine's own slots.             |
| `beacons[…].quality`              | The beacon building's quality.                                     |
| `beacons[…].moduleQuality`        | The quality of the modules in that beacon.                         |
| `goals[…].quality`                | An item goal's quality.                                            |
| `made` entries                    | Quality keys: `iron-plate` is normal only, `iron-plate@rare` rare. |
| drain and share pins: `quality`   | The quality of the pinned item.                                    |

Every field defaults to normal, so a Py document has none of them and reads as before.

### Range rows

One block row covers a range of qualities with one machine and module setup. The transform
gives each quality in the range its own LP column: `recipe` at normal and `recipe@rare`
above it. The LP picks each column's rate, and the result folds the columns back onto the
row. The row reports one rate and one machine count, plus `qualityRates` with each
quality's share. A recipe whose `can_set_quality` is false, such as a fluid-only recipe or
a synthetic one, runs at normal only.

A column at quality q eats its item ingredients at exactly q. A consumer at q needs exactly
q, so there are no ranges, pools, or selectors as there are for temperatures. A burner's
fuel and burnt result stay normal whatever the row's quality.

A composed sub-block's goals name a (good, quality) like block goals. Its members are the
rows' quality columns, and its boundary contract keeps quality keys, so the parent links the
module's output per quality.

A count or capacity pin on a row bounds its total rate across all its columns. Because such a
pin fixes only the total, it never supersedes a goal on one quality: the goal stays binding,
and the pinned buildings must make it from that quality's column. A goal is superseded only
when every column that produces its (good, quality) is a single-quality row with its own
count pin. An item share pin
names a (good, quality): the row's column at that quality takes its share of that quality's
production. A fluid has no quality, so a fluid share pin splits the row's intake summed over
all its columns. A count pin over several columns fixes only their total, so another share pin's
"remaining" base subtracts its intake only when every column eats the same amount. That holds
for a fluid but not for an item, which each column eats at its own quality.

### The split

A column's item products split over its quality and the levels above it. With total
quality effect Q, the chance of at least one step up from quality q is
`min(1, Q × next_probability(q))`. Each further step multiplies by the `chain_probability`
of the quality just reached. The exact shares are the differences. Productivity applies
first, so the split takes the productivity-scaled amount.

Four normal quality module 3s give Q = 0.1. In Factorio 2.1 every level has
`next_probability` 1 and `chain_probability` 0.1, so a normal craft comes out 90% normal,
9% uncommon, 0.9% rare, 0.09% epic, and 0.01% legendary.

Chances past the best quality the research horizon unlocks land on that quality. A quality
is unlocked when an `unlock-quality` technology for it is within the horizon, or when no
technology unlocks it. In Future mode every quality is unlocked.

A plan can't assume equipment or crafts at a quality the player can't make yet. A row's
range, machine quality, module quality, and beacon qualities are capped at the best
unlocked quality, and a row that asked for more reports `qualityCapped`. The science bank
caps its lab, module, and beacon qualities the same way.

This follows YAFC-CE (`ProductionTableContent.cs:548-588`) with one difference. YAFC-CE
clamps each cumulative chance to 1 after the chain factor. Factorio's `chain_probability` is
a conditional chance after a step up, so PyOps clamps only the first step. The two differ
only when `Q × next_probability > 1`.

### Effects

`computeEffects` sums each module's quality effect like the other effects. A recipe with
`allow_quality = false` drops module and beacon quality, and the machine's base quality
applies either way. The total clamps to the machine's `quality_limits` (low 0 by default)
and floors at 0, since PyOps doesn't model quality going down. A row whose quality effect
can't upgrade anything reports `qualityUseless`: it has no item product, or it runs only at
the best unlocked quality.

Entity quality uses the imported multipliers, not YAFC-CE's hard-coded 30% and 0.2 per level
(`server/quality-effects.ts`):

- A module's effects scale by the quality's module multiplier for each effect, weighted by
  the module's `<effect>_quality_multiplier`. By default only the beneficial side scales, so
  a quality module's −5% speed stays −5%. The result floors to whole percent, and the quality
  effect floors to the import's `quality_effect_step` (0.01% for Factorio 2.1). A legendary
  quality module 3 gives 0.025 × 2.5 = 6.25%.
- A beacon gains `distribution_effectivity_bonus_per_quality_level` per level, its power
  scales by `beacon_power_usage_multiplier`, and its slots grow when it opts in.
- A crafting machine's speed scales by its per-quality override or the quality's
  `crafting_machine_speed_multiplier`. Its energy use and slots change only when it opts in.
  Drills, labs, boilers, and generators keep their base values.

A module or beacon at a quality is looked up under its quality key, so `computeEffects`
reads a legendary module like any other.

### Quality loops

A loop needs no special code. Recycling recipes are ordinary recipes in the dump, and the
LP already solves cycles. For rare gears from normal plates:

1. Run the gear row at normal to rare and the recycling row at normal to uncommon.
2. Put the goal on `iron-gear-wheel` at rare.
3. Drain normal and uncommon gears, so the recycler eats them.
4. Mark `iron-plate@uncommon` and `iron-plate@rare` made, so recycled plates stay in the
   loop instead of being imported.

Normal plates stay free and import. `solver/quality.test.ts` derives this loop's steady
state by hand and checks the LP against it.

### Science packs and labs

A science bank's pack rate is research throughput, in normal packs' worth of research per
second. Lab count and power follow throughput only. The packs consumed are what changes: a
quality science pack carries `tool_durability_multiplier` times the research (1 + level by
default), and a lab drains every pack at the same speed. So 1/s of
`automation-science-pack@rare` needs the same labs as 1/s of normal packs, but only a third
of the packs. YAFC-CE counts it the same way, as level + 1 normal packs. The
bank's `labQuality` scales research speed by `lab_research_speed_multiplier`. A lab with
`uses_quality_drain_modifier` also drains packs at `science_pack_drain_multiplier`.

### Results and persistence

Boundary flows keep the quality key through the solve and the post-solve fuel and power
accounting. `boundaryFlows` splits it when caching: `block_flows` stores the item and a
`quality` column, null for normal. `block_machines.quality` holds the row's machine quality.
A row has one machine quality across its range, so the table's key stays (block, machine,
recipe). Display names for quality goods read "Iron gear wheel (Rare)".

### What isn't modelled yet

- The planner UI for quality: range controls, quality pickers, badges, and per-quality
  factory rollups. Until then module pickers, templates, and auto-fill don't offer quality
  modules, and factory views add every quality of an item together.
- Quality going down (`previous_probability`), and products' `quality_min`, `quality_max`,
  and `quality_change`. Only Space Age uses the last three.
- Cost analysis prices every quality at normal, as YAFC-CE does.

## Solve outcomes and diagnosis

The LP returns `solved`, `infeasible`, or `error`. It does not silently relax constraints
or cut cycles.

Every constraint carries provenance describing the user gesture that created it: a goal,
made-good rule, drain, or pin. When HiGHS reports infeasibility, `diagnose.ts`:

1. runs an elastic model to measure violated constraints;
2. groups independent problems by their shared recipe variables;
3. deletion-tests the local constraint neighborhood for irreducible membership;
4. returns cards containing only gestures the user can change.

This keeps the UI explanation actionable. A card can quantify a shortfall or capacity gap
and offer the corresponding goal, made rule, or pin as a repair point.

Cyclic Py chains are ordinary linear systems and require no special loop-breaking. They
solve when the selected recipes and boundary constraints define a feasible flow.

## Block-document behavior

### Disabled recipes and blocks

A disabled recipe remains in the block document with its machine, fuel, module, and beacon
choices, but is removed before model construction. It contributes no constraints, flows,
or machine counts.

A disabled block still opens and solves for editing. Factory workspace views, suppliers,
and machine totals omit it.

### Unmade goals and missing references

A goal with no enabled producer is dropped from the LP and returned in `unmade`. Other
goals and recipes continue to solve, allowing an incomplete block to remain useful while
the editor flags the missing producer.

This is distinct from a reference that no longer exists in the active game data. Missing
recipe or goal prototypes produce a broken block result and preserve the last known
projection rather than solving a semantically incomplete subset. See
[Projection invalidation](#projection-invalidation).

Factory indexes treat saved goals as declared intent. Block health is therefore the source
of truth for whether the selected recipes currently realize that intent.

### Incidental spoilage

`spoilRates` records expected spoilage while production is backed up. These are operational
estimates, not steady-state recipe demand, so they do not alter the LP, nominal imports, or
machine count.

After solving, the compute layer converts each estimate through the item's spoil result and
adds it to byproduct exports. Factory Scenario scaling never increases a source block merely to make
more incidental spoilage. Deliberate demand-driven decay uses the synthetic spoiling recipe
and an ordinary goal instead.

For a selected synthetic spoiling recipe, the row also reports the steady-state buffer:

```text
buffer items = spoil rate × spoil time
```

This is the inventory resident while the conversion is in progress.

## Machines, effects, and energy

`block-compute.server.ts` converts LP run rates into row results after resolving the
selected building and all applicable effects.

### Module and beacon effects

`app/src/server/effects.ts` applies effects before model construction:

- productivity scales eligible product amounts and therefore changes material balance;
- speed changes each building's recipe rate and resulting machine count;
- consumption changes electrical or fuel demand;
- pollution changes the row and block pollution budget.

A module counts only when it reaches the machine. Its category must be in the machine's
`allowed_module_categories`, and each beneficial effect it has must be in the machine's
`allowed_effects`. Otherwise the module adds nothing, not even its other effects. The rule is
the same for the machine's own slots, every beacon, and the TURD hidden beacon. Measured in
game:

- Pyanodons' Assembling machine 2 allows no effects. A speed or efficiency beacon next to it
  changes nothing.
- Pyanodons' lab disallows speed, so a speed beacon adds neither speed nor its consumption.
  Vatbrains still apply, because productivity, consumption, and pollution are all allowed.
- The sap extractor allows speed but takes only sap modules, so a speed beacon does nothing.
- A harmful side effect never blocks a module and is never filtered out. A beacon with
  productivity modules next to a fluid drill that disallows speed still slows the drill.

Each machine's effect receiver then shapes the sum, following Factorio's `EffectReceiver`
prototype:

- the machine's `base_effect` adds into the sum like one more module;
- `uses_module_effects = false` drops its own modules, and `uses_beacon_effects = false`
  drops beacons and the TURD bonus, which Pyanodons delivers through a hidden beacon;
- each total clamps to the machine's `*_limits`. The default low limit is `-0.8`, so speed,
  consumption, and pollution never drop below `0.2×` unless a machine lowers it.

Pyanodons' farms and creature buildings use this. They have `base_effect.speed = -1` and
`speed_limits.low = -0.9999`, so an unmoduled farm runs at `0.0001×` and each `+1` speed
creature module adds `1×`: ten fawogae modules give `10×`, not `11×`. Pyanodons' salt and
sulfur mines and antimony drills have `+9` consumption.

A recipe that disallows productivity blocks module, beacon, and TURD productivity, but not
the machine's base productivity. In game, a `compost-plant-mk01-turd` (`+5%` base
productivity) running `biomass-guar-seeds`, a recipe that disallows productivity, gains
productivity bonus progress at exactly `5%` per craft. Pyanodons' TURD compost plants
therefore add `+5%` to `+20%` to composting recipes.

Productivity clamps to its limits before research productivity is added, then to zero and
the recipe's maximum. `ignored_by_productivity` is an amount of output
that remains unscaled; only the remainder receives the multiplier. Factorio ignores it on a
recipe that disallows productivity, so there the machine's base productivity boosts the whole
product.

Technology-derived recipe and mining productivity enter the same effects stage. Future
planning derives bonuses from the allowed technology set. **Now** mode can use exact force
and per-recipe values synchronized from the running save or entered through planning
settings.

A beacon configuration records both how many beacons affect each machine and how many
machines each beacon building serves. Real builds share a beacon between neighbouring
machines, and the two quantities are independent: sharing never changes the effect, because
every machine in range sits in the full field regardless of how many neighbours join it. It
divides the physical building count, and with it the power draw. Charging each machine for a
private copy overstates a shared bank by the sharing factor, which matters most where
beacons are expensive — Pyanodons' tiered beacons reach hundreds of megawatts each. A row
therefore reports whole beacon buildings separately from beacons-per-machine, since a
fraction of a building cannot be placed.

Pyanodons disables a machine whose AM/FM beacons interfere (see the data pipeline for the
rule). The solve does not model the shutdown. It keeps the beacons' effects, so the row still
shows what the player set up, and lists the conflicting beacons in the row's
`beaconInterference`. More than one copy of the same AM/FM beacon on a machine always
conflicts. The editor marks the row's module control, the science bank marks its effects
control, and a module preset whose beacons interfere is not offered or applied by default.

### Module suggestions

Module auto-fill is a separate suggestion pass, never implicit solve input. The saved block
document is the only source of applied modules.

`app/src/server/module-fill.server.ts` reuses solved row rates without invoking the LP. For
productivity-capable recipes it fills eligible slots with the best available productivity
module. Otherwise it finds the smallest speed-module count that reduces the required whole
building count and uses remaining slots for efficiency. Beacon and TURD effects participate
in that baseline.

The editor may preview or apply suggestions. Assistant drafts can adopt them as explicit
document choices before re-solving.

### Power, fuel, and pollution

Electrical draw is accumulated as consumption of `pyops-electricity` and then presented as
power. A row draws `energy_usage × count × consumption multiplier + drain × ⌈count⌉`. The
drain is the electric source's constant draw: modules and beacons never scale it, and a placed
building draws it while idle, so it is charged on whole buildings rather than the fractional
count. The science bank charges lab drain the same way. Per-building power in `calcRecipe` is
`energy_usage × consumption multiplier + drain`, and zero for a temperature-fed fluid source, matching block rows. Solid burners use the row's fuel selection. If the block produces that fuel, or
the block needs its burnt result (as an ingredient, a goal, or a good marked made), the
burn is represented inside the model so
extra production and burnt results remain balanced. An imported fuel stays a boundary
import in both cases; modelling it lets a boiler's ash cover an in-block ash consumer.
Otherwise the fuel import and burnt-result export are added after the solve.

An unfiltered fluid-burning machine consumes `pyops-fluid-fuel`, measured in megajoules.
Selected `burn-fluid-*` conversions determine which fuel-valued fluids supply it. Without a
conversion, the energy appears as a boundary import. Filtered sources remain tied to their
prototype fluid.

Temperature-fed sources consume their feed fluid for thermal energy rather than fuel value.
`app/src/db/fluid-energy.ts` provides either a fixed units-per-second drain or an
energy-following drain based on usable joules per unit. That drain becomes a real ingredient
and can be supplied inside or outside the block.

Pollution is the sum of machine base emissions multiplied by count, energy-consumption
effects, and pollution effects. Per-fuel emissions multipliers are currently treated as
one.

### Reactor layouts

A reactor row can store an assumed rectangular farm. `app/src/lib/reactor.ts` converts an
`x × y` layout and the prototype's neighbour bonus into an average heat multiplier:

```text
1 + neighbourBonus × (4 − 2/x − 2/y)
```

The multiplier scales heat output before solving. Fuel consumption remains per reactor. No
stored layout is equivalent to `1 × 1` and receives no neighbour bonus.

### Capital cost

Build cost is separate from per-second material balance. The compute layer rounds required
machines up by building type, expands each building's own construction recipe, and sums
direct ingredients. It does not recursively plan the production chain for those materials.

## Row groups and composed sub-blocks

A normal row group is display-only. It changes folding and net-flow presentation while the
solver receives the same flat recipe set.

A composed group is solved independently by `subblock.ts`:

1. Its member recipes, internal goals, pins, and machine effects form a nested block input.
2. Its made set defaults to every good produced by a member recipe, keeping internal
   intermediates inside the module.
3. The nested solve's net imports and exports become one synthetic recipe in the parent.
4. The synthetic recipe's objective cost is the nested solve's machine-seconds.
5. The parent LP scales that black box alongside its ordinary recipes.

Member rows render at the nested rate multiplied by the parent's selected rate for the
synthetic recipe. Co-products remain on the module contract and can appear as factory
byproducts. Internal goals do not become top-level factory goals.

The dependency direction is strictly child to parent, so a composed group cannot depend on
its parent and the nested solve remains cycle-safe. Groups do not nest. A composed group's
made set is derived rather than edited independently, and its infeasibility is shown through
group status and parent shortfall rather than a separate diagnosis-card set.

## Projection invalidation

SQLite stores both block inputs and materialized outputs: boundary flows, machine counts,
power, pollution, status, and reference fingerprint. These projections make Factory
Overview and Connections fast without making process memory authoritative.

`solve_projection_generation` is the invalidation clock. Game-data imports, effective
research/productivity changes, and TURD selections advance it transactionally. A block
projection is current only when its generation and referenced-prototype fingerprint match.
Repeated live-state heartbeats that do not change canonical inputs leave the generation
unchanged.

The backend re-solves stale blocks. A broken block keeps its last good projection with the
old generation, ensuring preserved values cannot be mistaken for current calculations.

## Factory Scenario model

Factory Scenario treats selected goods as factory pins and every enabled block goal as a possible
factory activity. A pin is a signed net target: positive for desired output, negative for deliberate
consumption. Stock goals contribute an always-derived positive pin equal to `stock / window`.
Active temporary campaign goals contribute always-derived pins at their confidence-adjusted
campaign rates. They therefore remain fixed commitments even when the produced good is consumed by
another block; users edit the campaign quantity or duration in the block rather than overriding its
rate in Factory Scenario.

Scenario persists its latest completed preview in the project database. A deterministic cache key
combines the Scenario model version, solve-projection generation, data fingerprint, every enabled
block's normalized document/reference fingerprint, and the effective factory pins. A route visit
only compares that key and reads the cached result; it does not solve again while the key remains
current. A stale result stays visible until the player explicitly recalculates, and draft pin edits
do not create a cache entry or launch work per keystroke. The server reports lightweight progress
for response-column preparation, the factory LP, full-block validation, re-linearization passes,
and apply-time validation without enabling the much larger diagnostic trace.

`factory-plan.server.ts` solves the block at its complete goal vector, perturbs each goal in its
saved direction, and uses the boundary-flow difference as a local response column. The affine
intercept is anchored at the block's actual goal vector, so operational and recipe-activation flows
that remain constant under a small perturbation are retained in factory material balances. Keeping
sibling goals active is essential because one block LP can change recipe bases as its goals
interact. A zero-rate goal is probed with a small signed reference rate, allowing a configured
producer or consumer to start without losing its saved direction.

If a goal is already covered by a sibling goal's coproduct, a small perturbation may only reduce
surplus while total output stays flat. Scenario searches outward past that plateau and measures the
next locally scalable segment instead of treating the zero derivative as proof that the goal cannot
scale. That breakpoint segment remains separate from the affine intercept because it is not active
at the current goal vector. Temperature selector primals pass through HiGHS's limited-precision
solution output, so plateau detection uses their physical rates only to classify the active basis;
the configured goal rates still define response coefficients, projections, and validation.

The factory model constructs a demand-reachability closure from positive pins. It follows imports
from a selected production column to configured positive goals for those exact goods. A selected
column's byproduct may add a matching negative goal column, and that consumer's byproducts may feed
further configured sinks. Byproducts never add positive goal columns. Per-good producer-cap
constraints also prevent a declared producer from running beyond demand for its own goal merely to
obtain a coproduct. Explicit negative pins select consumption columns as boundary demand; an
unpinned negative goal with no reached byproduct receives a solved target of zero. A zero-rate goal
stores its `direction`, preserving produce-versus-consume intent without introducing a fake epsilon
throughput; nonzero legacy goals continue to infer direction from their sign.

Each reached good receives a material-balance equality. A good without a selected producer has an
import-slack variable, and ordinary outputs have a surplus-slack variable. A byproduct with an
automatically reached sink instead has a closed equality: its natural production must feed that
consumer and cannot be supplemented by an external import. Once scalable output reaches that sink,
fixed positive flows of the same good enter the same closed balance and must feed the consumer too;
they do not make a consumer goal reachable by themselves. Imports carry the dominant objective
penalty; activity cost and supply priority break ties between configured producers. A missing
producer therefore becomes a raw import rather than making the model infeasible.

A fluid byproduct with an explicit temperature is a distinct factory material. Range-qualified
fluid demand receives selector variables from every exact supplied temperature inside that range.
These selectors are the only conversion between temperature identities: they prevent an
incompatible hot or cold line from balancing the demand, while still allowing Auto consumers to
pool any compatible mix. Supplier priority is applied after this compatibility filter. After the
factory LP solves, coproduct recovery follows the solved selector transfers back to the exact source
temperature before crediting a block goal. It never strips the qualifier first, so output at one
temperature cannot claim demand that accepted only another temperature.

The actionable output is one change per goal—it never collapses a multi-goal block back to its
first goal. Preview puts every proposed goal into memory, runs the full ordinary block solver for
every enabled block, and compares aggregate real boundary flows with the response-model projection.
A mismatch is measured against the good's gross factory throughput, not its near-zero net after
producer and consumer cancellation. If that mismatch exceeds 0.5%, or the next goal vector still
contains a change over the 1% balanced-rate tolerance, Scenario rebuilds the local responses around
the proposed vector and tries again, up to a bounded pass limit. Zero transitions remain meaningful
regardless of percentage. Free energy boundaries are excluded from this material-residual check;
their external slack is intentionally unconstrained. Any broken block or remaining material
mismatch rejects the plan before a write. Apply repeats the full validation as a final safety check,
then persists the settled rates as one **Balance pinned factory** undo action.

The Scenario response retains the final validation evidence instead of reducing it to a status:
blocks that fail their full solve include their proposed goal vector, solve status, message, and
unmade goods; aggregate failures include the largest expected-versus-actual material discrepancies
and goals that did not settle between response passes. The Scenario UI links block failures back to
their editor and shows the diagnostic rates without requiring structured trace capture.

When the factory LP itself is infeasible, Scenario diagnoses closed material conflicts by relaxing
one material-balance equality at a time while keeping every pin, producer cap, and other balance
fixed. If that single relaxation makes the model optimal, its shortage or excess is actionable
evidence. The diagnostic reports required and available rates plus each contributing block. It also
marks a configured producer whose local response column has no positive marginal output for the
good, which distinguishes an absent producer from a multi-goal block that cannot scale the requested
coproduct in its current recipe basis.

Stock pins describe desired net replenishment, but a stock block may also feed internal consumers.
Its solved gross production is stored as `factoryRate` while the visible `stock` and `window` remain
authoritative for the buffer target. User edits to either stock control clear that computed override.

When `factorySolverDebug` is enabled in app config through **Settings → Advanced**, preview and
apply create a bounded structured trace in `factory-debug.server.ts`. It records the pins, required
goods, response columns, generated LP model, re-linearization validation, imports, surplus, and final
result. Only the latest trace is retained in process; the server functions
return it to the Advanced settings card without writing planner data to disk.

### Primary outputs and byproducts

Only reached explicit positive goals can run to satisfy demand. Their response columns include
all natural coproducts, which offset demand for the same good or feed a configured consumer. Those
coproducts cannot add a positive producer, and producer caps prevent them from running their source
block solely to make more. Remaining demand falls through to another selected positive producer or
a raw import.

This preserves the same boundary semantics as a single block: incidental production can
offset demand but cannot silently redefine the plan. After the factory LP solves, Scenario assigns
the useful portion of same-block coproduct output back to that block's configured goal. For fluids,
that assignment is made per exact source temperature using the LP's solved range-transfer amounts;
compatible source allocations are recombined only after routing, because the saved block still has
one base-fluid goal. The LP's marginal dedicated activity, total factory use, block output, and
remaining surplus stay distinct. The subsequent full block solve verifies that retaining this
minimum goal does not activate extra recipes before preview or apply can succeed.

### Supply priority

Blocks expose Preferred, Normal, and Fallback tiers, with numeric tiers available for
advanced control. A block can override its default priority for one exported good.

Priority chooses among configured goal columns for the same required good. It does not change
block-internal pins or the normalized recipe solve, and it never promotes an incidental output to
a demand-reachable producer.

### Energy boundaries

Electricity is grid-distributed and participates in Factory Scenario like another factory material.
A configured `pyops-electricity` goal is a scalable supplier: exact count pins retain fixed built
generation while any unpinned generator chain in the same block supplies the remainder. Scaling
power can increase fuel, water, and material production whose machines consume more electricity;
the factory LP represents that feedback directly and the ordinary re-linearization passes update it
until the real block solves converge. With no configured electricity supplier, the remaining grid
demand stays a raw external import.

Heat remains block-local, so `pyops-heat` is still a free Factory Scenario boundary. Existing heat
goals remain fixed instead of being zeroed as unreached material goals, and the real block re-solve
reports any external heat need.

`pyops-fluid-fuel` is a normal matchable good. A block with a primary fluid-fuel energy goal
can scale as a dedicated supplier; a byproduct energy export remains capped like any other
incidental offer.

## Verification

Keep solver tests close to the mathematical layer:

- `lp.test.ts` for constraints, cycles, boundary flows, and deterministic outcomes;
- `diagnose.test.ts` for provenance and repair sets;
- `temps.test.ts` for temperature expansion and folding;
- `quality.test.ts` for the quality split, range expansion, and a hand-derived recycler loop;
- `quality-effects.test.ts` and `block-quality.test.ts` for entity quality and a quality block
  solved end to end;
- `subblock.test.ts` for nested contracts and flat-equivalence cases;
- focused compute/effects tests for machines, fuels, modules, research, and cached results;
- `factory-plan.test.ts` for pins, reachability, imports, and validated apply;
- `factory-solve.test.ts` for the assistant's scaling analysis.

When changing a user gesture, test both the persisted document mapping and the resulting LP
constraint. Run `vp test` and `vp check`, then exercise the corresponding editor flow and
its infeasible or edge state through Playwright.

### Py parity check

A change that must not move Py results, such as each quality stage, runs the parity check on
a full Py project before merging. `app/scripts/parity.ts` re-solves every block and compares
each block's solve status, electricity, pollution, `block_flows`, and `block_machines`
between two code versions. Values must match exactly.

The snapshot command copies the project database to a temporary file and solves the copy, so
the source file is only read. Point it at a copy anyway when the project is someone's real
data. Take the base snapshot from a detached `main` worktree and the head snapshot from your
branch, using the same database, then diff them. Run each from that checkout's `app/`:

```sh
git worktree add --detach ../pyops-main origin/main
(cd ../pyops-main/app && vp install && vp run parity snapshot /path/to/copy.db /tmp/base.json)
vp run parity snapshot /path/to/copy.db /tmp/head.json
vp run parity diff /tmp/base.json /tmp/head.json
```

`diff` prints each changed block with the changed values, `-` for rows only in the base, and
`+` for rows only in the head. The cache tables allow duplicate rows, so it compares row
counts too and marks an extra copy with `(×n)`. It exits 1 when anything differs. Columns that are null on
every row are left out of the snapshot, so a new nullable column does not count as a change.
Two snapshots of the same code and database are identical, so any difference is real.
