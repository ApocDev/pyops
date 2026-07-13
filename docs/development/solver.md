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
stage.

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
consumer for an exported byproduct and that consumer's main product leaves the block. The
drain makes the selected recipe consume all surplus instead of remaining idle under the
minimizing objective. Secondary products may feed back into the chain; for example, pitch
refining is still a pitch drain when coke leaves and its secondary oils are reused.

`app/src/lib/sink-classify.ts` decides whether selecting a byproduct consumer should create
a drain or only mark the good as made. A reprocessor whose main product re-enters the block
is only marked made, avoiding an implicit restructure of the whole chain. Recipes without a
known main product use the conservative fallback: every non-input product must leave before
the consumer becomes a drain. Feedback into an explicit consume goal is also safe: selecting
Soot separation from an exported Soot chip creates a drain even though it returns Ash to an
Ash sink, because the sink goal continues to anchor the chain.

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

The LP core treats names as opaque goods. `temps.ts` rewrites the input when an enabled
consumer accepts a temperature range:

1. Each producer output becomes a `(fluid, temperature)` identity.
2. Each consumer range becomes a pool identity.
3. Zero-cost selector recipes convert every in-range temperature identity into the pool.
4. Consumers draw from the pool, allowing any mixture of valid temperatures.

This models range pooling rather than forcing one independent chain per exact temperature.
A made rule expands to its variants and pools. If no in-range producer exists, the result
can explain the required range, such as “nothing makes Water ≤101°”.

Fluids with no range-sensitive consumer remain bare goods and incur no expansion cost.
Boundary results are folded back to the localized base fluid, with temperature detail kept
for diagnostics.

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

Factorio's lower multiplier clamp of `0.2` is applied to speed, consumption, and pollution.
Productivity respects the recipe's maximum. `ignored_by_productivity` is an amount of output
that remains unscaled; only the remainder receives the multiplier.

Technology-derived recipe and mining productivity enter the same effects stage. Future
planning derives bonuses from the allowed technology set. **Now** mode can use exact force
and per-recipe values synchronized from the running save or entered through planning
settings.

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
power. Solid burners use the row's fuel selection. If the block produces that fuel, its burn
is represented inside the model so extra production and burnt results remain balanced.

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

`factory-plan.server.ts` solves the block at its complete goal vector, perturbs each goal in its
saved direction, and uses the boundary-flow difference as a local response column. Keeping sibling
goals active is essential because one block LP can change recipe bases as its goals interact. A
zero-rate goal is probed with a small signed reference rate, allowing a configured producer or
consumer to start without losing its saved direction.

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
consumer and cannot be supplemented by an external import. Imports carry the dominant objective
penalty; activity cost and supply priority break ties between configured producers. A missing
producer therefore becomes a raw import rather than making the model infeasible.

The actionable output is one change per goal—it never collapses a multi-goal block back to its
first goal. Preview puts every proposed goal into memory, runs the full ordinary block solver for
every enabled block, and compares aggregate real boundary flows with the response-model projection.
A mismatch is measured against the good's gross factory throughput, not its near-zero net after
producer and consumer cancellation. If that mismatch exceeds 0.5%, or the next goal vector still
contains a change over the 1% balanced-rate tolerance, Scenario rebuilds the local responses around
the proposed vector and tries again, up to a bounded pass limit. Zero transitions remain meaningful
regardless of percentage. Any broken block or remaining mismatch rejects the plan before a write.
Apply repeats the full validation as a final safety check, then persists the settled rates as one
**Balance pinned factory** undo action.

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
offset demand but cannot silently redefine the plan.

### Supply priority

Blocks expose Preferred, Normal, and Fallback tiers, with numeric tiers available for
advanced control. A block can override its default priority for one exported good.

Priority chooses among configured goal columns for the same required good. It does not change
block-internal pins or the normalized recipe solve, and it never promotes an incidental output to
a demand-reachable producer.

### Energy boundaries

Electricity remains grid-distributed and heat remains block-local, so
`pyops-electricity` and `pyops-heat` are free boundaries in Factory Scenario. Balancing
electricity through the same dependency model would create a power-production feedback
loop.

`pyops-fluid-fuel` is a normal matchable good. A block with a primary fluid-fuel energy goal
can scale as a dedicated supplier; a byproduct energy export remains capped like any other
incidental offer.

## Verification

Keep solver tests close to the mathematical layer:

- `lp.test.ts` for constraints, cycles, boundary flows, and deterministic outcomes;
- `diagnose.test.ts` for provenance and repair sets;
- `temps.test.ts` for temperature expansion and folding;
- `subblock.test.ts` for nested contracts and flat-equivalence cases;
- focused compute/effects tests for machines, fuels, modules, research, and cached results;
- `factory-plan.test.ts` for pins, reachability, imports, and validated apply;
- `factory-solve.test.ts` for the assistant's scaling analysis.

When changing a user gesture, test both the persisted document mapping and the resulting LP
constraint. Run `vp test` and `vp check`, then exercise the corresponding editor flow and
its infeasible or edge state through Playwright.
