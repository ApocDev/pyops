/**
 * computeBlock regression tests, each suite seeding its own real-schema db.
 *
 * #93 — `ignored_by_productivity` is a per-product AMOUNT, not an
 * all-or-nothing flag. Seeds vanilla coal-liquefaction exactly as the dump
 * defines it (heavy-oil out 90 with 25 ignored — its own catalytic heavy-oil
 * input — next to unflagged light-oil 20 and petroleum-gas 10) and checks that
 * both compute paths (the block solver defs → grid rows, and the what-if
 * scenario) boost only the non-ignored part of each product.
 *
 * #94 — reactor neighbour bonus. Seeds Py's breeder reactor exactly as the
 * data dump describes it (`reactor.nuclear-reactor`: consumption 2GW → the
 * synthesized `generate-heat-nuclear-reactor` recipe yields 2000 MW of
 * pyops-heat; burner effectivity 2 → energy_usage_w 1e9; neighbour_bonus 1)
 * and its fuel (`uranium-fuel-cell`: fuel_value 4GJ, burnt to
 * `depleted-uranium-fuel-cell`), then checks that an assumed farm layout
 * scales heat output — and ONLY heat output; fuel stays per-reactor.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "../db/index.server.ts";
import { computeRecipeScenario } from "../db/queries.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { computeBlock } from "./block-compute.server.ts";

describe("per-product ignored_by_productivity (#93)", () => {
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

describe("computeBlock reactor neighbour bonus (#94)", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    fx.db.exec(`
      INSERT INTO fluids (name, display) VALUES ('pyops-heat','Heat (MJ)');

      -- Py breeder reactor, as db/synthesize.ts imports it from the dump
      INSERT INTO crafting_machines
        (name, display, kind, crafting_speed, energy_usage_w, energy_source, neighbour_bonus)
      VALUES
        ('nuclear-reactor','Breeder reactor','reactor',1,1000000000,'burner',1);
      INSERT INTO machine_categories (machine, category) VALUES
        ('nuclear-reactor','heat:nuclear-reactor');
      INSERT INTO machine_fuel_categories (machine, fuel_category) VALUES
        ('nuclear-reactor','nuclear');

      -- its synthesized heat recipe: 2GW consumption → 2000 MW of pyops-heat
      INSERT INTO recipes (name, display, kind, category, energy_required, enabled, hidden)
      VALUES ('generate-heat-nuclear-reactor','Breeder reactor heat','generating',
              'heat:nuclear-reactor',1,1,0);
      INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
        ('generate-heat-nuclear-reactor',0,'fluid','pyops-heat',2000);

      -- the fuel it burns (Py values: 4GJ per cell, 1:1 depleted cell)
      INSERT INTO items (name, display, fuel_value_j, fuel_category, burnt_result) VALUES
        ('uranium-fuel-cell','Uranium fuel cell MK 01',4000000000,'nuclear','depleted-uranium-fuel-cell');
      INSERT INTO items (name, display) VALUES
        ('depleted-uranium-fuel-cell','Depleted uranium fuel cell');
    `);
    fx.db.close();
    switchDatabase(fx.file);
  });

  afterEach(() => fx.cleanup());

  const HEAT_GOAL = 6000; // MW of pyops-heat the block must produce

  const solve = (reactorLayouts?: Record<string, { x: number; y: number }>) =>
    computeBlock({
      goals: [{ name: "pyops-heat", rate: HEAT_GOAL }],
      recipes: ["generate-heat-nuclear-reactor"],
      ...(reactorLayouts ? { reactorLayouts } : {}),
    });

  it("without a layout, plans flat-rated reactors (1×1, no bonus)", async () => {
    const r = await solve();
    const row = r.rows[0]!;
    expect(row.machine?.count).toBeCloseTo(3, 9); // 6000 / 2000
    expect(row.reactor).toMatchObject({
      layout: { x: 1, y: 1 },
      neighbourBonus: 1,
      multiplier: 1,
    });
    // 3 reactors × 1GW fuel draw ÷ 4GJ/cell = 0.75 cells/s
    expect(row.fuel?.name).toBe("uranium-fuel-cell");
    expect(row.fuel?.perSec).toBeCloseTo(0.75, 9);
  });

  it("a 2×2 farm (×3 heat each) needs a third of the reactors and fuel", async () => {
    const r = await solve({ "generate-heat-nuclear-reactor": { x: 2, y: 2 } });
    const row = r.rows[0]!;
    // each reactor now yields 2000 × 3 = 6000 MW → one reactor covers the goal
    expect(row.machine?.count).toBeCloseTo(1, 9);
    expect(row.reactor).toMatchObject({
      layout: { x: 2, y: 2 },
      neighbourBonus: 1,
      multiplier: 3,
    });
    // heat output still meets the goal exactly (the product rate is bonused)…
    expect(row.products[0]).toMatchObject({ name: "pyops-heat" });
    expect(row.products[0]!.rate).toBeCloseTo(HEAT_GOAL, 9);
    // …while fuel stays per-reactor: 1 reactor × 1GW ÷ 4GJ = 0.25 cells/s
    expect(row.fuel?.perSec).toBeCloseTo(0.25, 9);
    // the fuel import + burnt-result export fold at the reduced rate too
    expect(r.imports.find((f) => f.name === "uranium-fuel-cell")?.rate).toBeCloseTo(0.25, 9);
    expect(r.exports.find((f) => f.name === "depleted-uranium-fuel-cell")?.rate).toBeCloseTo(
      0.25,
      9,
    );
  });

  it("scales fractional farms consistently (2×8 → ×3.75)", async () => {
    const r = await solve({ "generate-heat-nuclear-reactor": { x: 2, y: 8 } });
    const row = r.rows[0]!;
    expect(row.reactor?.multiplier).toBeCloseTo(3.75, 9);
    expect(row.machine?.count).toBeCloseTo(HEAT_GOAL / (2000 * 3.75), 9);
  });
});
