import highsLoader from "highs";

/**
 * LP block solver (v2, #91) — the gesture-derived block model on a HiGHS core.
 *
 * A block = goals (≥, both directions) + chosen recipes + a `made` set + pins.
 * We solve for nonnegative recipe run-rates (executions/sec):
 *   - a produce goal is `net(item) ≥ rate` — self-tightening under the
 *     minimizing objective, so it binds at exactly `rate` unless chemistry
 *     forces surplus (which exports; that's a fact, not an error)
 *   - a consume goal (rate < 0, SINK blocks) is `net(item) ≤ -|rate|`
 *   - a `made` item is `net ≥ 0`: production covers consumption, surplus
 *     exports, imports are forbidden — the rule that makes the block a plan
 *     instead of a shopping list
 *   - every other item is free: consumption imports, incidental byproduct
 *     production offsets the import, surplus exports. A byproduct is never
 *     scaled up to cover demand.
 *   - pins constrain single recipes (rate =, rate ≤) or item fan-out (a
 *     consumer takes a share of the item's production).
 * Objective: minimize machine-seconds (Σ energyRequired × rate) with a tiny
 * epsilon per recipe so zero-cost synthetic recipes (burning, venting) cannot
 * create non-unique optima. Same input → identical output.
 *
 * No dispositions, no relaxation, no loop-cutting: the LP either solves or is
 * infeasible, and infeasibility gets diagnosed (diagnose.ts), never silently
 * patched. Every constraint carries PROVENANCE — the user gesture it came
 * from — so a diagnosis can only ever name things the user can click.
 */

export type Component = { kind: string; name: string; amount: number; probability?: number | null };
export type RecipeDef = {
  name: string;
  energyRequired: number; // seconds per execution at crafting speed 1
  ingredients: Component[];
  products: Component[];
};

/** Per-recipe or per-edge constraint, in solver units (executions/sec — the
 * caller converts building counts via per-building craft rates). */
export type Pin =
  /** "always run at exactly this rate" — supply-push (fixed building count) */
  | { kind: "rate"; recipe: string; rate: number }
  /** "at most this rate" — a built-capacity ceiling; solver fits inside */
  | { kind: "cap"; recipe: string; rate: number }
  /** "this consumer takes `share` of `item`'s production" — base "remaining"
   * applies the share after rate-pinned consumers' fixed intake is subtracted.
   * `ofItems` overrides the production base (used by the temperature expansion:
   * the consumer eats a pool good, but the base is the real variants) */
  | {
      kind: "share";
      item: string;
      recipe: string;
      share: number;
      base?: "total" | "remaining";
      ofItems?: string[];
    };

export type LpBlockInput = {
  /** rate > 0: produce ≥ rate/s in-block. rate < 0: consume ≥ |rate|/s (SINK). */
  goals: { name: string; rate: number }[];
  recipes: RecipeDef[];
  /** items claimed produced in-block (net ≥ 0). Produce-goal items are
   * implicitly made; listing them again is harmless. */
  made?: string[];
  pins?: Pin[];
  /** whole-machine mode (#98): per-recipe executions/sec of ONE building (the
   * caller's real per-building craft rate). When present, each listed recipe
   * gets an integer building count n with rate ≤ n × perBuilding, a small
   * objective weight lands n on the ceiling, and the result reports it in
   * `wholeMachines` — machines may idle; the rates stay exact. */
  machineRates?: Record<string, number>;
};

/** The user gesture a constraint came from — the unit of diagnosis. */
export type Provenance =
  | { type: "goal"; item: string; rate: number }
  | { type: "made"; item: string }
  | { type: "pin-rate"; recipe: string; rate: number }
  | { type: "pin-cap"; recipe: string; rate: number }
  | { type: "pin-share"; item: string; recipe: string; share: number };

export type Flow = { name: string; kind: string; rate: number };

