import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { computeCostAnalysis } from "./cost-analysis.server.ts";

let fx: TestDb;

beforeEach(async () => {
  fx = await makeTestDb();
  const db = fx.db;
  // a tiny ore → plate → gear → science economy
  db.exec(`
    INSERT INTO items (name) VALUES ('ore'),('plate'),('gear'),('science');

    INSERT INTO crafting_machines (name, kind, crafting_speed, module_slots, energy_usage_w)
      VALUES ('furnace','furnace',1,0,90000),
             ('assembler','assembling-machine',1,0,150000);
    INSERT INTO machine_categories (machine, category)
      VALUES ('furnace','smelting'),('assembler','crafting');

    -- mining recipe: ore from nothing (kind 'mining' so the mining penalty applies)
    INSERT INTO recipes (name, kind, category, energy_required, enabled, hidden)
      VALUES ('mine-ore','mining','mining',1,1,0);
    INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES ('mine-ore',0,'item','ore',1);

    INSERT INTO recipes (name, kind, category, energy_required, enabled, hidden)
      VALUES ('smelt-plate','real','smelting',1,1,0);
    INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES ('smelt-plate',0,'item','ore',1);
    INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES ('smelt-plate',0,'item','plate',1);

    INSERT INTO recipes (name, kind, category, energy_required, enabled, hidden)
      VALUES ('make-gear','real','crafting',0.5,1,0);
    INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES ('make-gear',0,'item','plate',2);
    INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES ('make-gear',0,'item','gear',1);

    INSERT INTO recipes (name, kind, category, energy_required, enabled, hidden)
      VALUES ('make-science','real','crafting',2,1,0);
    INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES ('make-science',0,'item','gear',1);
    INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES ('make-science',0,'item','science',1);

    -- a value-destroying downgrade: a gear (worth > 2 plates) back into 1 plate.
    -- No sane economy runs it — its constraint stays slack (flow 0, high waste).
    INSERT INTO recipes (name, kind, category, energy_required, enabled, hidden)
      VALUES ('downgrade-gear','real','crafting',1,1,0);
    INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES ('downgrade-gear',0,'item','gear',1);
    INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES ('downgrade-gear',0,'item','plate',1);

    -- a tech that consumes the science pack (anchors the objective on science usage)
    INSERT INTO technologies (name, unit_count, enabled, is_turd) VALUES ('automation',100,1,0);
    INSERT INTO tech_ingredients (technology, name, amount) VALUES ('automation','science',1);
    INSERT INTO tech_unlocks (technology, recipe) VALUES ('automation','make-gear');
  `);
  // close the writer handle so computeCostAnalysis opens the file cleanly
  db.close();
});

afterEach(() => fx.cleanup());

const costs = (file: string) => {
  const r = new Database(file, { readonly: true });
  const rows = r.prepare(`SELECT scope, name, kind, cost FROM cost_analysis`).all() as {
    scope: string;
    name: string;
    kind: string;
    cost: number;
  }[];
  r.close();
  const goodCost = (n: string) => rows.find((x) => x.scope === "good" && x.name === n)?.cost;
  const recipeCost = (n: string) => rows.find((x) => x.scope === "recipe" && x.name === n)?.cost;
  const recipeFlow = (n: string) =>
    rows.find((x) => x.scope === "recipe-flow" && x.name === n)?.cost;
  const recipeWaste = (n: string) =>
    rows.find((x) => x.scope === "recipe-waste" && x.name === n)?.cost;
  return { rows, goodCost, recipeCost, recipeFlow, recipeWaste };
};

describe("computeCostAnalysis", () => {
  it("solves the LP and persists good + recipe costs", async () => {
    const summary = await computeCostAnalysis(fx.file);
    expect(summary.status).toBe("Optimal");
    expect(summary.goods).toBeGreaterThan(0);
    expect(summary.recipes).toBe(5);

    const { rows, goodCost, recipeCost } = costs(fx.file);
    expect(rows.length).toBeGreaterThan(0);
    // every modelled good is priced
    for (const g of ["ore", "plate", "gear", "science"]) expect(goodCost(g)).toBeDefined();
    // every recipe gets an execution cost
    for (const r of ["mine-ore", "smelt-plate", "make-gear", "make-science", "downgrade-gear"])
      expect(recipeCost(r)).toBeGreaterThan(0);
  });

  it("estimates recipe flow from the constraint duals (#97)", async () => {
    await computeCostAnalysis(fx.file);
    const { recipeFlow } = costs(fx.file);
    // the science chain prices its products — binding constraints, positive duals
    for (const r of ["mine-ore", "smelt-plate", "make-gear", "make-science"])
      expect(recipeFlow(r)).toBeGreaterThan(0);
    // the downgrade destroys value: the economy never runs it, so its
    // constraint is slack and the dual is 0
    expect(recipeFlow("downgrade-gear")).toBeCloseTo(0, 6);
  });

  it("computes waste % as the input value a recipe destroys (#97)", async () => {
    await computeCostAnalysis(fx.file);
    const { recipeWaste } = costs(fx.file);
    for (const r of ["mine-ore", "smelt-plate", "make-gear", "make-science", "downgrade-gear"]) {
      expect(recipeWaste(r)).toBeGreaterThanOrEqual(0);
      expect(recipeWaste(r)).toBeLessThanOrEqual(1);
    }
    // binding recipes return their full cost in product value — no waste
    expect(recipeWaste("smelt-plate")!).toBeLessThan(0.01);
    // a gear costs > 2 plates; returning a single plate wastes most of the value
    expect(recipeWaste("downgrade-gear")!).toBeGreaterThan(0.3);
  });

  it("prices goods monotonically up the production chain", async () => {
    await computeCostAnalysis(fx.file);
    const { goodCost } = costs(fx.file);
    // ore is raw; each processing step can only add value (≤ logistics overhead)
    expect(goodCost("ore")!).toBeGreaterThan(0);
    expect(goodCost("plate")!).toBeGreaterThan(goodCost("ore")!);
    expect(goodCost("gear")!).toBeGreaterThan(goodCost("plate")!);
    expect(goodCost("science")!).toBeGreaterThan(goodCost("gear")!);
  });

  it("is recomputable: a second run wipes and rebuilds without duplicating rows", async () => {
    await computeCostAnalysis(fx.file);
    const first = costs(fx.file).rows.length;
    const summary = await computeCostAnalysis(fx.file);
    expect(summary.status).toBe("Optimal");
    expect(costs(fx.file).rows.length).toBe(first); // DELETE-then-insert, no growth
  });
});
