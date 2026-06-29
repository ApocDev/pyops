# Block solver

Code: `app/src/solver/` (`block.ts`, `linalg.ts`), with effect aggregation in
`app/src/server/effects.ts` and the factory-level solver in
`app/src/server/factory-solve.ts`.

## The block solver

A block is a set of declared output **goals** + a set of chosen recipes + per-item
dispositions. Each goal has a **target rate** and becomes a solver equation — the
block is sized so that good comes out at exactly that rate; `goals[0]` names the
block/icon and anchors the rate-scaling tools. A good you don't target isn't a goal —
it falls out as a byproduct (export) or import. If the goals can't be jointly
satisfied (e.g. two goods locked to a fixed ratio by one recipe) the block is
**infeasible** and says so. See `app/src/lib/goals.ts` for the model and the
migration from the legacy single-`target` shape. The solver builds a **sparse linear
system** and solves for recipe run-rates (executions/sec):

- Goals and `balance` items become equations (net production = target / 0).
- `import` / `export` items carry no equation — their net is a free boundary flow.
- Default disposition: a good produced **and** consumed in-block balances to zero;
  produced-only becomes an export, consumed-only an import.

Recipes and splits are **user-chosen**, so there's no LP/optimizer here — it's a
least-squares solve (`linalg.ts`) that handles Py's cyclic recipe chains and
reports fractional building counts. Because the choices are the user's, the solver
faithfully shows imbalance rather than silently "fixing" it by swapping recipes.

## Module and beacon effects

Module/beacon effects (`effects.ts`) apply **before** the solve:

- **Productivity** scales a recipe's products (a real balance change).
- **Speed** scales the machine count.
- **Consumption** scales power/fuel.

Factorio's clamps are respected: speed and consumption multipliers bottom out at
0.2, productivity caps at +300%.

## Factory-level what-if

The factory-level **what-if** (`factory-solve.ts`) *is* an LP. It treats each block
as a fixed-ratio "super-recipe" (its cached boundary flows at the current rate) and
solves for the per-block scale factors that satisfy every demand.

Why an LP rather than the exact block solver: real Py factories can't balance every
good exactly — multi-product blocks force off-ratio surplus — so exact equality is
infeasible. The LP uses *production ≥ demand* (surplus allowed) and minimizes total
scaling, which is always feasible and matches "scale each block up/down to meet
demand". It's report-only: it never writes; you adjust each block by hand (or
ignore the suggestion).