export type LpBlockResult = {
  status: "solved" | "infeasible" | "error";
  message?: string;
  /** recipe name → executions/sec, and machine-seconds/sec (= speed-1 machine count) */
  recipes: { recipe: string; rate: number; machines1x: number }[];
  imports: Flow[];
  exports: Flow[];
  /** produce goals nothing in-block makes — the constraint is dropped (reported,
   * not enforced) so the rest of the block still solves and the UI flags exactly
   * these with "add a recipe". A `made` mark with no producer is NOT listed here:
   * it degrades silently to an import (a mark that can't be honored is a
   * non-event, not a warning). */
  unmade?: string[];
  /** whole-machine mode (#98): recipe → integer building count (the ceiling
   * the solve committed to; the recipe's rate may leave it partly idle) */
  wholeMachines?: Record<string, number>;
};

/** Tiny per-recipe objective cost so zero-time recipes still cost something —
 * keeps every optimum unique and every solve deterministic. */
const EPSILON_COST = 1e-6;
/** Flows below this are solver noise, not real boundary traffic. */
const FLOW_EPS = 1e-9;

let highsP: ReturnType<typeof highsLoader> | null = null;
const getHighs = () => (highsP ??= highsLoader());

const num = (n: number) => Math.abs(n).toString();
const sign = (n: number) => (n < 0 ? "-" : "+");
const term = (coef: number, v: string) => `${sign(coef)} ${num(coef)} ${v}`;

/** One LP row with its provenance. `parts` are signed terms over x0..xn;
 * the full row text is `<parts> <op> <rhs>`. */
export type ModelConstraint = {
  id: string; // LP-safe row name
  parts: string[];
  op: ">=" | "<=" | "=";
  rhs: number;
  prov: Provenance;
};

export type BlockModel = {
  recipes: RecipeDef[];
  constraints: ModelConstraint[];
  unmade: string[];
  coeff: Record<string, number[]>;
  kindOf: Record<string, string>;
  goalRate: Map<string, number>;
};

/** constraint names are labels only — item names can hold LP-hostile chars */
const cname = (s: string) => s.replace(/[^A-Za-z0-9]/g, "_");

/** Build the constraint model (pure, deterministic, no solver). Pins become
 * named rows — not Bounds entries — so diagnosis can slack and name them. */
