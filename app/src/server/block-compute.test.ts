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
 *
 * #110 (interim) — per-producer fluid-temperature warnings. Seeds Py's real
 * MHD/fusion chain verbatim from py.db (`b-h`: neutron 10000 @4000°;
 * `dt-he3`: neutron 7500 @3000°; `generate-mdh-4000`/`-3000`: neutron 24000
 * min=max 4000/3000; `enriched-water`: water 1000 ≤101°;
 * `enriched-water-distillation`: water 175 @125°) and checks that a producer
 * whose temperature falls outside a consumer's accepted range is flagged even
 * when ANOTHER producer satisfies it — the silent mismatch the old
 * block-level check missed.
 *
 * #25 — fluid-fueled machines. Seeds the dump's three FluidEnergySource
 * shapes (unfiltered burner → pyops-fluid-fuel pool draw, filtered burner →
 * pinned fluid, burns_fluid:false → temperature-fed, no fuel) and checks the
 * pool/pinned/none classification and MJ math.
 *
 * #113 — recipe/good display namespaces. Seeds Py's coal-gas chain verbatim
 * (recipe `coal-gas` "Coal gas from coal" producing fluid `coal-gas` "Coal
 * gas") and checks that the shared internal name resolves to each namespace's
 * own display string instead of the last write winning.
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

describe("per-producer fluid-temperature warnings (#110 interim)", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    // Py's real fusion/MHD chain + heavy-water loop, verbatim from py.db:
    //   recipe_products:  b-h → neutron 10000 @4000°, helium 160
    //                     dt-he3 → neutron 7500 @3000°, helium 175, proton 20
    //                     enriched-water-distillation → water 175 @125°, heavy-water 25
    //   recipe_ingredients: generate-mdh-4000 ← neutron 24000 (min=max 4000)
    //                       generate-mdh-3000 ← neutron 24000 (min=max 3000)
    //                       enriched-water ← deuterium-sulfide 200, water 1000 (≤101°)
    fx.db.exec(`
      INSERT INTO fluids (name, display) VALUES
        ('neutron','Neutron'),('helium','Helium'),('proton','Hydrogen proton'),
        ('deuterium','Deuterium'),('helium3','Helium-3'),('liquid-helium','Liquid helium'),
        ('pyops-electricity','Electricity (MJ)'),('water','Water'),
        ('deuterium-sulfide','Deuterium sulfide'),('heavy-water','Heavy water'),
        ('vacuum','Vacuum'),('enriched-water','Enriched water');
      INSERT INTO items (name, display) VALUES ('boron','Boron');

      INSERT INTO recipes (name, display, kind, category, energy_required, enabled, hidden) VALUES
        ('b-h','Fuse boron with a proton','real','fusion-02',40,1,0),
        ('dt-he3','Fuse deuterium and helium-3','real','fusion-02',40,1,0),
        ('generate-mdh-4000','Magnetohydrodynamic (MHD) generator power (4000°)','generating','generate:mdh',1,1,0),
        ('generate-mdh-3000','Magnetohydrodynamic (MHD) generator power (3000°)','generating','generate:mdh',1,1,0),
        ('enriched-water','Enriched water','real','compressor',60,1,0),
        ('enriched-water-distillation','Heavy water','real','distilator',15,1,0);

      INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount, min_temp, max_temp) VALUES
        ('b-h',0,'fluid','proton',20,NULL,NULL),
        ('b-h',1,'item','boron',20,NULL,NULL),
        ('b-h',2,'fluid','liquid-helium',10,NULL,NULL),
        ('dt-he3',0,'fluid','deuterium',50,NULL,NULL),
        ('dt-he3',1,'fluid','helium3',50,NULL,NULL),
        ('dt-he3',2,'fluid','liquid-helium',35,NULL,NULL),
        ('generate-mdh-4000',0,'fluid','neutron',24000,4000,4000),
        ('generate-mdh-3000',0,'fluid','neutron',24000,3000,3000),
        ('enriched-water',0,'fluid','deuterium-sulfide',200,NULL,NULL),
        ('enriched-water',1,'fluid','water',1000,NULL,101),
        ('enriched-water-distillation',0,'fluid','vacuum',400,NULL,NULL),
        ('enriched-water-distillation',1,'fluid','enriched-water',200,NULL,NULL);

      INSERT INTO recipe_products (recipe, idx, kind, name, amount, temperature) VALUES
        ('b-h',0,'fluid','neutron',10000,4000),
        ('b-h',1,'fluid','helium',160,NULL),
        ('dt-he3',0,'fluid','neutron',7500,3000),
        ('dt-he3',1,'fluid','helium',175,NULL),
        ('dt-he3',2,'fluid','proton',20,NULL),
        ('generate-mdh-4000',0,'fluid','pyops-electricity',9600000,NULL),
        ('generate-mdh-3000',0,'fluid','pyops-electricity',7200000,NULL),
        ('enriched-water',0,'fluid','enriched-water',200,NULL),
        ('enriched-water-distillation',0,'fluid','water',175,125),
        ('enriched-water-distillation',1,'fluid','heavy-water',25,NULL);
    `);
    fx.db.close();
    switchDatabase(fx.file);
  });

  afterEach(() => fx.cleanup());

  it("flags a mismatched producer even when another producer satisfies the range", async () => {
    // b-h's 4000° neutrons satisfy the generator, which used to mask dt-he3's
    // 3000° neutrons being pooled in too — the silent wrong answer of #110.
    const res = await computeBlock({
      goals: [{ name: "pyops-electricity", rate: 240000 }],
      recipes: ["b-h", "dt-he3", "generate-mdh-4000"],
    });
    expect(res.tempWarnings).toEqual([
      {
        producer: "dt-he3",
        consumer: "generate-mdh-4000",
        item: "neutron",
        temp: 3000,
        needs: "4k°",
        partial: true,
      },
    ]);
    // the warned fluid is display-mapped even though it's internally linked
    expect(res.display["neutron"]).toBe("Neutron");
  });

  it("flags each mismatched producer→consumer pair with both generators present", async () => {
    const res = await computeBlock({
      goals: [{ name: "pyops-electricity", rate: 240000 }],
      recipes: ["b-h", "dt-he3", "generate-mdh-4000", "generate-mdh-3000"],
    });
    expect(res.tempWarnings).toHaveLength(2);
    expect(res.tempWarnings).toContainEqual({
      producer: "dt-he3",
      consumer: "generate-mdh-4000",
      item: "neutron",
      temp: 3000,
      needs: "4k°",
      partial: true,
    });
    expect(res.tempWarnings).toContainEqual({
      producer: "b-h",
      consumer: "generate-mdh-3000",
      item: "neutron",
      temp: 4000,
      needs: "3k°",
      partial: true,
    });
  });

  it("still flags a total mismatch (no in-block temperature acceptable)", async () => {
    // enriched-water accepts water ≤101°; the distillation returns it at 125° —
    // by-name linking closes a recycle loop the game won't run.
    const res = await computeBlock({
      goals: [{ name: "heavy-water", rate: 1 }],
      recipes: ["enriched-water", "enriched-water-distillation"],
    });
    expect(res.tempWarnings).toEqual([
      {
        producer: "enriched-water-distillation",
        consumer: "enriched-water",
        item: "water",
        temp: 125,
        needs: "≤101°",
        partial: false,
      },
    ]);
  });

  it("stays silent when every producer satisfies the range", async () => {
    const res = await computeBlock({
      goals: [{ name: "pyops-electricity", rate: 240000 }],
      recipes: ["b-h", "generate-mdh-4000"],
    });
    expect(res.tempWarnings).toEqual([]);
  });

  it("stays silent for imported fluids (no in-block producer)", async () => {
    const res = await computeBlock({
      goals: [{ name: "pyops-electricity", rate: 240000 }],
      recipes: ["generate-mdh-4000"],
    });
    expect(res.tempWarnings).toEqual([]);
  });

  it("ignores disabled producers (excluded from the solve)", async () => {
    const res = await computeBlock({
      goals: [{ name: "pyops-electricity", rate: 240000 }],
      recipes: ["b-h", "dt-he3", "generate-mdh-4000"],
      disabledRecipes: ["dt-he3"],
    });
    expect(res.tempWarnings).toEqual([]);
  });
});

