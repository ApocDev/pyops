import { solveLeastSquares } from "./linalg.ts";

/**
 * Linear-system block solver (v1).
 *
 * A block = declared output target(s) + a set of chosen recipes + per-item
 * dispositions. We solve for recipe run-rates (executions/sec):
 *   - pinned goals (the targets) and `balance` items become equations (net = rate / 0)
 *   - `import`/`export` items carry no equation; their net is a free boundary flow
 *   - default disposition: an item produced AND consumed in-block balances to 0;
 *     produced-only → export, consumed-only → import.
 *
 * v1 scope: fixed recipe choices, raw/mined items fall out as imports, fluids by
 * name (no temperature matching yet), no recipe selection / optimization.
 */

export type Component = { kind: string; name: string; amount: number; probability?: number | null };
export type RecipeDef = {
  name: string;
  energyRequired: number; // seconds per execution at crafting speed 1
  ingredients: Component[];
  products: Component[];
};
export type Disposition = "balance" | "export" | "import";

export type BlockInput = {
  targets: { name: string; rate: number }[]; // produce +rate per second (negative = consume)
  recipes: RecipeDef[];
  dispositions?: Record<string, Disposition>; // per-item override of the default
};

export type Flow = { name: string; kind: string; rate: number };
export type BlockResult = {
  status: "solved" | "relaxed" | "underdetermined" | "infeasible";
  message?: string;
  /** recipe name → executions/sec, and machine-seconds/sec (= speed-1 machine count) */
  recipes: { recipe: string; rate: number; machines1x: number }[];
  imports: Flow[];
  exports: Flow[];
  /** items whose in-block balance couldn't hold (an unclosed recycle loop); they
   * were sourced/sunk at the boundary so the rest of the block still solves. Each
   * appears in imports or exports. Add a recipe that makes/uses it to internalize. */
  autoFreed?: string[];
  /** recipes the solve forced to a negative run-rate (they'd have to run in
   * reverse) — the tell-tale of a cycle with no raw feed. When set, the boundary
   * flows are physically meaningless and are suppressed. */
  negativeRecipes?: string[];
  /** declared goals that no recipe in the block produces (an unfinished or
   * over-migrated block). These are NOT pinned — they can't force infeasibility —
   * so the rest of the block still solves; the UI flags just these goals with a
   * "no recipe — add one" hint. */
  unmadeTargets?: string[];
};

const EPS = 1e-6;