export function buildModel(input: LpBlockInput): BlockModel {
  const { recipes, goals } = input;
  const madeSet = new Set(input.made ?? []);
  const pins = input.pins ?? [];
  const n = recipes.length;

  // net coefficient per (item, recipe): produced − consumed per execution
  // (expected amounts — probability folds into products, matching v1)
  const coeff: Record<string, number[]> = {};
  const produced: Record<string, boolean> = {};
  const kindOf: Record<string, string> = {};
  const row = (item: string) => (coeff[item] ??= Array.from({ length: n }, () => 0));
  recipes.forEach((r, i) => {
    for (const ing of r.ingredients) {
      row(ing.name)[i] -= ing.amount;
      kindOf[ing.name] = ing.kind;
    }
    for (const p of r.products) {
      row(p.name)[i] += p.amount * (p.probability ?? 1);
      if (p.amount > 0) produced[p.name] = true;
      kindOf[p.name] = p.kind;
    }
  });

  const unmade: string[] = [];
  const constraints: ModelConstraint[] = [];
  const varOf = (i: number) => `x${i}`;
  const idxOf = new Map(recipes.map((r, i) => [r.name, i]));
  const netParts = (c: number[]) => c.flatMap((v, i) => (v !== 0 ? [term(v, varOf(i))] : []));

  for (const g of goals) {
    const c = coeff[g.name];
    if (!c || (g.rate >= 0 && !produced[g.name])) {
      // a produce goal nothing makes (or a goal on an untouched item) can't be
      // enforced without zeroing the block — report instead
      unmade.push(g.name);
      continue;
    }
    constraints.push({
      id: `goal_${cname(g.name)}`,
      parts: netParts(c),
      op: g.rate >= 0 ? ">=" : "<=",
      rhs: g.rate,
      prov: { type: "goal", item: g.name, rate: g.rate },
    });
  }
  const goalRate = new Map(goals.map((g) => [g.name, g.rate]));

  for (const item of madeSet) {
    if (goalRate.has(item)) continue; // the goal constraint subsumes net ≥ 0
    const c = coeff[item];
    if (!c) continue; // stale mark on an item nothing touches — inert
    if (!produced[item]) {
      // marked made but nothing in-block produces it: degrade silently to an
      // import (net < 0). A made mark is a soft "cover this here" — when it
      // can't be honored the graceful answer is to import, NOT to nag. Only a
      // GOAL with no producer earns the "add a recipe" flag (the user asked
      // for that output); a made mark that can't be met is a non-event.
      continue;
    }
    constraints.push({
      id: `made_${cname(item)}`,
      parts: netParts(c),
      op: ">=",
      rhs: 0,
      prov: { type: "made", item },
    });
  }

  const fixedRate = new Map<string, number>();
  for (const p of pins) {
    if (p.kind === "rate") {
      const i = idxOf.get(p.recipe);
      if (i == null) continue;
      fixedRate.set(p.recipe, p.rate);
      constraints.push({
        id: `pin_${i}`,
        parts: [term(1, varOf(i))],
        op: "=",
        rhs: p.rate,
        prov: { type: "pin-rate", recipe: p.recipe, rate: p.rate },
      });
    } else if (p.kind === "cap") {
      const i = idxOf.get(p.recipe);
      if (i == null) continue;
      constraints.push({
        id: `cap_${i}`,
        parts: [term(1, varOf(i))],
        op: "<=",
        rhs: p.rate,
        prov: { type: "pin-cap", recipe: p.recipe, rate: p.rate },
      });
    }
  }
  for (const p of pins) {
    if (p.kind !== "share") continue;
    const i = idxOf.get(p.recipe);
    const c = coeff[p.item];
    if (i == null || !c) continue;
    const intake = recipes[i].ingredients.find((g) => g.name === p.item)?.amount ?? 0;
    if (intake <= 0) continue;
    // consumption_r = share × (total production − rate-pinned consumers' intake)
    let fixedConsumed = 0;
    if ((p.base ?? "remaining") === "remaining") {
      for (const [rec, rate] of fixedRate) {
        if (rec === p.recipe) continue;
        const ri = idxOf.get(rec)!;
        const ringr = recipes[ri].ingredients.find((g) => g.name === p.item)?.amount ?? 0;
        fixedConsumed += ringr * rate;
      }
    }
    // intake·x_i − share·Σ prod_coef·x = −share·fixedConsumed
    const baseItems = new Set(p.ofItems ?? [p.item]);
    const parts = [term(intake, varOf(i))];
    recipes.forEach((r, j) => {
      const prod = r.products.reduce(
        (s, pr) => (baseItems.has(pr.name) ? s + pr.amount * (pr.probability ?? 1) : s),
        0,
      );
      if (prod > 0) parts.push(term(-p.share * prod, varOf(j)));
    });
    constraints.push({
      id: `share_${cname(p.item)}_${i}`,
      parts,
      op: "=",
      rhs: -p.share * fixedConsumed,
      prov: { type: "pin-share", item: p.item, recipe: p.recipe, share: p.share },
    });
  }

  return { recipes, constraints, unmade, coeff, kindOf, goalRate };
}

/** Assemble and solve an LP over a model's recipes: the standard objective plus
 * the given rows (callers may add slack columns via `extraCols`/patched rows).
 * Low-level — shared by the solve and the diagnosis passes. */
export async function runLp(
  recipes: RecipeDef[],
  rows: { id: string; parts: string[]; op: string; rhs: number }[],
  opts: { objective?: string; extraBounds?: string[]; integers?: string[] } = {},
): Promise<{ status: string; primal: (v: string) => number }> {
  const varOf = (i: number) => `x${i}`;
  const obj =
    opts.objective ??
    recipes.map((r, i) => term(Math.max(0, r.energyRequired) + EPSILON_COST, varOf(i))).join(" ");
  const body = rows.length
    ? rows.map((c) => `${c.id}: ${c.parts.join(" ")} ${c.op} ${c.rhs}`).join("\n ")
    : `free: ${term(1, varOf(0))} >= 0`;
  const lp = `Minimize\n obj: ${obj}\nSubject To\n ${body}\nBounds\n ${(
    opts.extraBounds ?? []
  ).join("\n ")}\n${opts.integers?.length ? `General\n ${opts.integers.join(" ")}\n` : ""}End`;
  const highs = await getHighs();
  const sol = highs.solve(lp);
  return {
    status: sol.Status,
    primal: (v: string) => {
      const col = sol.Columns[v];
      // infeasible-solution columns carry no Primal — treat as 0
      return col && "Primal" in col && typeof col.Primal === "number" ? col.Primal : 0;
    },
  };
}