describe("fluid-fueled machines (#25)", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    // Machines and fuels verbatim from the Py dump / py.db:
    //  - glassworks-mk01: 10MW, energy_source { type "fluid", burns_fluid true,
    //    no filter, effectivity 1 }, crafting_speed 1 — an UNFILTERED fluid
    //    burner: accepts any fuel-valued fluid → draws the pyops-fluid-fuel pool.
    //  - py-oil-powerplant-mk03: 30MW, energy_source { type "fluid",
    //    burns_fluid true, fluid_box.filter "diesel" }, crafting_speed 3 —
    //    pinned to diesel (fuel_value 1.5MJ).
    //  - nuclear-reactor-mk01: 300kW, energy_source { type "fluid",
    //    burns_fluid false, fluid_box.filter "uf6" }, crafting_speed 2 —
    //    temperature-fed, NOT a fuel burner (uf6 has no fuel_value).
    //  - recipe glass (category glassworks, energy 4): 20 sand → 20 molten-glass.
    //  - recipe oil-molten-salt-01 (category oil-powerplant, energy 20):
    //    500 molten-salt → 500 hot-molten-salt @1000°.
    //  - recipe nuclear-molten-thorium-reactor (category nuclear-fission,
    //    energy 5): 1000 molten-fluoride-thorium → 1000 …-pa233.
    //  - burn-fluid-kerosene as db/synthesize.ts builds it: 1 kerosene →
    //    1.5 pyops-fluid-fuel MJ (kerosene fuel_value 1.5MJ).
    fx.db.exec(`
      INSERT INTO fluids (name, display, fuel_value_j) VALUES
        ('pyops-fluid-fuel','Fluid fuel (MJ)',NULL),
        ('kerosene','Kerosene',1500000),
        ('diesel','Diesel',1500000),
        ('petroleum-gas','Petroleum gas',1000000),
        ('uf6','Uranium hexafluoride',NULL),
        ('molten-glass','Molten glass',NULL),
        ('molten-salt','Molten salt',NULL),
        ('hot-molten-salt','Hot molten salt',NULL),
        ('molten-fluoride-thorium','Molten fluoride thorium',NULL),
        ('molten-fluoride-thorium-pa233','Molten fluoride thorium (Pa-233)',NULL);
      INSERT INTO items (name, display) VALUES ('sand','Sand');

      INSERT INTO recipes (name, kind, category, energy_required, enabled, hidden) VALUES
        ('glass','real','glassworks',4,1,0),
        ('oil-molten-salt-01','real','oil-powerplant',20,1,0),
        ('nuclear-molten-thorium-reactor','real','nuclear-fission',5,1,0),
        ('burn-fluid-kerosene','burning',NULL,1,1,0);
      INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES
        ('glass',0,'item','sand',20),
        ('oil-molten-salt-01',0,'fluid','molten-salt',500),
        ('nuclear-molten-thorium-reactor',0,'fluid','molten-fluoride-thorium',1000),
        ('burn-fluid-kerosene',0,'fluid','kerosene',1);
      INSERT INTO recipe_products (recipe, idx, kind, name, amount, temperature) VALUES
        ('glass',0,'fluid','molten-glass',20,NULL),
        ('oil-molten-salt-01',0,'fluid','hot-molten-salt',500,1000),
        ('nuclear-molten-thorium-reactor',0,'fluid','molten-fluoride-thorium-pa233',1000,NULL),
        ('burn-fluid-kerosene',0,'fluid','pyops-fluid-fuel',1.5,NULL);

      INSERT INTO crafting_machines
        (name, display, kind, crafting_speed, module_slots, energy_usage_w, energy_source, burns_fluid, fluid_fuel_filter)
      VALUES
        ('glassworks-mk01','Glassworks MK 01','assembling-machine',1,1,10000000,'fluid',1,NULL),
        ('py-oil-powerplant-mk03','Oil powerplant MK 03','assembling-machine',3,0,30000000,'fluid',1,'diesel'),
        ('nuclear-reactor-mk01','Nuclear reactor MK 01','assembling-machine',2,0,300000,'fluid',0,'uf6');
      INSERT INTO machine_categories (machine, category) VALUES
        ('glassworks-mk01','glassworks'),
        ('py-oil-powerplant-mk03','oil-powerplant'),
        ('nuclear-reactor-mk01','nuclear-fission');
    `);
    fx.db.close();
    switchDatabase(fx.file);
  });

  afterEach(() => fx.cleanup());

  it("an unfiltered burns_fluid machine draws the fluid-fuel pool, not a picked fluid", async () => {
    const res = await computeBlock({
      goals: [{ name: "molten-glass", rate: 20 }],
      recipes: ["glass"],
    });
    const row = res.rows.find((r) => r.recipe === "glass")!;
    // 20/s ÷ 20/craft = 1 craft/s × 4s = 4 machines × 10MW = 40 MJ/s
    expect(row.machine?.count).toBeCloseTo(4);
    expect(row.fuel).toMatchObject({ name: "pyops-fluid-fuel", pool: true });
    expect(row.fuel!.perSec).toBeCloseTo(40);
    expect(row.availableFuels).toEqual([]); // no per-row pick — supply via a Burn recipe
    expect(res.imports.find((f) => f.name === "pyops-fluid-fuel")?.rate).toBeCloseTo(40);
    // the pre-#25 behavior defaulted fluid burners to petroleum-gas — gone
    expect(res.imports.find((f) => f.name === "petroleum-gas")).toBeUndefined();
  });

  it("a burn-fluid conversion recipe in the block gets sized to the pool draw", async () => {
    const res = await computeBlock({
      goals: [{ name: "molten-glass", rate: 20 }],
      recipes: ["glass", "burn-fluid-kerosene"],
    });
    expect(res.status).toBe("solved");
    // 40 MJ/s ÷ 1.5 MJ/kerosene = 26.667 kerosene/s, balanced in-block
    expect(res.imports.find((f) => f.name === "pyops-fluid-fuel")).toBeUndefined();
    expect(res.imports.find((f) => f.name === "kerosene")?.rate).toBeCloseTo(40 / 1.5);
    expect(res.rows.find((r) => r.recipe === "burn-fluid-kerosene")?.rate).toBeCloseTo(40 / 1.5);
  });

  it("a filtered fluid burner is pinned to its filter fluid — stored picks are ignored", async () => {
    const res = await computeBlock({
      goals: [{ name: "hot-molten-salt", rate: 500 }],
      recipes: ["oil-molten-salt-01"],
      fuels: { "oil-molten-salt-01": "petroleum-gas" }, // legacy pick — must not win
    });
    const row = res.rows.find((r) => r.recipe === "oil-molten-salt-01")!;
    // 1 craft/s × 20s ÷ speed 3 = 6.667 machines × 30MW = 200MW ÷ 1.5MJ = 133.33/s
    expect(row.machine?.count).toBeCloseTo(20 / 3);
    expect(row.fuel).toMatchObject({ name: "diesel", pinned: true });
    expect(row.fuel!.perSec).toBeCloseTo(200e6 / 1.5e6);
    expect(row.availableFuels.map((f) => f.name)).toEqual(["diesel"]);
    expect(res.imports.find((f) => f.name === "diesel")?.rate).toBeCloseTo(200e6 / 1.5e6);
    expect(res.imports.find((f) => f.name === "pyops-fluid-fuel")).toBeUndefined();
  });

  it("a temperature-fed fluid source (burns_fluid false) is not a fuel burner", async () => {
    const res = await computeBlock({
      goals: [{ name: "molten-fluoride-thorium-pa233", rate: 1000 }],
      recipes: ["nuclear-molten-thorium-reactor"],
    });
    const row = res.rows.find((r) => r.recipe === "nuclear-molten-thorium-reactor")!;
    expect(row.fuel).toBeNull();
    expect(row.availableFuels).toEqual([]);
    // only the recipe's real ingredient imports — no uf6/pool/petroleum-gas fuel
    expect(res.imports.map((f) => f.name)).toEqual(["molten-fluoride-thorium"]);
  });
});

