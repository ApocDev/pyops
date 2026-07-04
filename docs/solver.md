# Block solver

Code: `app/src/solver/` (`lp.ts` — the LP core, `diagnose.ts` — root-cause
cards, `migrate.ts` — the legacy-doc mapping), with effect aggregation in
`app/src/server/effects.ts` and the factory-level solver in
`app/src/server/factory-solve.server.ts`.

## The block solver (v2, #91)

A block is **goals** + chosen recipes + a **`made` set** (items the block claims
in-block production for) + **pins**. The solve is a small LP (HiGHS, the same
engine as cost analysis): recipe run-rates are nonnegative variables, and the
objective minimizes machine-seconds (with a tiny epsilon per recipe so zero-cost
synthetic recipes can't create ties) — so identical inputs always solve
identically, and a `≥` goal binds at exactly its rate unless chemistry forces
surplus. Each goal has a **target rate** — stored per-second always; a goal's
optional `unit` (`s`/`min`/`h`) is purely the display/input window the editor converts
at (#10), so the solver never sees units. A **stock goal** (#38, `stock` + `window` on
the goal) means "keep N on hand": its rate is derived (`stock / window`, default
10 min), so the solver still sees an ordinary per-second target — the machines are
sized to rebuild the buffer within the window — while its cached boundary flow gets
role `"stock"` so the factory ledger can badge refill demands apart from continuous
throughput. Each goal becomes a `net ≥ rate`
constraint (a negative rate is a SINK block: `consume ≥ |rate|`) — a floor the
minimizing objective presses the plan down onto, so the good comes out at
exactly that rate unless a co-product ratio forces surplus (which simply
exports); `goals[0]` names the
block, anchors the rate-scaling tools, and is the default icon (the block editor can
override the icon with any item/fluid, stored as `icon` in the block doc). A good you
don't target isn't a goal — it falls out as a byproduct (export) or import. See
`app/src/lib/goals.ts` for the model and the migration from the legacy
single-`target` shape. The item rules:

- A **`made` item** gets `net ≥ 0`: production covers consumption, surplus
  exports, imports are forbidden — the rule that makes a block a plan instead of
  a shopping list. The set is built by gestures: setting a goal implies it, and
  adding a producer through an item's chip marks it; right-click toggles it; a
  removed recipe takes nothing with it implicitly.
- Every **other item is free**: consumption imports, surplus exports, and an
  incidental byproduct just offsets the import — a 0.02/s side-product of
  something else is never scaled up to cover a 10/s demand.
- **Draining a byproduct**: adding a consumer through a byproduct's chip marks
  the good made AND — when the chosen recipe is a pure sink (a void: no
  products, or only returning less of the same good) — records a **drain**
  (`net = 0`): the surplus must be consumed in-block, which is what forces a
  void to run at all (it produces nothing the objective wants). A reprocessing
  consumer needs no drain — once the good is made (import forbidden), recycling
  the surplus is cheaper than making more, so the optimizer uses it; without
  the made mark it would instead IMPORT the byproduct and idle the real
  producers. The solve also reports `importedProducible` — imports of goods an
  enabled in-block recipe produces, the tell-tale of that trap — and the import
  chip offers one click to claim the good in-block.
- **Pins** (`pins` in the doc, in building counts) constrain single rows:
  `count` = always run exactly N buildings (supply-push — this is how byproducts
  route into in-block consumers), `cap` = at most N (a built-capacity ceiling;
  the diagnosis reports the shortfall in buildings when it binds), and `share` =
  this consumer takes a fraction of the item's production (base `remaining`
  applies it after count-pinned consumers' fixed intake). Counts convert to
  rates at solve time via the row's real per-building craft rate, so pins follow
  module/machine changes.

**Fluid temperatures are real identities** (#110, `temps.ts`): when any enabled
consumer declares an accepted temperature range, that fluid expands — each
producer's output becomes a `(fluid, temperature)` variant (explicit product
temperature, else the prototype default), each consumer range becomes a pool
good, and zero-cost selector pseudo-recipes convert in-range variants into the
pool, so a range consumer draws from any mix of acceptable temperatures (range
POOLING, not YAFC's hard per-temperature split). A `made` mark expands to every
variant and pool, so a pool with no in-range producer reads as unmade —
"nothing makes water ≤101°" — and the interim per-producer warnings stay as the
complementary explanation of *which* producer misses *which* consumer. Fluids
no ranged consumer touches stay single bare goods (zero cost for most blocks);
boundary flows fold back to the bare fluid name. The whole thing is a pure
input transformation — the LP core never sees temperatures.

There are no per-item dispositions and no relaxed/underdetermined states: the LP
either **solves** or is **infeasible**, and infeasibility is diagnosed, never
silently patched. `diagnose.ts` extracts root-cause cards: an elastic pass finds
what's short (with magnitudes), violated constraints split into independent
problems by shared recipe variables, and each problem's variable neighborhood is
deletion-tested for IIS membership — a card lists exactly the gestures (goals,
made marks, pins) whose single removal repairs the block, each with a one-click
fix in the balance card. A diagnosis can only name things the user can click.
Legacy docs (pre-#91 `dispositions`) migrate on read: the server derives a
`made` set (`migrate.ts` — auto-balanced intermediates and `balance` overrides
become marks; `import`/`export` overrides unlink), echoes it on the result, and
the editor adopts it so the next save persists the new shape.

A recipe can be **disabled** (`disabledRecipes` in the block doc): it stays in the
block, keeping its machine/fuel/module picks, but is filtered out before the system is
built, so it adds no equations, boundary flows, or building counts — as if it weren't
there. Use it to A/B two recipes for the same output, or to stage rows you'll enable
later. A whole block can likewise be disabled (`blocks.enabled = false`): it still
opens and solves for editing, but every factory-wide rollup (totals, coherence,
suppliers, machine counts, what-if) skips it.

A block doc can carry **planned spoil losses** (#20, `spoilRates`: item → rot rate
/s). Each entry is merged into the solver targets as extra pinned net production —
surplus that rots in storage — so the chain is sized to cover the loss. The rotted
surplus never reaches the boundary flows (pinned items are excluded from exports),
which is correct: spoiled goods aren't available to other blocks.

`computeBlock` also rolls up a **pollution budget** (#23): per row, machine base
`emissions_per_minute` × count × energy-consumption multiplier × pollution-module
multiplier (per-fuel emissions multipliers are approximated as 1). Cached on the
block like `electricity_w` and summed in the Factory header.

**Fuel** folds into the balance by energy source. Electric draw nets as
`pyops-electricity` consumption post-solve; solid burners burn their per-row fuel
pick (folded post-solve, or modeled in the system when the block produces the fuel
itself — self-fueling — so ash and the extra production come out right). Fluid
burners (#25) have no pick: an **unfiltered** `burns_fluid` machine (Py glassworks,
smelter, antimony drill, oil boiler) burns _any_ fuel-valued fluid, so its draw is
modeled like heat — a `pyops-fluid-fuel` ingredient (1 unit = 1 MJ) the system must
balance. Adding a `burn-fluid-<fluid>` conversion recipe (1 fluid → its
`fuel_value` in MJ) sizes that conversion to the draw; the choice of conversion
decides which fluid burns, several split like any other multi-producer good, and
with none present the MJ surfaces as a "Fluid fuel" import. A **filtered** fluid
burner (Py oil/gas powerplants) is pinned to its filter fluid.
`burns_fluid: false` sources (uf6 reactors, compost plants, the solar tower) are
**temperature-fed** (#114): they drain their filter fluid for its heat content,
not a fuel value. The import derives the drain from the prototype
(`db/fluid-energy.ts`): a fixed units/s per machine — an explicit
`fluid_usage_per_tick` (neutron absorbers, the solar tower's 60/s) or the
engine's derivation from `maximum_temperature` (nuclear-reactor-mk01: 300 kW ÷
((250° − 0.01°) × 20 J/°) ≈ 60.0024 uf6/s) — or, for `scale_fluid_usage`
sources (compost plants), an energy-following one (the effectivity-folded draw
÷ usable J per unit, so consumption modules reduce it). The drain is injected
as a **real system ingredient** of the actual feed fluid — an in-block producer
covers it, otherwise it surfaces as an import — and the row's fuel chip mirrors
it (no per-row pick, never folded post-hoc).

A block can also be a **designated fuel supplier** (#115), exporting
`pyops-fluid-fuel` MJ for other blocks' generic draws. The designation is an
explicit routing gesture — a conversion recipe nothing demands honestly solves
to 0 — so either **pin `pyops-fluid-fuel` as a goal** (the conversion is sized to the
pinned MW and the MJ exports as a primary — a dedicated fuel farm)
or **route the feed fluid with a 100% share pin** on the conversion (all
production routes into it and the MJ exports as a byproduct — burning off
co-products). A block that merely
exports a fuel-valued fluid without a conversion is never conscripted as fuel
supply: kerosene sold as feedstock stays feedstock.

Reactor rows honour the **neighbour bonus** (#94): each adjacent working reactor
adds `neighbour_bonus` × base heat (Py's breeder reactor dumps `neighbour_bonus: 1`,
+100% per neighbour). The block doc can carry an assumed x×y farm per reactor row
(`reactorLayouts`), and the row's `pyops-heat` output is scaled by the grid's
average multiplier `1 + b·(4 − 2/x − 2/y)` (`app/src/lib/reactor.ts`) before the
solve — so a 2×2 farm needs a third of the flat-rated reactors. Only heat scales;
fuel burn stays per-reactor. No layout stored = 1×1 = no bonus. The row shows a
layout chip with the multiplier and a preset picker.

Rows can be grouped into **sub-blocks** (`rowGroups` + `recipeGroups` in the block
doc) — named, collapsible groups the editor renders as one folded line with the
chain's net flows (member products minus member ingredients; intermediates cancel).
By default (#7) they're **display-only**: the groups never reach the solver, which
sees the same flat recipe set either way (`app/src/lib/row-groups.ts` holds the pure
grouping/net-flow logic).

A group can be **promoted to a real, separately-solved module** (#76, `composed`
on the group + its own internal `goals`; `app/src/solver/subblock.ts`). A composed
sub-block is solved with `solveBlockLp` exactly like a top-level block — its
internal goals size it and its `made` set (auto = every good a member produces, so
it makes its own intermediates) keeps the intermediates hidden. Its net imports/
exports at the solved rates (temperatures folded to bare fluids) become a synthetic
"recipe" whose ingredients = the module's imports, products = its net exports
**including its goal output**, and `energyRequired` = the module's machine-seconds,
so the parent's objective weighs the module's real cost. The parent then solves
normally over its own recipes + these synthetic sub-block recipes, scaling each
module as one black box; a member's row still renders at its effective rate
(nested run-rate × the parent's chosen run-rate of the synthetic). The member
recipes, their pins, and whole-machine rates route into the module's solve; the
module's goal goods are claimed `made` at the parent so the minimizing objective
can't idle the module and import the good instead. The internal goals are **not**
parent goals — the module never looks like a factory-level producer of its goal —
but forced co-products stay on the contract, so they export as byproducts and the
factory coherence/byproduct model still sees them. A sub-block is a subset of one
parent block's recipes, solved first in isolation, so it can never depend on its
parent: the whole thing is deterministic and cycle-safe. The nested-solve contract
is unit-tested in `subblock.test.ts`, including a 2-level compose reproducing the
equivalent flat block's boundary flows.

Deferred for now (#76): the module carries only `goals` (its `made` is auto-derived,
not user-editable per group); a sub-block's own infeasibility surfaces as a status
badge on its header and, when its output can't be produced, as a parent-level
shortfall — it does not yet get its own IIS diagnosis cards. Sub-blocks don't nest
(a group's members are plain recipes, never other groups), and `spoilRates` stay a
parent-level concern.

A goal that **no recipe in the block makes** (an unfinished block, or one whose
producer vanished after a data migration) is _not_ enforced — that would zero
the rest of the block. Such goals (and `made` marks with no producer) are
returned in `unmade` and the rest of the block solves normally; the editor flags
just those ("no recipe — add one") and the sidebar/tabs tint the block amber. Note
the factory/coherence index still treats every goal as produced at its target rate
(goals are a declared _intent_), so an unmade goal won't show as a deficit there —
the per-block health flag is what surfaces it.

Recipes, marks, and pins are **user-chosen** — the LP's objective is only a
tie-breaker, never a recipe selector. It handles Py's cyclic recipe chains and
reports fractional building counts, and because every constraint traces to a
user gesture, a failure names the gesture rather than swapping recipes behind
your back.

Synthetic **spoiling** recipes (`kind = "spoiling"`, energy = the spoil time in
seconds) run in no machine — the items just sit in storage until they rot. For those
rows `computeBlock` reports a **spoil buffer** (#19): `rate × spoil time` items are
resident mid-spoil at steady state, shown on the row with the equivalent stack count
— the chest space a deliberate-decay step (uranium, nagesium) actually needs.

## Build cost (capital materials)

Separate from the per-second flows, `buildCost` (`db/queries.server.ts`, surfaced by
`computeBlock`) reports the **one-time** materials to _construct_ the block's
buildings: it ceils the solved machine counts per building type, expands each
building's own build recipe, and sums the direct ingredients. This is why a science
block needs steel — the buildings are made of it — even though no recipe in the
chain consumes steel (#38). It's direct ingredients only; producing those materials'
sub-chain is the factory ledger's job.

## Module and beacon effects

Module/beacon effects (`effects.ts`) apply **before** the solve:

- **Productivity** scales a recipe's products (a real balance change). Per
  Factorio 2.0, each product's `ignored_by_productivity` is an **amount**: that
  many units are catalytic and stay unscaled, only the remainder is multiplied
  (Kovarex: 41 U-235 out, 40 ignored; coal liquefaction: 90 heavy oil, 25
  ignored). The shared math lives in `lib/productivity.ts` (#93).
- **Speed** scales the machine count.
- **Consumption** scales power/fuel.
- **Pollution** scales the block's pollution budget (#23).

Factorio's clamps are respected: speed, consumption, and pollution multipliers
bottom out at 0.2, productivity caps at the recipe's `maximum_productivity`
(+300% by default — but Py raises it to 1e6 on nearly every recipe).

**Module auto-fill** (`module-fill.server.ts`) is **suggested, never applied**:
the solve only ever uses the doc's stored module picks, so a plan never
rearranges its modules behind the player's back (research unlocking a better
tier, or a count drifting across a whole-building boundary, changes the
_suggestion_, not the block). Each solve computes a per-row suggested fill by a
direct algorithm — no payback economics: if the recipe allows productivity,
every slot gets the best unlocked prod module; otherwise the row gets the
**fewest speed modules that reach the smallest whole building count**, with the
remaining slots on efficiency — past that floor, extra speed only shaves
fractions of a building you can't build, so those slots cut power instead.
Zero speed modules is a real answer (a row already under the floor, or modules
too weak to save a whole machine, suggests all-efficiency). The split is sized
against the row's module-less baseline with beacon and TURD speed included, so
planting speed beacons updates the suggestion to shed now-redundant speed
modules. Rows whose stored fill differs from the suggestion carry
`suggestedModules`; the UI shows a ✨ hint (gated by the Settings toggle) with
one-click apply, the modules dialog previews the suggestion, and the block
toolbar applies all suggestions at once (confirming when it would overwrite
rows that already have modules). The assistant's draft-a-block adopts the
suggestions as the draft's explicit picks and re-solves with them.

**Research-driven productivity** (#92) is folded into the same effects stage,
gated by the research horizon exactly like machine availability (everything in
FUTURE mode, reached techs in NOW/target): mining-productivity levels add an
uncapped bonus to every mining recipe (resources aren't recipes, so no cap
applies — matching in-game mining productivity exceeding +300%), and Factorio
2.0 `change-recipe-productivity` techs (Py's microfilters tiers) add base
productivity to their target recipes — applied even when the recipe doesn't
allow productivity **modules** (e.g. bhoddos-spore gets +100% from
microfilters-mk02 despite having no `allow_productivity`). Repeatable techs
(Py's infinite `mining-productivity-12`) count at most one level, since the
mod's research sync reports researched tech names, not levels.

## Factory-level what-if

The factory-level **what-if** (`factory-solve.server.ts`) _is_ an LP. It treats each block
as a fixed-ratio "super-recipe" (its cached boundary flows at the current rate) and
solves for the per-block scale factors that satisfy every demand.

Why an LP rather than the exact block solver: real Py factories can't balance every
good exactly — multi-product blocks force off-ratio surplus — so exact equality is
infeasible. The LP uses _production ≥ demand_ (surplus allowed) and minimizes total
scaling, which is always feasible and matches "scale each block up/down to meet
demand". It's report-only: it never writes; you adjust each block by hand (or
ignore the suggestion).

Two energy pseudo-goods stay **free boundaries** (never balanced across blocks):
`pyops-electricity` (grid-distributed — matching it would create a power feedback
loop) and `pyops-heat` (block-local by game rule). `pyops-fluid-fuel` is **not**
free (#115): a designated supplier's MJ export matches generic MJ imports
block-to-block like any other good — a primary MJ export classifies as an
intermediate the LP scales with demand, and an MJ import with no supplier
classifies as a raw, the signal to designate one.