export async function solveBlockLp(input: LpBlockInput): Promise<LpBlockResult> {
  const model = buildModel(input);
  const { recipes, constraints, unmade, coeff, kindOf, goalRate } = model;
  const n = recipes.length;
  const unmadeOut = unmade.length ? { unmade } : {};
  const empty = { recipes: [], imports: [], exports: [] };

  if (n === 0) return { status: "solved", ...empty, ...unmadeOut };

  // Whole-machine mode (#98): an integer n_i per recipe with a known
  // per-building rate; x_i ≤ n_i·perBuilding plus a small n cost lands n_i on
  // ceil(x_i/perBuilding). Rates stay exact; the integers are the commitment.
  const mr = input.machineRates ?? {};
  const rows = [...constraints];
  const integers: string[] = [];
  const nOf = new Map<number, string>();
  recipes.forEach((r, i) => {
    const per = mr[r.name];
    if (per == null || !(per > 0)) return;
    const nv = `n${i}`;
    integers.push(nv);
    nOf.set(i, nv);
    rows.push({
      id: `whole_${i}`,
      parts: [term(1, `x${i}`), term(-per, nv)],
      op: "<=",
      rhs: 0,
      // provenance is unused here — whole_ rows never reach diagnosis (the
      // diagnose pass builds its own model without machineRates)
      prov: { type: "pin-cap", recipe: r.name, rate: 0 },
    });
  });
  const wholeObj = integers.length
    ? [
        ...recipes.map((r, i) => term(Math.max(0, r.energyRequired) + EPSILON_COST, `x${i}`)),
        // any positive weight makes each n minimal given x
        ...integers.map((v) => term(EPSILON_COST, v)),
      ].join(" ")
    : undefined;

  let sol: Awaited<ReturnType<typeof runLp>>;
  try {
    sol = await runLp(recipes, rows, { integers, objective: wholeObj });
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : String(e),
      ...empty,
      ...unmadeOut,
    };
  }

  if (sol.status === "Infeasible") {
    return {
      status: "infeasible",
      message: "No rates satisfy the goals, made items, and pins together.",
      ...empty,
      ...unmadeOut,
    };
  }
  if (sol.status !== "Optimal") {
    return { status: "error", message: `solver returned ${sol.status}`, ...empty, ...unmadeOut };
  }

  const rates = recipes.map((_, i) => {
    const v = sol.primal(`x${i}`);
    return Math.abs(v) > FLOW_EPS ? v : 0;
  });

  // boundary flows: net per item; a produce goal's own rate is not an export
  // (only its surplus is), a consume goal's draw shows as the import it is
  const imports: Flow[] = [];
  const exports: Flow[] = [];
  for (const [item, c] of Object.entries(coeff)) {
    const net = c.reduce((s, v, i) => s + v * rates[i], 0);
    const goal = goalRate.get(item);
    let boundary = net;
    if (goal != null && goal >= 0 && !unmade.includes(item)) boundary = net - goal;
    if (boundary > FLOW_EPS) exports.push({ name: item, kind: kindOf[item], rate: boundary });
    else if (boundary < -FLOW_EPS)
      imports.push({ name: item, kind: kindOf[item], rate: -boundary });
  }
  imports.sort((a, b) => (a.name < b.name ? -1 : 1));
  exports.sort((a, b) => (a.name < b.name ? -1 : 1));

  const wholeMachines: Record<string, number> = {};
  for (const [i, nv] of nOf) wholeMachines[recipes[i].name] = Math.round(sol.primal(nv));

  return {
    status: "solved",
    recipes: recipes.map((r, i) => ({
      recipe: r.name,
      rate: rates[i],
      machines1x: rates[i] * r.energyRequired,
    })),
    imports,
    exports,
    ...unmadeOut,
    ...(nOf.size ? { wholeMachines } : {}),
  };
}
