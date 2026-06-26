/**
 * YAFC-style cost analysis, ported from Yafc.Model/Analysis/CostAnalysis.cs.
 *
 * One LP variable per good (its intrinsic cost), one constraint per recipe:
 *
 *     value(products) − value(ingredients) ≤ logisticsCost(recipe)
 *
 * i.e. a recipe can't mint value beyond its processing overhead. The objective
 * maximizes total cost, weighted toward science-pack usage, so prices anchor
 * on "what research actually consumes". Raw goods get priced through their
 * synthetic mining/pumping recipes; electricity through generating recipes.
 *
 * Deliberate deviations from YAFC:
 *  - building footprint (tile size) isn't in our dataset → constant size
 *  - no fuel-as-ingredient refinement, no pollution term, flat mining penalty
 *  - barrel fill/empty recipes get a heavy logistics penalty so fluids are
 *    never priced through barrel round-trips (and the recipes sort last)
 *
 * Results land in the cost_analysis table: goods cost + per-recipe execution
 * cost (ingredients + logistics). Recomputed after every data import.
 */
import Database from "better-sqlite3";
import highsLoader from "highs";

// YAFC constants (CostAnalysis.cs)
const COST_PER_SECOND = 0.1;
const COST_PER_MJ = 0.1;
const COST_PER_INGREDIENT_PER_SIZE = 0.1;
const COST_PER_PRODUCT_PER_SIZE = 0.2;
const COST_PER_ITEM = 0.02;
const COST_PER_FLUID = 0.0005;
const COST_LOWER_LIMIT = -10;
const COST_UPPER_LIMIT = 1e5; // safety bound (YAFC uses map-gen caps instead)
const MINING_PENALTY = 1.5;
const BARREL_PENALTY = 100; // the user's call: barrels are an escape hatch, not an economy
const SIZE = 5; // constant stand-in for building footprint

const BARREL_CATEGORIES = new Set(["py-barreling", "py-unbarreling", "barreling", "barrelling"]);

type RecipeRow = {
  name: string;
  kind: string;
  category: string | null;
  energyRequired: number | null;
  hidden: number;
  sourceEntity: string | null;
};

export type CostSummary = { goods: number; recipes: number; ms: number; status: string };

