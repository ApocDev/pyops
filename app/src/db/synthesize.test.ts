import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { ELECTRICITY, FLUID_FUEL, HEAT, synthesizePass2 } from "./synthesize.ts";
import { type TestDb, makeTestDb } from "./test-helpers.ts";

let fx: TestDb;
beforeEach(async () => {
  fx = await makeTestDb();
});
afterEach(() => fx.cleanup());

// minimal data.raw slice: one drill, two resources, one offshore pump
const raw = {
  "mining-drill": {
    "electric-drill": {
      resource_categories: ["basic-solid"],
      mining_speed: 0.5,
      module_slots: 2,
    },
  },
  resource: {
    "iron-ore": {
      category: "basic-solid",
      minable: { mining_time: 1, result: "iron-ore", count: 1 },
    },
    "copper-ore": {
      category: "basic-solid",
      minable: { mining_time: 2, results: [{ type: "item", name: "copper-ore", amount: 3 }] },
    },
    "uranium-ore": {
      // category nothing can mine → no recipe
      category: "hard-solid",
      minable: { mining_time: 2, result: "uranium-ore" },
    },
  },
  "offshore-pump": {
    "offshore-pump": { pumping_speed: 20 },
  },
  // Py's breeder reactor, exactly as data-raw dumps it (values from the Py dump:
  // consumption 2GW, burner effectivity 2, neighbour_bonus 1) — plus a minimal
  // second reactor that omits neighbour_bonus (the engine default is 1).
  reactor: {
    "nuclear-reactor": {
      consumption: 2e9,
      neighbour_bonus: 1,
      energy_source: { type: "burner", effectivity: 2, fuel_categories: ["nuclear"] },
    },
    "half-bonus-reactor": {
      consumption: 1e6,
      neighbour_bonus: 0.5,
      energy_source: { type: "burner", fuel_categories: ["chemical"] },
    },
    "default-bonus-reactor": {
      consumption: 1e6,
      energy_source: { type: "burner", fuel_categories: ["chemical"] },
    },
  },
};
// planting slice — real Space Age values (space-age/prototypes/entity/
// entities.lua: radius = 3, energy_usage = "100kW"; plants.lua: yumako-tree
// growth_ticks = 5 min = 18000, minable results = 50 yumako)
const agriRaw = {
  "agricultural-tower": {
    "agricultural-tower": {
      radius: 3,
      energy_usage: 100_000,
      energy_source: { type: "electric" },
    },
  },
  plant: {
    "yumako-tree": {
      growth_ticks: 18000,
      minable: { mining_time: 0.5, results: [{ type: "item", name: "yumako", amount: 50 }] },
    },
  },
};

// launch slice — real Py values (data-raw-dump.json: rocket-silo has
// fixed_recipe "rocket-part", rocket_parts_required 15, rocket inventory 5;
// satellite: weight 200000, stack 1, launch products 6× destabilized-toxirus;
// utility-constants rocket_lift_weight 1e6 → ⌊1e6/200000⌋ = 5 per launch)
const launchRaw = {
  "rocket-silo": {
    "rocket-silo": {
      fixed_recipe: "rocket-part",
      rocket_parts_required: 15,
      to_be_inserted_to_rocket_inventory_size: 5,
      crafting_categories: ["rocket-building"],
      crafting_speed: 1,
      energy_usage: 250_000,
    },
  },
  recipe: {
    "rocket-part": { results: [{ type: "item", name: "rocket-part", amount: 1 }] },
  },
  item: {
    satellite: {
      rocket_launch_products: [{ type: "item", name: "destabilized-toxirus", amount: 6 }],
    },
    "bulk-good": {
      rocket_launch_products: [{ type: "item", name: "bulk-product", amount: 2 }],
    },
  },
  "utility-constants": {
    default: { rocket_lift_weight: 1_000_000, default_item_weight: 100 },
  },
};

const ctx = {
  display: () => null,
  parseSI: (s: unknown) => (typeof s === "number" ? s : null),
};

const get = <T = Record<string, unknown>>(sql: string, ...args: unknown[]) =>
  fx.db.prepare(sql).get(...args) as T | undefined;

