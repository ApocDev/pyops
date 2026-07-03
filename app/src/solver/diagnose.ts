import {
  buildModel,
  runLp,
  type LpBlockInput,
  type ModelConstraint,
  type Provenance,
} from "./lp.ts";

/**
 * Root-cause diagnosis for infeasible blocks (#91).
 *
 * Sized for blocks of hundreds of recipes — never brute force over every
 * constraint:
 *   1. ELASTIC pass — every constraint gets a slack variable, minimize total
 *      slack (uniform weights: cost-weighting would bias the "cause" toward
 *      cheap items, YAFC's mistake). The slack-positive constraints are
 *      what's SHORT, with magnitudes ("short by 3.2/s").
 *   2. Partition the violated constraints into connected components by shared
 *      recipe variables — independent problems become separate cards, not one
 *      smeared warning.
 *   3. Per component: test its variable NEIGHBORHOOD (only constraints
 *      touching the same recipes) for IIS membership — "does removing this
 *      one gesture alone repair the block?" Everything that does belongs on
 *      the card: they are the alternative one-click fixes.
 *
 * Every card member is a Provenance — a goal, a made mark, or a pin. The
 * diagnosis can only name things the user can click; that's a hard rule.
 */

export type DiagnosisMember = {
  prov: Provenance;
  /** how far this constraint was from holding (elastic pass), in the item's or
   * recipe's own units; 0 for members that aren't themselves short but whose
   * removal alone would repair the block (the alternative fixes) */
  shortBy: number;
};
export type DiagnosisCard = { members: DiagnosisMember[] };

const SLACK_TOL = 1e-6;
const MAX_CARDS = 5;

const varsOf = (c: ModelConstraint): Set<string> => {
  const s = new Set<string>();
  for (const p of c.parts) for (const m of p.match(/x\d+/g) ?? []) s.add(m);
  return s;
};
const overlaps = (a: Set<string>, b: Set<string>) => {
  for (const v of a) if (b.has(v)) return true;
  return false;
};

/** Elastic solve: minimize total constraint violation. Returns per-constraint
 * slack, or null when the elastic model itself failed (numerical error). */
async function elastic(
  recipes: LpBlockInput["recipes"],
  constraints: ModelConstraint[],
): Promise<Map<string, number> | null> {
  const rows = constraints.map((c, k) => {
    if (c.op === ">=") return { ...c, parts: [...c.parts, `+ 1 s${k}`] };
    if (c.op === "<=") return { ...c, parts: [...c.parts, `- 1 s${k}`] };
    return { ...c, parts: [...c.parts, `+ 1 s${k}p`, `- 1 s${k}m`] };
  });
  const slackVars = constraints.flatMap((c, k) =>
    c.op === "=" ? [`s${k}p`, `s${k}m`] : [`s${k}`],
  );
  const objective = slackVars.map((v) => `+ 1 ${v}`).join(" ");
  const sol = await runLp(recipes, rows, { objective });
  if (sol.status !== "Optimal") return null;
  const out = new Map<string, number>();
  constraints.forEach((c, k) => {
    const s = c.op === "=" ? sol.primal(`s${k}p`) + sol.primal(`s${k}m`) : sol.primal(`s${k}`);
    out.set(c.id, s);
  });
  return out;
}

async function feasible(
  recipes: LpBlockInput["recipes"],
  constraints: ModelConstraint[],
): Promise<boolean> {
  const sol = await runLp(recipes, constraints);
  return sol.status === "Optimal";
}

/** Group violated constraints into independent problems: two violations belong
 * to the same card iff their constraint rows share a recipe variable. */
function components(violated: ModelConstraint[]): ModelConstraint[][] {
  const groups: { vars: Set<string>; members: ModelConstraint[] }[] = [];
  for (const c of violated) {
    const vs = varsOf(c);
    const hit = groups.filter((g) => overlaps(g.vars, vs));
    if (!hit.length) {
      groups.push({ vars: vs, members: [c] });
    } else {
      // merge every group this constraint bridges
      const [first, ...rest] = hit;
      first.members.push(c);
      for (const v of vs) first.vars.add(v);
      for (const g of rest) {
        first.members.push(...g.members);
        for (const v of g.vars) first.vars.add(v);
        groups.splice(groups.indexOf(g), 1);
      }
    }
  }
  return groups.map((g) => g.members);
}

/** Diagnose an infeasible block into IIS cards. Empty array = feasible (or
 * nothing diagnosable — e.g. the failure was numerical, not structural). */
export async function diagnoseBlock(input: LpBlockInput): Promise<DiagnosisCard[]> {
  const model = buildModel(input);
  if (!model.recipes.length) return [];

  let active = [...model.constraints];
  const cards: DiagnosisCard[] = [];

  for (let round = 0; round < MAX_CARDS && cards.length < MAX_CARDS; round++) {
    if (await feasible(model.recipes, active)) break;

    const slack = await elastic(model.recipes, active);
    if (!slack) break; // elastic model failed — nothing structural to report

    const violated = active
      .filter((c) => (slack.get(c.id) ?? 0) > SLACK_TOL)
      .sort((a, b) => slack.get(b.id)! - slack.get(a.id)! || (a.id < b.id ? -1 : 1));
    if (!violated.length) break;

    const violatedIds = new Set(violated.map((c) => c.id));
    for (const comp of components(violated)) {
      if (cards.length >= MAX_CARDS) break;
      const compIds = new Set(comp.map((c) => c.id));
      // isolate this problem: relax the OTHER components' violated constraints
      const base = active.filter((c) => compIds.has(c.id) || !violatedIds.has(c.id));
      // neighborhood: constraints sharing a recipe variable with the component
      const compVars = new Set<string>();
      for (const c of comp) for (const v of varsOf(c)) compVars.add(v);
      const near = base.filter((c) => compIds.has(c.id) || overlaps(varsOf(c), compVars));

      // IIS membership: removing this one gesture alone repairs the block
      const members: DiagnosisMember[] = [];
      for (const c of near) {
        if (
          await feasible(
            model.recipes,
            base.filter((x) => x.id !== c.id),
          )
        ) {
          members.push({ prov: c.prov, shortBy: slack.get(c.id) ?? 0 });
        }
      }
      // overlapping IISes: no single removal repairs — report what's short
      if (!members.length)
        members.push(...comp.map((c) => ({ prov: c.prov, shortBy: slack.get(c.id) ?? 0 })));

      cards.push({ members });
    }

    // relax everything violated this round and look for further problems
    active = active.filter((c) => !violatedIds.has(c.id));
  }

  return cards;
}
