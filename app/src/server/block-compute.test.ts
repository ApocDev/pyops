/**
 * Regression for #93: `ignored_by_productivity` is a per-product AMOUNT, not an
 * all-or-nothing flag. Seeds vanilla coal-liquefaction exactly as the dump
 * defines it (heavy-oil out 90 with 25 ignored — its own catalytic heavy-oil
 * input — next to unflagged light-oil 20 and petroleum-gas 10) and checks that
 * both compute paths (the block solver defs → grid rows, and the what-if
 * scenario) boost only the non-ignored part of each product.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "../db/index.server.ts";
import { computeRecipeScenario } from "../db/queries.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { computeBlock } from "./block-compute.server.ts";

let fx: TestDb;

beforeEach(async () => {
  fx = await makeTestDb();
  // coal-liquefaction verbatim from data-raw-dump.json: energy 5, allow_productivity,
  // in coal 10 + heavy-oil 25 + steam 50; out heavy-oil 90 (ignored_by_productivity
  // 25), light-oil 20, petroleum-gas 10.
  fx.db.exec(`
    INSERT INTO recipes (name, kind, category, energy_required, allow_productivity, enabled, hidden)
      VALUES ('coal-liquefaction','real','oil-processing',5,1,1,0);
    INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES
      ('coal-liquefaction',0,'item','coal',10),
      ('coal-liquefaction',1,'fluid','heavy-oil',25),
      ('coal-liquefaction',2,'fluid','steam',50);
    INSERT INTO recipe_products (recipe, idx, kind, name, amount, ignored_by_productivity) VALUES
      ('coal-liquefaction',0,'fluid','heavy-oil',90,25),
      ('coal-liquefaction',1,'fluid','light-oil',20,0),
      ('coal-liquefaction',2,'fluid','petroleum-gas',10,0);
    INSERT INTO items (name, display) VALUES ('coal','Coal');
    INSERT INTO fluids (name, display) VALUES
      ('heavy-oil','Heavy oil'),('light-oil','Light oil'),
      ('petroleum-gas','Petroleum gas'),('steam','Steam');
    INSERT INTO crafting_machines (name, kind, crafting_speed, module_slots, energy_usage_w, energy_source)
      VALUES ('oil-refinery','assembling-machine',1,3,420000,'electric');
    INSERT INTO machine_categories (machine, category) VALUES ('oil-refinery','oil-processing');
    -- speed-neutral productivity module so prodMult is the only effect (2× = +20%)
    INSERT INTO modules (name, category, hidden, eff_speed, eff_productivity, eff_consumption)
      VALUES ('prod-module','productivity',0,0,0.1,0.4);
  `);
  fx.db.close();
  switchDatabase(fx.file);
});

afterEach(() => fx.cleanup());

const MODULES = { "coal-liquefaction": ["prod-module", "prod-module"] }; // +20% prod

describe("per-product ignored_by_productivity (#93)", () => {
  it("computeBlock boosts only the non-ignored part of each product", async () => {
    const res = await computeBlock({
      goals: [{ name: "light-oil", rate: 24 }],
      recipes: ["coal-liquefaction"],
      modules: MODULES,
    });
    // light-oil/craft = 20 × 1.2 = 24 → exactly 1 craft/s meets the goal
    const row = res.rows.find((r) => r.recipe === "coal-liquefaction")!;
    expect(row.rate).toBeCloseTo(1);
    const rates = Object.fromEntries(row.products.map((p) => [p.name, p.rate]));
    // heavy-oil: 25 ignored + 65 × 1.2 = 103/s — not 90 (all-ignored bug) nor 108
    expect(rates["heavy-oil"]).toBeCloseTo(103);
    expect(rates["light-oil"]).toBeCloseTo(24);
    expect(rates["petroleum-gas"]).toBeCloseTo(12);
    // and the boundary flow nets the 25/s catalytic input back out: 103 − 25 = 78
    const heavyExport = res.exports.find((f) => f.name === "heavy-oil");
    expect(heavyExport?.rate).toBeCloseTo(78);
  });

  it("computeRecipeScenario (what-if) agrees with the solver math", () => {
    const res = computeRecipeScenario({
      recipe: "coal-liquefaction",
      machine: "oil-refinery",
      modules: ["prod-module", "prod-module"],
    });
    expect("error" in res).toBe(false);
    if ("error" in res) return;
    expect(res.effects.prodMult).toBeCloseTo(1.2);
    const out = Object.fromEntries(res.perBuilding.outputs.map((o) => [o.good, o.perSec]));
    // 0.2 crafts/s (speed 1 / energy 5): heavy-oil 103 × 0.2, light-oil 24 × 0.2
    expect(out["heavy-oil"]).toBeCloseTo(20.6);
    expect(out["light-oil"]).toBeCloseTo(4.8);
    expect(out["petroleum-gas"]).toBeCloseTo(2.4);
  });

  it("without productivity the base amounts are untouched", async () => {
    const res = await computeBlock({
      goals: [{ name: "light-oil", rate: 20 }],
      recipes: ["coal-liquefaction"],
    });
    const row = res.rows.find((r) => r.recipe === "coal-liquefaction")!;
    const rates = Object.fromEntries(row.products.map((p) => [p.name, p.rate]));
    expect(row.rate).toBeCloseTo(1);
    expect(rates["heavy-oil"]).toBeCloseTo(90);
    expect(rates["petroleum-gas"]).toBeCloseTo(10);
  });
});