describe("synthesizePass2", () => {
  it("always defines the electricity and heat pseudo-fluids", () => {
    synthesizePass2(fx.db, raw, ctx);
    expect(get(`SELECT name FROM fluids WHERE name = ?`, ELECTRICITY)).toBeTruthy();
    expect(get(`SELECT name FROM fluids WHERE name = ?`, HEAT)).toBeTruthy();
  });

  it("creates a mining recipe per minable resource a drill can reach", () => {
    const counts = synthesizePass2(fx.db, raw, ctx);
    expect(counts.mining).toBe(2); // iron + copper; uranium unreachable

    const iron = get<{ kind: string; category: string; energy: number; src: string }>(
      `SELECT kind, category, energy_required energy, source_entity src FROM recipes WHERE name = 'mine-iron-ore'`,
    );
    expect(iron).toMatchObject({
      kind: "mining",
      category: "mine:basic-solid",
      energy: 1,
      src: "iron-ore",
    });
    // result + amount land in recipe_products (results[] form averaged correctly)
    expect(
      get(
        `SELECT amount FROM recipe_products WHERE recipe = 'mine-copper-ore' AND name = 'copper-ore'`,
      ),
    ).toMatchObject({ amount: 3 });
    // mining recipes are productivity-eligible
    expect(
      get<{ ap: number }>(`SELECT allow_productivity ap FROM recipes WHERE name = 'mine-iron-ore'`)!
        .ap,
    ).toBe(1);
  });

  it("skips resources no drill category can mine", () => {
    synthesizePass2(fx.db, raw, ctx);
    expect(get(`SELECT name FROM recipes WHERE name = 'mine-uranium-ore'`)).toBeUndefined();
  });

  it("registers the drill as a machine in its mining category", () => {
    synthesizePass2(fx.db, raw, ctx);
    const drill = get<{ kind: string; speed: number; slots: number }>(
      `SELECT kind, crafting_speed speed, module_slots slots FROM crafting_machines WHERE name = 'electric-drill'`,
    );
    expect(drill).toMatchObject({ kind: "mining-drill", speed: 0.5, slots: 2 });
    expect(
      get(`SELECT category FROM machine_categories WHERE machine = 'electric-drill'`),
    ).toMatchObject({ category: "mine:basic-solid" });
  });

  it("creates a pumping recipe producing water at pumping_speed × 60", () => {
    const counts = synthesizePass2(fx.db, raw, ctx);
    expect(counts.pumping).toBe(1);
    expect(
      get(
        `SELECT amount FROM recipe_products WHERE recipe = 'pump-offshore-pump' AND name = 'water'`,
      ),
    ).toMatchObject({ amount: 1200 }); // 20 × 60
  });

  it("registers reactors with their heat recipe and neighbour bonus (#94)", () => {
    synthesizePass2(fx.db, raw, ctx);
    // machine: fuel draw = consumption / effectivity, neighbour_bonus persisted
    expect(
      get(
        `SELECT kind, energy_usage_w w, neighbour_bonus nb FROM crafting_machines WHERE name = 'nuclear-reactor'`,
      ),
    ).toMatchObject({ kind: "reactor", w: 1e9, nb: 1 });
    expect(
      get(`SELECT neighbour_bonus nb FROM crafting_machines WHERE name = 'half-bonus-reactor'`),
    ).toMatchObject({ nb: 0.5 });
    // heat recipe: base (un-bonused) output in MW of pyops-heat
    expect(
      get(
        `SELECT amount FROM recipe_products WHERE recipe = 'generate-heat-nuclear-reactor' AND name = ?`,
        HEAT,
      ),
    ).toMatchObject({ amount: 2000 });
  });

  it("defaults a reactor's missing neighbour_bonus to the engine default of 1", () => {
    synthesizePass2(fx.db, raw, ctx);
    expect(
      get(`SELECT neighbour_bonus nb FROM crafting_machines WHERE name = 'default-bonus-reactor'`),
    ).toMatchObject({ nb: 1 });
  });
});

describe("synthesizePass2 planting", () => {
  const seedSeed = () =>
    fx.db
      .prepare(`INSERT INTO items (name, display, stack_size, plant_result) VALUES (?,?,?,?)`)
      .run("yumako-seed", "Yumako seed", 10, "yumako-tree");

  it("creates a planting recipe: 1 seed → harvest over growth_ticks/60 s", () => {
    seedSeed();
    const counts = synthesizePass2(fx.db, agriRaw, ctx);
    expect(counts.planting).toBe(1);

    const rec = get<{ kind: string; category: string; energy: number; src: string }>(
      `SELECT kind, category, energy_required energy, source_entity src FROM recipes WHERE name = 'plant-yumako-seed'`,
    );
    expect(rec).toMatchObject({
      kind: "planting",
      category: "plant:agriculture",
      energy: 300, // 18000 ticks / 60
      src: "yumako-tree",
    });
    expect(
      get(`SELECT name, amount FROM recipe_ingredients WHERE recipe = 'plant-yumako-seed'`),
    ).toMatchObject({ name: "yumako-seed", amount: 1 });
    expect(
      get(`SELECT name, amount FROM recipe_products WHERE recipe = 'plant-yumako-seed'`),
    ).toMatchObject({ name: "yumako", amount: 50 });
  });

  it("registers the tower with (2·radius+1)²−1 parallel cells as its speed", () => {
    seedSeed();
    synthesizePass2(fx.db, agriRaw, ctx);
    const tower = get<{ kind: string; speed: number; w: number }>(
      `SELECT kind, crafting_speed speed, energy_usage_w w FROM crafting_machines WHERE name = 'agricultural-tower'`,
    );
    expect(tower).toMatchObject({ kind: "agricultural-tower", speed: 48, w: 100_000 }); // (2·3+1)²−1
    expect(
      get(`SELECT category FROM machine_categories WHERE machine = 'agricultural-tower'`),
    ).toMatchObject({ category: "plant:agriculture" });
  });

  it("synthesizes nothing when the mod set has no agricultural towers", () => {
    seedSeed(); // a seed item alone (e.g. Py) must not produce recipes
    const counts = synthesizePass2(fx.db, raw, ctx);
    expect(counts.planting).toBe(0);
    expect(get(`SELECT name FROM recipes WHERE name = 'plant-yumako-seed'`)).toBeUndefined();
  });

  it("skips seeds whose plant prototype is missing from the dump", () => {
    fx.db
      .prepare(`INSERT INTO items (name, stack_size, plant_result) VALUES (?,?,?)`)
      .run("weird-seed", 10, "no-such-plant");
    const counts = synthesizePass2(fx.db, agriRaw, ctx);
    expect(counts.planting).toBe(0);
  });
});