export async function computeCostAnalysis(dbFile: string): Promise<CostSummary> {
  const t0 = Date.now();
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");

  // exclude hidden recipes and unreachable ones (disabled with no unlocking
  // tech — creative/editor content like Editor Extensions)
  const recipes = db
    .prepare(
      `SELECT r.name, r.kind, r.category, r.energy_required energyRequired, r.hidden, r.source_entity sourceEntity
       FROM recipes r
       WHERE r.hidden = 0
         AND (r.enabled = 1
              OR r.kind != 'real'
              OR EXISTS (SELECT 1 FROM tech_unlocks tu WHERE tu.recipe = r.name))`,
    )
    .all() as RecipeRow[];
  const ingredients = db
    .prepare(`SELECT recipe, kind, name, amount FROM recipe_ingredients`)
    .all() as { recipe: string; kind: string; name: string; amount: number }[];
  const products = db
    .prepare(
      `SELECT recipe, kind, name,
              COALESCE(amount, (COALESCE(amount_min,0)+COALESCE(amount_max,0))/2) * probability amount
       FROM recipe_products`,
    )
    .all() as { recipe: string; kind: string; name: string; amount: number }[];
  const ingByRecipe = groupBy(ingredients, (r) => r.recipe);
  const prodByRecipe = groupBy(products, (r) => r.recipe);

  // cheapest power requirement per recipe (MJ per craft across capable machines)
  const machineRows = db
    .prepare(
      `SELECT mc.category, cm.energy_usage_w w, cm.crafting_speed speed
       FROM machine_categories mc JOIN crafting_machines cm ON cm.name = mc.machine`,
    )
    .all() as { category: string; w: number | null; speed: number }[];
  const minPowerPerCat = new Map<string, number>(); // W / speed (per craft-second)
  for (const m of machineRows) {
    const p = (m.w ?? 0) / Math.max(m.speed, 0.01);
    const cur = minPowerPerCat.get(m.category);
    if (cur === undefined || p < cur) minPowerPerCat.set(m.category, p);
  }

  // science-pack usage (ingredient amount × research unit count) → objective weights
  const science = db
    .prepare(
      `SELECT ti.name, SUM(ti.amount * COALESCE(t.unit_count, 1)) total
       FROM tech_ingredients ti JOIN technologies t ON t.name = ti.technology
       GROUP BY ti.name`,
    )
    .all() as { name: string; total: number }[];
  const scienceUsage = new Map(science.map((s) => [s.name, s.total]));

  // variables: every good referenced by an included recipe
  const goodKind = new Map<string, string>();
  for (const c of [...ingredients, ...products])
    if (!goodKind.has(c.name)) goodKind.set(c.name, c.kind);
  const goodVar = new Map<string, string>();
  const varGood: string[] = [];
  for (const name of goodKind.keys()) {
    goodVar.set(name, `g${varGood.length}`);
    varGood.push(name);
  }

  // logistics cost per recipe (the constraint's right-hand side)
  const logistics = new Map<string, number>();
  const constraints: string[] = [];
  for (const r of recipes) {
    const ing = ingByRecipe.get(r.name) ?? [];
    const prod = prodByRecipe.get(r.name) ?? [];
    if (!prod.length) continue;
    const time = r.energyRequired ?? 0.5;
    const powerMJ = ((minPowerPerCat.get(r.category ?? "") ?? 0) * time) / 1e6;

    const sizeUsage = COST_PER_SECOND * time * SIZE;
    let cost =
      sizeUsage *
        (1 + COST_PER_INGREDIENT_PER_SIZE * ing.length + COST_PER_PRODUCT_PER_SIZE * prod.length) +
      COST_PER_MJ * powerMJ;
    for (const c of prod) cost += c.amount * (c.kind === "fluid" ? COST_PER_FLUID : COST_PER_ITEM);
    for (const c of ing) cost += c.amount * (c.kind === "fluid" ? COST_PER_FLUID : COST_PER_ITEM);
    if (r.kind === "mining") cost *= MINING_PENALTY;
    if (BARREL_CATEGORIES.has(r.category ?? "")) cost *= BARREL_PENALTY;
    logistics.set(r.name, cost);

    // Σ prod×c − Σ ing×c ≤ logistics  (terms merged per good)
    const terms = new Map<string, number>();
    for (const c of prod) terms.set(c.name, (terms.get(c.name) ?? 0) + c.amount);
    for (const c of ing) terms.set(c.name, (terms.get(c.name) ?? 0) - c.amount);
    const parts: string[] = [];
    for (const [good, coef] of terms) {
      if (Math.abs(coef) < 1e-9) continue;
      parts.push(`${coef >= 0 ? "+" : "-"} ${Math.abs(coef)} ${goodVar.get(good)}`);
    }
    if (parts.length) constraints.push(`c${constraints.length}: ${parts.join(" ")} <= ${cost}`);
  }

  // objective: small weight on everything + science usage; bounds per variable
  const objTerms: string[] = [];
  const bounds: string[] = [];
  for (let i = 0; i < varGood.length; i++) {
    const usage = scienceUsage.get(varGood[i]) ?? 0;
    objTerms.push(`+ ${1e-3 + usage / 1000} g${i}`);
    bounds.push(`${COST_LOWER_LIMIT} <= g${i} <= ${COST_UPPER_LIMIT}`);
  }

  const lp = `Maximize\n obj: ${objTerms.join(" ")}\nSubject To\n ${constraints.join("\n ")}\nBounds\n ${bounds.join("\n ")}\nEnd`;

  const highs = await highsLoader();
  const sol = highs.solve(lp);
  if (sol.Status !== "Optimal") {
    db.close();
    throw new Error(`cost analysis LP not optimal: ${sol.Status}`);
  }

  const costOf = new Map<string, number>();
  for (let i = 0; i < varGood.length; i++) {
    costOf.set(varGood[i], (sol.Columns[`g${i}`]?.Primal as number) ?? 0);
  }

  // persist: goods cost + recipe execution cost (ingredients + logistics)
  const wipe = db.prepare(`DELETE FROM cost_analysis`);
  const put = db.prepare(
    `INSERT OR REPLACE INTO cost_analysis (scope, name, kind, cost) VALUES (?,?,?,?)`,
  );
  const tx = db.transaction(() => {
    wipe.run();
    for (const [name, cost] of costOf) put.run("good", name, goodKind.get(name) ?? "item", cost);
    for (const r of recipes) {
      const log = logistics.get(r.name);
      if (log === undefined) continue;
      let cost = log;
      for (const c of ingByRecipe.get(r.name) ?? [])
        cost += c.amount * Math.max(0, costOf.get(c.name) ?? 0);
      put.run("recipe", r.name, "recipe", cost);
    }
  });
  tx();
  const counts = {
    goods: costOf.size,
    recipes: recipes.length,
    ms: Date.now() - t0,
    status: sol.Status,
  };
  db.close();
  return counts;
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const a = m.get(k);
    if (a) a.push(r);
    else m.set(k, [r]);
  }
  return m;
}
