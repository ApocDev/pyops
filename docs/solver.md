# Block solver

Code: `app/src/solver/` (`block.ts`, `linalg.ts`), with effect aggregation in
`app/src/server/effects.ts` and the factory-level solver in
`app/src/server/factory-solve.ts`.

## The block solver

A block is a set of declared output **goals** + a set of chosen recipes + per-item
dispositions. Each goal has a **target rate** — stored per-second always; a goal's
optional `unit` (`s`/`min`/`h`) is purely the display/input window the editor converts
at (#10), so the solver never sees units. A **stock goal** (#38, `stock` + `window` on
the goal) means "keep N on hand": its rate is derived (`stock / window`, default
10 min), so the solver still sees an ordinary per-second target — the machines are
sized to rebuild the buffer within the window — while its cached boundary flow gets
role `"stock"` so the factory ledger can badge refill demands apart from continuous
throughput. Each goal becomes a solver equation — the
block is sized so that good comes out at exactly that rate; `goals[0]` names the
block, anchors the rate-scaling tools, and is the default icon (the block editor can
override the icon with any item/fluid, stored as `icon` in the block doc). A good you
don't target isn't a goal —
it falls out as a byproduct (export) or import. If the goals can't be jointly
satisfied (e.g. two goods locked to a fixed ratio by one recipe) the block is
**infeasible** and says so. See `app/src/lib/goals.ts` for the model and the
migration from the legacy single-`target` shape. The solver builds a **sparse linear
system** and solves for recipe run-rates (executions/sec):

- Goals and `balance` items become equations (net production = target / 0).
- `import` / `export` items carry no equation — their net is a free boundary flow.
- Default disposition: a good produced **and** consumed in-block balances to zero;
  produced-only becomes an export, consumed-only an import.

A recipe can be **disabled** (`disabledRecipes` in the block doc): it stays in the
block, keeping its machine/fuel/module picks, but is filtered out before the system is
built, so it adds no equations, boundary flows, or building counts — as if it weren't
there. Use it to A/B two recipes for the same output, or to stage rows you'll enable
later. A whole block can likewise be disabled (`blocks.enabled = false`): it still
opens and solves for editing, but every factory-wide rollup (totals, coherence,
suppliers, machine counts, what-if) skips it.

Rows can be grouped into **sub-blocks** (`rowGroups` + `recipeGroups` in the block
doc) — named, collapsible groups the editor renders as one folded line with the
chain's net flows (member products minus member ingredients; intermediates cancel).
Display-only: the groups never reach the solver, which sees the same flat recipe set
either way (`app/src/lib/row-groups.ts` holds the pure grouping/net-flow logic).

A goal that **no recipe in the block makes** (an unfinished block, or one whose
producer vanished after a data migration) is _not_ pinned — pinning it would be a
zero-coefficient equation with a nonzero rate, forcing the whole least-squares solve
infeasible and masking an otherwise-valid block. Instead such goals are returned in
`unmadeTargets` and the rest of the block solves normally; the editor flags just
those goals ("no recipe — add one") and the sidebar/tabs tint the block amber. Note
the factory/coherence index still treats every goal as produced at its target rate
(goals are a declared _intent_), so an unmade goal won't show as a deficit there —
the per-block health flag is what surfaces it.

Recipes and splits are **user-chosen**, so there's no LP/optimizer here — it's a
least-squares solve (`linalg.ts`) that handles Py's cyclic recipe chains and
reports fractional building counts. Because the choices are the user's, the solver
faithfully shows imbalance rather than silently "fixing" it by swapping recipes.

Synthetic **spoiling** recipes (`kind = "spoiling"`, energy = the spoil time in
seconds) run in no machine — the items just sit in storage until they rot. For those
rows `computeBlock` reports a **spoil buffer** (#19): `rate × spoil time` items are
resident mid-spoil at steady state, shown on the row with the equivalent stack count
— the chest space a deliberate-decay step (uranium, nagesium) actually needs.

## Build cost (capital materials)

Separate from the per-second flows, `buildCost` (`db/queries.ts`, surfaced by
`computeBlock`) reports the **one-time** materials to _construct_ the block's
buildings: it ceils the solved machine counts per building type, expands each
building's own build recipe, and sums the direct ingredients. This is why a science
block needs steel — the buildings are made of it — even though no recipe in the
chain consumes steel (#38). It's direct ingredients only; producing those materials'
sub-chain is the factory ledger's job.

## Module and beacon effects

Module/beacon effects (`effects.ts`) apply **before** the solve:

- **Productivity** scales a recipe's products (a real balance change).
- **Speed** scales the machine count.
- **Consumption** scales power/fuel.

Factorio's clamps are respected: speed and consumption multipliers bottom out at
0.2, productivity caps at +300%.

## Factory-level what-if

The factory-level **what-if** (`factory-solve.ts`) _is_ an LP. It treats each block
as a fixed-ratio "super-recipe" (its cached boundary flows at the current rate) and
solves for the per-block scale factors that satisfy every demand.

Why an LP rather than the exact block solver: real Py factories can't balance every
good exactly — multi-product blocks force off-ratio surplus — so exact equality is
infeasible. The LP uses _production ≥ demand_ (surplus allowed) and minimizes total
scaling, which is always feasible and matches "scale each block up/down to meet
demand". It's report-only: it never writes; you adjust each block by hand (or
ignore the suggestion).