describe("synthesizePass2 rocket launch", () => {
  const seedItems = () => {
    const ins = fx.db.prepare(
      `INSERT INTO items (name, display, stack_size, weight) VALUES (?,?,?,?)`,
    );
    ins.run("satellite", "Satellite", 1, 200_000);
    ins.run("bulk-good", null, 10, null); // no weight → default_item_weight
  };

  it("creates a launch recipe: parts + weight-capped payload → launch products", () => {
    seedItems();
    const counts = synthesizePass2(fx.db, launchRaw, ctx);
    expect(counts.launching).toBe(2);

    const rec = get<{ kind: string; category: string; energy: number; src: string }>(
      `SELECT kind, category, energy_required energy, source_entity src FROM recipes WHERE name = 'launch-rocket-silo-satellite'`,
    );
    expect(rec).toMatchObject({
      kind: "launch",
      category: "launch:rocket-silo",
      energy: 40.33,
      src: "rocket-silo",
    });
    // 15 rocket parts + ⌊1e6 / 200000⌋ = 5 satellites …
    expect(
      get(
        `SELECT amount FROM recipe_ingredients WHERE recipe = 'launch-rocket-silo-satellite' AND name = 'rocket-part'`,
      ),
    ).toMatchObject({ amount: 15 });
    expect(
      get(
        `SELECT amount FROM recipe_ingredients WHERE recipe = 'launch-rocket-silo-satellite' AND name = 'satellite'`,
      ),
    ).toMatchObject({ amount: 5 });
    // … → 5 × 6 destabilized-toxirus
    expect(
      get(`SELECT name, amount FROM recipe_products WHERE recipe = 'launch-rocket-silo-satellite'`),
    ).toMatchObject({ name: "destabilized-toxirus", amount: 30 });
  });

  it("caps the payload at rocket inventory slots × stack_size", () => {
    seedItems();
    synthesizePass2(fx.db, launchRaw, ctx);
    // bulk-good: weight defaults to 100 → ⌊1e6/100⌋ = 10000, capped at 5 slots × stack 10 = 50
    expect(
      get(
        `SELECT amount FROM recipe_ingredients WHERE recipe = 'launch-rocket-silo-bulk-good' AND name = 'bulk-good'`,
      ),
    ).toMatchObject({ amount: 50 });
    expect(
      get(
        `SELECT amount FROM recipe_products WHERE recipe = 'launch-rocket-silo-bulk-good' AND name = 'bulk-product'`,
      ),
    ).toMatchObject({ amount: 100 }); // 50 × 2
  });

  it("maps the silo into the launch machine category", () => {
    seedItems();
    synthesizePass2(fx.db, launchRaw, ctx);
    expect(
      get(
        `SELECT category FROM machine_categories WHERE machine = 'rocket-silo' AND category = 'launch:rocket-silo'`,
      ),
    ).toBeTruthy();
  });

  it("skips payload items that were never imported, and silos without a fixed recipe", () => {
    // no items seeded → both raw launchables are unknown items
    const counts = synthesizePass2(fx.db, launchRaw, ctx);
    expect(counts.launching).toBe(0);

    // a silo with no fixed_recipe synthesizes nothing either
    seedItems();
    const noFixed = {
      ...launchRaw,
      "rocket-silo": { "rocket-silo": { rocket_parts_required: 15 } },
    };
    const counts2 = synthesizePass2(fx.db, noFixed, ctx);
    expect(counts2.launching).toBe(0);
  });
});

