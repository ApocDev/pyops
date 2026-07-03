# Block solver

Code: `app/src/solver/` (`lp.ts` — the LP core, `diagnose.ts` — root-cause
cards, `migrate.ts` — the legacy-doc mapping; `block.ts`/`linalg.ts` are the
retired v1 kept for reference), with effect aggregation in
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
- **Pins** (`pins` in the doc, in building counts) constrain single rows:
  `count` = always run exactly N buildings (supply-push — this is how byproducts
  route into in-block consumers), `cap` = at most N (a built-capacity ceiling;
  the diagnosis reports the shortfall in buildings when it binds), and `share` =
  this consumer takes a fraction of the item's production (base `remaining`
  applies it after count-pinned consumers' fixed intake). Counts convert to
  rates at solve time via the row's real per-building craft rate, so pins follow
  module/machine changes.

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
burner (Py oil/gas powerplants) is pinned to its filter fluid, and
`burns_fluid: false` sources (uf6 reactors, compost plants, the solar tower) are
temperature-fed — not fuel burners at all.

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
Display-only: the groups never reach the solver, which sees the same flat recipe set
either way (`app/src/lib/row-groups.ts` holds the pure grouping/net-flow logic).

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