describe("recipe/good display-name namespaces (#113)", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    // Py's coal-gas chain verbatim from py.db — the recipe and its main product
    // share the internal name `coal-gas` but NOT the display string:
    //   recipes:  coal-gas → display "Coal gas from coal", category distilator,
    //             energy_required 3
    //   fluids:   coal-gas → display "Coal gas"; tar → "Tar"
    //   recipe_ingredients: coal-gas ← item coal 10
    //   recipe_products:    coal-gas → fluid coal-gas 40, fluid tar 50,
    //                       item iron-oxide 1, item coke 6
    //   crafting_machines: distilator "Destructive distillation column MK 01",
    //                      speed 1, 500 kW electric
    fx.db.exec(`
      INSERT INTO recipes (name, display, kind, category, energy_required, enabled, hidden)
        VALUES ('coal-gas','Coal gas from coal','real','distilator',3,1,0);
      INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES
        ('coal-gas',0,'item','coal',10);
      INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
        ('coal-gas',0,'fluid','coal-gas',40),
        ('coal-gas',1,'fluid','tar',50),
        ('coal-gas',2,'item','iron-oxide',1),
        ('coal-gas',3,'item','coke',6);
      INSERT INTO items (name, display) VALUES
        ('coal','Coal'),('iron-oxide','Iron oxide'),('coke','Coke');
      INSERT INTO fluids (name, display) VALUES ('coal-gas','Coal gas'),('tar','Tar');
      INSERT INTO crafting_machines (name, display, kind, crafting_speed, module_slots, energy_usage_w, energy_source)
        VALUES ('distilator','Destructive distillation column MK 01','assembling-machine',1,1,500000,'electric');
      INSERT INTO machine_categories (machine, category) VALUES ('distilator','distilator');
    `);
    fx.db.close();
    switchDatabase(fx.file);
  });

  afterEach(() => fx.cleanup());

  it("a recipe sharing its product's internal name keeps its own display string", async () => {
    const res = await computeBlock({
      goals: [{ name: "coal-gas", rate: 40 }],
      recipes: ["coal-gas"],
    });
    // the recipe namespace answers with the recipe's display…
    expect(res.recipeDisplay["coal-gas"]).toBe("Coal gas from coal");
    // …and the good namespace with the fluid's — the pre-fix flat map let the
    // goal/flow pass overwrite the recipe entry with "Coal gas"
    expect(res.display["coal-gas"]).toBe("Coal gas");
    // the solved row's own label is the recipe display too
    expect(res.rows.find((r) => r.recipe === "coal-gas")?.display).toBe("Coal gas from coal");
    // sanity: unrelated goods still map normally
    expect(res.display["tar"]).toBe("Tar");
    expect(res.recipeDisplay["tar"]).toBeUndefined();
  });

  it("a disabled recipe still maps its display through the recipe namespace", async () => {
    const res = await computeBlock({
      goals: [{ name: "coal-gas", rate: 40 }],
      recipes: ["coal-gas"],
      disabledRecipes: ["coal-gas"],
    });
    expect(res.recipeDisplay["coal-gas"]).toBe("Coal gas from coal");
    expect(res.display["coal-gas"]).toBe("Coal gas");
  });
});
