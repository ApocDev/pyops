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
  /** Direction remains explicit at zero; older inputs infer it from rate's sign. */
  goals: { name: string; rate: number; direction?: "produce" | "consume" }[];
  recipes: RecipeDef[];
  /** items claimed produced in-block (net ≥ 0). Produce-goal items are
   * implicitly made; listing them again is harmless. */
  made?: string[];
  pins?: Pin[];
  /** items whose surplus must be consumed in-block (net = 0): the
   * byproduct-drain gesture. Implies made; a designated sink/reprocessor
   * absorbs exactly the surplus, existing consumers unaffected. A produce-goal
   * item is never drained (the goal's ≥ takes precedence). */
  drains?: string[];
};

/** The user gesture a constraint came from — the unit of diagnosis. */
export type Provenance =
  | { type: "goal"; item: string; rate: number }
  | { type: "made"; item: string }
  | { type: "drain"; item: string }
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
};

/** Tiny per-recipe objective cost so zero-time recipes still cost something —
 * keeps every optimum unique and every solve deterministic. */
const EPSILON_COST = 1e-6;
/** Absolute floor: flows below this are solver noise, not real boundary traffic. */
const FLOW_EPS = 1e-9;
/** Relative floor: a boundary flow smaller than this fraction of an item's gross
 * in-block throughput is numerical dust from near-cancellation, not a real flow
 * (comfortably above HiGHS' ~1e-7 rate error, far below any meaningful flow). */
const DUST_REL = 1e-5;
/** Numerical room for the second, machine-minimizing stage to retain the
 * minimum goal surplus found by the first stage. */