export function solveBlock(input: BlockInput): BlockResult {
  const { recipes, targets } = input;
  const dispositions = input.dispositions ?? {};
  const n = recipes.length;
  const empty = { recipes: [], imports: [], exports: [] };

  // net coefficient per (item, recipe): produced − consumed per execution (expected amount)
  const coeff: Record<string, number[]> = {};
  const produced: Record<string, boolean> = {};
  const consumed: Record<string, boolean> = {};
  const kindOf: Record<string, string> = {};
  const row = (item: string) => (coeff[item] ??= Array.from({ length: n }, () => 0));

  recipes.forEach((r, i) => {
    for (const ing of r.ingredients) {
      row(ing.name)[i] -= ing.amount;
      consumed[ing.name] = true;
      kindOf[ing.name] = ing.kind;
    }
    for (const p of r.products) {
      row(p.name)[i] += p.amount * (p.probability ?? 1);
      produced[p.name] = true;
      kindOf[p.name] = p.kind;
    }
  });

  const targetRate = new Map(targets.map((t) => [t.name, t.rate]));
  const items = Object.keys(coeff);
  const TOL = 1e-4;

  if (n === 0) {
    return {
      status: targets.length ? "underdetermined" : "solved",
      message: targets.length ? "No recipes added." : undefined,
      // with no recipes, every declared goal is unmade
      ...(targets.length ? { unmadeTargets: targets.map((t) => t.name) } : {}),
      ...empty,
    };
  }

  // Equations split into two tiers:
  //  - forced: targets (pinned outputs) and items the player explicitly marked
  //    "balance". These must hold; if they conflict it's a real infeasibility.
  //  - candidates: items auto-balanced because they're produced AND consumed
  //    in-block. In a recycle loop these can be linearly dependent and, if the
  //    loop doesn't self-close, inconsistent. We add them greedily and drop
  //    (auto-free to the boundary) any that would break consistency.
  type Eq = { item: string; b: number };
  const forced: Eq[] = [];
  const candidates: Eq[] = [];
  // Goals that no recipe in the block produces (an unfinished or over-migrated
  // block). We deliberately do NOT pin these: a goal with no producer has an
  // all-zero coefficient row, so forcing it to a nonzero rate makes the whole
  // least-squares solve infeasible and masks an otherwise valid block. Collect
  // them separately instead — the rest of the block solves, and the UI flags only
  // these goals with "add a recipe that makes this".
  const unmadeTargets: string[] = [];
  for (const item of items) {
    if (targetRate.has(item)) {
      if (produced[item]) forced.push({ item, b: targetRate.get(item)! });
      else unmadeTargets.push(item); // referenced in-block (consumed) but nothing makes it
      continue;
    }
    const d = dispositions[item];
    if (d === "import" || d === "export") continue; // free boundary flow
    if (d === "balance") forced.push({ item, b: 0 });
    else if (produced[item] && consumed[item]) candidates.push({ item, b: 0 });
  }
  // a target no recipe references at all (absent from `coeff`) is unmade too
  for (const t of targets) if (!(t.name in coeff)) unmadeTargets.push(t.name);
  const unmade = unmadeTargets.length ? { unmadeTargets } : {};

  const rowsOf = (eqs: Eq[]) => eqs.map((e) => coeff[e.item] ?? Array.from({ length: n }, () => 0));
  const solveOf = (eqs: Eq[]) =>
    solveLeastSquares(
      rowsOf(eqs),
      eqs.map((e) => e.b),
    );
  const consistent = (l: ReturnType<typeof solveOf>) => !!l && l.residual <= TOL;

  // Only items inside a directed recycle loop have a redundant balance equation
  // that's safe to free. Freeing a non-loop item would sever the chain and
  // trivialise a sub-block instead. So restrict cuts to strongly-connected
  // components of the item graph (item A → B when a recipe consumes A, makes B).
  const inCycle = cycleItems(recipes);

  // Keep every forced + candidate equation; if the full set is inconsistent, an
  // unclosed recycle loop is the cause. Iteratively free the one loop candidate
  // whose *removal* restores a consistent solve. Sorted by name so the lowest-tier
  // loop item (e.g. iron-pulp-02, the raw feed) is freed first.
  const active = [...candidates].sort((a, b) => (a.item < b.item ? -1 : 1));
  const autoFreed: string[] = [];
  for (;;) {
    const ls = solveOf([...forced, ...active]);
    if (consistent(ls) || !ls) break; // consistent, or underdetermined (can't fix by freeing)
    const cut = active.find(
      (c) =>
        inCycle.has(c.item) && consistent(solveOf([...forced, ...active.filter((x) => x !== c)])),
    );
    if (!cut) break; // no loop item frees it — a forced-tier conflict
    active.splice(active.indexOf(cut), 1);
    autoFreed.push(cut.item);
  }

  const kept = [...forced, ...active];
  const ls = solveOf(kept);
  if (!ls) {
    return {
      status: "underdetermined",
      message: `${n} recipes vs ${kept.length} constraints — add a target/recipe or balance an item to pin the rates.`,
      ...unmade,
      ...empty,
    };
  }
  if (ls.residual > TOL) {
    // only the forced tier can still conflict (targets / explicit balances)
    return {
      status: "infeasible",
      message:
        "Pinned targets or balanced items conflict — no exact solution. Adjust a target or free a balanced item.",
      ...unmade,
      ...empty,
    };
  }
  const x = ls.x;

  // boundary flows: net of every non-target item under the solved rates
  const byName = (a: Flow, b: Flow) => (a.name < b.name ? -1 : 1);
  const imports: Flow[] = [];
  const exports: Flow[] = [];
  for (const item of items) {
    if (targetRate.has(item)) continue;
    const net = coeff[item].reduce((s, c, i) => s + c * x[i], 0);
    if (net < -EPS) imports.push({ name: item, kind: kindOf[item] ?? "item", rate: -net });
    else if (net > EPS) exports.push({ name: item, kind: kindOf[item] ?? "item", rate: net });
  }

  const recipeRates = recipes.map((r, i) => ({
    recipe: r.name,
    rate: x[i],
    machines1x: x[i] * r.energyRequired,
  }));
  const negativeRecipes = recipeRates.filter((r) => r.rate < -EPS).map((r) => r.recipe);
  if (negativeRecipes.length) {
    // A consistent but negative solution means a cycle is being run in reverse —
    // almost always a loop with no raw feed. The boundary flows it implies are
    // fiction (reverse recipes "emit" their ingredients), so suppress them and
    // point at the backward recipes instead.
    return {
      status: "infeasible",
      message: `Chain runs backward: ${negativeRecipes.length} recipe(s) can't run forward — a cycle has no raw input. Add a recipe that feeds it, or mark a cycling item as "import".`,
      recipes: recipeRates,
      imports: [],
      exports: [],
      negativeRecipes,
      ...unmade,
      ...(autoFreed.length ? { autoFreed } : {}),
    };
  }

  return {
    status: autoFreed.length ? "relaxed" : "solved",
    message: autoFreed.length
      ? `Recycle loop won't self-close: ${autoFreed.join(", ")} sourced at the boundary. Add a recipe that makes it to internalize.`
      : undefined,
    recipes: recipeRates,
    imports: imports.sort(byName),
    exports: exports.sort(byName),
    ...unmade,
    ...(autoFreed.length ? { autoFreed } : {}),
  };
}

/**
 * Items that lie on a directed recycle loop: build the graph item A → B when some
 * recipe consumes A and produces B, then return every item in a non-trivial
 * strongly-connected component (Tarjan) or a single-recipe self-loop. Only these
 * have a linearly-dependent balance equation that's safe to free.
 */
export function cycleItems(recipes: RecipeDef[]): Set<string> {
  const adj: Record<string, Set<string>> = {};
  const selfLoop = new Set<string>();
  for (const r of recipes) {
    for (const g of r.ingredients) {
      for (const p of r.products) {
        if (g.name === p.name) selfLoop.add(g.name);
        else (adj[g.name] ??= new Set()).add(p.name);
      }
    }
  }

  const index: Record<string, number> = {};
  const low: Record<string, number> = {};
  const onStack: Record<string, boolean> = {};
  const stack: string[] = [];
  const result = new Set<string>(selfLoop);
  let idx = 0;

  const connect = (v: string) => {
    index[v] = low[v] = idx++;
    stack.push(v);
    onStack[v] = true;
    for (const w of adj[v] ?? []) {
      if (index[w] === undefined) {
        connect(w);
        low[v] = Math.min(low[v], low[w]);
      } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
    }
    if (low[v] === index[v]) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack[w] = false;
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) for (const c of comp) result.add(c);
    }
  };
  for (const v of Object.keys(adj)) if (index[v] === undefined) connect(v);
  return result;
}