describe("synthesizePass2 fluid fuel (#25)", () => {
  // fuel_value_j values verbatim from the Py dump: kerosene 1.5MJ, coal-gas
  // 0.2MJ; water carries no fuel_value.
  const seedFluids = () =>
    fx.db.exec(`INSERT INTO fluids (name, display, fuel_value_j) VALUES
      ('kerosene','Kerosene',1500000),
      ('coal-gas','Coal gas',200000),
      ('water','Water',NULL);`);

  it("defines the pool pseudo-fluid and one burn conversion per fuel-valued fluid", () => {
    seedFluids();
    const counts = synthesizePass2(fx.db, raw, ctx);
    expect(get(`SELECT name FROM fluids WHERE name = ?`, FLUID_FUEL)).toBeTruthy();
    // 1 unit of fluid → its fuel_value in MJ of the pool; no machine of its own
    expect(
      get(`SELECT kind, category FROM recipes WHERE name = 'burn-fluid-kerosene'`),
    ).toMatchObject({ kind: "burning", category: null });
    expect(
      get(
        `SELECT amount FROM recipe_ingredients WHERE recipe = 'burn-fluid-kerosene' AND name = 'kerosene'`,
      ),
    ).toMatchObject({ amount: 1 });
    expect(
      get(
        `SELECT amount FROM recipe_products WHERE recipe = 'burn-fluid-kerosene' AND name = ?`,
        FLUID_FUEL,
      ),
    ).toMatchObject({ amount: 1.5 });
    expect(
      get(
        `SELECT amount FROM recipe_products WHERE recipe = 'burn-fluid-coal-gas' AND name = ?`,
        FLUID_FUEL,
      ),
    ).toMatchObject({ amount: 0.2 });
    // a fluid without a fuel_value gets no conversion
    expect(get(`SELECT name FROM recipes WHERE name = 'burn-fluid-water'`)).toBeUndefined();
    expect(counts.burning).toBe(2);
  });

  it("captures a drill's fluid energy source and folds burner effectivity", () => {
    // Py dump values: antimony-drill-mk01 is a 1MW unfiltered fluid burner
    // (energy_source { type "fluid", burns_fluid true }); mo-mine is a 550kW
    // solid burner at effectivity 8 → 68.75kW of fuel actually drawn.
    const drills = {
      "mining-drill": {
        "antimony-drill-mk01": {
          resource_categories: ["antimony"],
          mining_speed: 1,
          energy_usage: 1_000_000,
          energy_source: { type: "fluid", burns_fluid: true, effectivity: 1, fluid_box: {} },
        },
        "mo-mine": {
          resource_categories: ["molybdenum"],
          mining_speed: 1,
          energy_usage: 550_000,
          energy_source: { type: "burner", effectivity: 8, fuel_categories: ["chemical"] },
        },
      },
    };
    synthesizePass2(fx.db, drills, ctx);
    expect(
      get(
        `SELECT energy_usage_w w, burns_fluid bf, fluid_fuel_filter ff FROM crafting_machines WHERE name = 'antimony-drill-mk01'`,
      ),
    ).toMatchObject({ w: 1e6, bf: 1, ff: null });
    expect(
      get(`SELECT energy_usage_w w, burns_fluid bf FROM crafting_machines WHERE name = 'mo-mine'`),
    ).toMatchObject({ w: 68750, bf: null });
  });

  it("marks the oil boiler a pool burner — its fluid_box filter is the water box, not the fuel", () => {
    // Py's oil-boiler-mk01 verbatim: energy_consumption 29.61MW, energy_source
    // { type "fluid", burns_fluid true, effectivity 2 } (fuel draw 14.805MW,
    // matching the imported py.db row); the entity-level fluid_box.filter
    // "water" is the boiler's INPUT box, not the energy source's — so the
    // burner stays unfiltered (pool).
    fx.db.exec(
      `INSERT INTO fluids (name, display, default_temperature, heat_capacity_j) VALUES ('steam','Steam',15,200)`,
    );
    const boilers = {
      boiler: {
        "oil-boiler-mk01": {
          energy_consumption: 29_610_000,
          target_temperature: 250,
          fluid_box: { filter: "water" },
          output_fluid_box: { filter: "steam" },
          energy_source: {
            type: "fluid",
            burns_fluid: true,
            effectivity: 2,
            emissions_per_minute: { pollution: 30 },
          },
        },
      },
    };
    synthesizePass2(fx.db, boilers, ctx);
    expect(
      get(
        `SELECT energy_usage_w w, energy_source es, burns_fluid bf, fluid_fuel_filter ff FROM crafting_machines WHERE name = 'oil-boiler-mk01'`,
      ),
    ).toMatchObject({ w: 14_805_000, es: "fluid", bf: 1, ff: null });
  });
});