const GOAL_LEX_TOL = 1e-7;

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
  const drainSet = new Set(input.drains ?? []);
  const madeSet = new Set([...(input.made ?? []), ...drainSet]);
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
    const consumes = g.direction === "consume" || g.rate < 0;
    if (!c || (!consumes && !produced[g.name])) {
      // a produce goal nothing makes (or a goal on an untouched item) can't be
      // enforced without zeroing the block — report instead
      unmade.push(g.name);
      continue;
    }
    constraints.push({
      id: `goal_${cname(g.name)}`,
      parts: netParts(c),
      op: consumes ? "<=" : ">=",
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
    // a drained item is net = 0: its surplus MUST be consumed in-block (the
    // byproduct-disposal gesture — a pure sink produces nothing the objective
    // wants, so only an equality makes it run); plain made is net ≥ 0
    const drained = drainSet.has(item);
    constraints.push({
      id: `${drained ? "drain" : "made"}_${cname(item)}`,
      parts: netParts(c),
      op: drained ? "=" : ">=",
      rhs: 0,
      prov: drained ? { type: "drain", item } : { type: "made", item },
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
  opts: { objective?: string; extraBounds?: string[] } = {},
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
  ).join("\n ")}\nEnd`;
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

  let sol: Awaited<ReturnType<typeof runLp>>;
  try {
    sol = await runLp(recipes, constraints);
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

  // Goals are floors/ceilings so forced chemistry can remain feasible, but
  // machine minimization alone may choose avoidable goal surplus. Example:
  // one recipe makes Coal + Coal gas while another turns Coal into more gas;
  // minimizing machines idles the second recipe and exports excess Coal even
  // when both saved goal rates can be met exactly.
  //
  // Keep the fast one-solve path when the machine optimum already binds every
  // goal. Otherwise solve lexicographically: minimize normalized goal surplus,
  // then minimize machines while retaining that optimum. Equality + a
  // nonnegative slack is exactly equivalent to the original one-sided goal.
  const goalRows = constraints.flatMap((row, index) => {
    if (row.prov.type !== "goal") return [];
    const slack = `goalSlack${index}`;
    const weight = 1 / Math.max(1, Math.abs(row.rhs));
    return [{ row, slack, weight }];
  });
  const goalSurplus = (solution: Awaited<ReturnType<typeof runLp>>) =>
    goalRows.reduce((sum, { row, weight }) => {
      const c = coeff[row.prov.type === "goal" ? row.prov.item : ""] ?? [];
      const net = c.reduce(
        (total, value, index) => total + value * solution.primal(`x${index}`),
        0,
      );
      const surplus = row.op === ">=" ? Math.max(0, net - row.rhs) : Math.max(0, row.rhs - net);
      return sum + weight * surplus;
    }, 0);
  const machineGoalSurplus = goalSurplus(sol);
  if (machineGoalSurplus > GOAL_LEX_TOL && goalRows.length > 0) {
    const goalBounds = goalRows.map(({ slack }) => `0 <= ${slack} <= 1e12`);
    const goalObjective = goalRows.map(({ slack, weight }) => term(weight, slack)).join(" ");
    const goalConstraints = constraints.map((row) => {
      const goal = goalRows.find((candidate) => candidate.row === row);
      if (!goal) return row;
      return {
        ...row,
        parts: [...row.parts, term(row.op === ">=" ? -1 : 1, goal.slack)],
        op: "=" as const,
      };
    });
    let goalSol: Awaited<ReturnType<typeof runLp>>;
    try {
      goalSol = await runLp(recipes, goalConstraints, {
        objective: goalObjective,
        extraBounds: goalBounds,
      });
    } catch (e) {
      return {
        status: "error",
        message: e instanceof Error ? e.message : String(e),
        ...empty,
        ...unmadeOut,
      };
    }
    if (goalSol.status !== "Optimal")
      return {
        status: goalSol.status === "Infeasible" ? "infeasible" : "error",
        message: `goal-tightening solve returned ${goalSol.status}`,
        ...empty,
        ...unmadeOut,
      };
    const minimumSurplus = goalRows.reduce(
      (sum, { slack, weight }) => sum + weight * goalSol.primal(slack),
      0,
    );
    if (minimumSurplus + GOAL_LEX_TOL < machineGoalSurplus) {
      const retainMinimum = {
        id: "goal_surplus_optimum",
        parts: goalRows.map(({ slack, weight }) => term(weight, slack)),
        op: "<=",
        rhs: minimumSurplus + GOAL_LEX_TOL * Math.max(1, minimumSurplus),
      };
      try {
        sol = await runLp(recipes, [...goalConstraints, retainMinimum], {
          extraBounds: goalBounds,
        });
      } catch (e) {
        return {
          status: "error",
          message: e instanceof Error ? e.message : String(e),
          ...empty,
          ...unmadeOut,
        };
      }
      if (sol.status !== "Optimal")
        return {
          status: sol.status === "Infeasible" ? "infeasible" : "error",
          message: `machine tie-break solve returned ${sol.status}`,
          ...empty,
          ...unmadeOut,
        };
    }
  }

  const rates = recipes.map((_, i) => {
    const v = sol.primal(`x${i}`);
    return Math.abs(v) > FLOW_EPS ? v : 0;
  });

  // boundary flows: net per item; a produce goal's own rate is not an export
  // (only its surplus is), a consume goal's draw shows as the import it is.
  //
  // The net is filtered RELATIVELY: a boundary below a small fraction of the
  // item's gross in-block throughput is solver dust, not a real flow. HiGHS
  // returns rates with ~1e-7 relative error; on a covered item (e.g. water made
  // by a pump and consumed by a barreler) the net is a near-cancellation of
  // large equal-and-opposite terms, which amplifies that error into a spurious
  // tiny import/export (275.0004 produced − 275 consumed = a phantom 0.0004
  // export). A flat epsilon can't catch it without also hiding real small
  // flows; a fraction of gross throughput distinguishes the two cleanly.
  const imports: Flow[] = [];
  const exports: Flow[] = [];
  for (const [item, c] of Object.entries(coeff)) {
    let net = 0;
    let gross = 0; // Σ|produced| + Σ|consumed| — the item's total in-block traffic
    for (let i = 0; i < c.length; i++) {
      const t = c[i] * rates[i];
      net += t;
      gross += Math.abs(t);
    }
    const goal = goalRate.get(item);
    let boundary = net;
    if (goal != null && goal >= 0 && !unmade.includes(item)) boundary = net - goal;
    const eps = Math.max(FLOW_EPS, DUST_REL * gross);
    if (boundary > eps) exports.push({ name: item, kind: kindOf[item], rate: boundary });
    else if (boundary < -eps) imports.push({ name: item, kind: kindOf[item], rate: -boundary });
  }
  imports.sort((a, b) => (a.name < b.name ? -1 : 1));
  exports.sort((a, b) => (a.name < b.name ? -1 : 1));

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
  };
}
