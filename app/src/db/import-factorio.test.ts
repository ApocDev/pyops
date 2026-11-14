import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  REFERENCE_DATA_FORMAT_META_KEY,
  REFERENCE_DATA_FORMAT_VERSION,
} from "../lib/data-format.ts";
import { DEFAULT_EFFECT_RECEIVER } from "../server/effects.ts";
import { importFactorioDump } from "./import-factorio.ts";
import { type TestDb, makeTestDb } from "./test-helpers.ts";

let fx: TestDb;
let dumpDir: string;

beforeEach(async () => {
  fx = await makeTestDb();
  fx.db.close(); // the importer opens its own connection to the file
  dumpDir = mkdtempSync(join(tmpdir(), "pyops-dump-"));
});
afterEach(() => {
  fx.cleanup();
  rmSync(dumpDir, { recursive: true, force: true });
});

/** Write a minimal data-raw-dump.json and run the real importer against it. */
const runImport = (raw: Record<string, unknown>, baseVersion?: string) => {
  const dumpPath = join(dumpDir, "data-raw-dump.json");
  writeFileSync(dumpPath, JSON.stringify(raw));
  importFactorioDump({ dumpPath, dbUrl: fx.file, baseVersion });
  return new Database(fx.file, { readonly: true });
};

describe("importFactorioDump — recipe categories", () => {
  it("imports Factorio 2.1 categories with 2.0 and engine-default fallbacks", () => {
    const db = runImport({
      recipe: {
        soil: { categories: ["soil-extraction"], results: [] },
        legacy: { category: "smelting", results: [] },
        defaulted: { results: [] },
      },
    });
    const rows = db.prepare(`SELECT name, category FROM recipes ORDER BY name`).all() as {
      name: string;
      category: string;
    }[];
    expect(rows).toEqual([
      { name: "defaulted", category: "crafting" },
      { name: "legacy", category: "smelting" },
      { name: "soil", category: "soil-extraction" },
    ]);
    db.close();
  });
});

describe("importFactorioDump — fuel categories", () => {
  it("stores Factorio 2.1 fuel_categories and wraps a 2.0 fuel_category in a list", () => {
    const db = runImport({
      item: {
        "raw-coal": { fuel_value: "3MJ", fuel_categories: ["chemical"], burnt_result: "ash" },
        both: { fuel_value: "1MJ", fuel_categories: ["chemical", "biomass"] },
        legacy: { fuel_value: "2MJ", fuel_category: "biomass" },
        plate: {},
      },
    });
    const rows = db.prepare(`SELECT name, fuel_categories FROM items ORDER BY name`).all();
    expect(rows).toEqual([
      { name: "both", fuel_categories: '["chemical","biomass"]' },
      { name: "legacy", fuel_categories: '["biomass"]' },
      { name: "plate", fuel_categories: null },
      { name: "raw-coal", fuel_categories: '["chemical"]' },
    ]);
    db.close();
  });
});

describe("importFactorioDump — Factorio 2.1 product probability", () => {
  it("combines independent and shared rolls with legacy and default fallbacks", () => {
    const db = runImport({
      recipe: {
        chance: {
          results: [
            { type: "item", name: "default", amount: 1 },
            { type: "item", name: "legacy", amount: 1, probability: 0.25 },
            { type: "item", name: "independent", amount: 1, independent_probability: 0.4 },
            {
              type: "item",
              name: "shared",
              amount: 1,
              shared_probability: { min: 0.2, max: 0.7 },
            },
            {
              type: "item",
              name: "both",
              amount: 1,
              independent_probability: 0.5,
              shared_probability: { min: 0.6, max: 0.8 },
            },
          ],
        },
      },
    });
    const rows = db.prepare(`SELECT name, probability FROM recipe_products ORDER BY idx`).all() as {
      name: string;
      probability: number;
    }[];
    expect(rows[0]).toEqual({ name: "default", probability: 1 });
    expect(rows[1]).toEqual({ name: "legacy", probability: 0.25 });
    expect(rows[2]).toEqual({ name: "independent", probability: 0.4 });
    expect(rows[3].name).toBe("shared");
    expect(rows[3].probability).toBeCloseTo(0.5);
    expect(rows[4].name).toBe("both");
    expect(rows[4].probability).toBeCloseTo(0.1);
    db.close();
  });
});

describe("importFactorioDump — data format version", () => {
  it("records the reader version after a successful two-pass import", () => {
    const db = runImport({ recipe: {} });
    const stored = db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .pluck()
      .get(REFERENCE_DATA_FORMAT_META_KEY);
    expect(stored).toBe(String(REFERENCE_DATA_FORMAT_VERSION));
    db.close();
  });
});

describe("importFactorioDump — quality effect and allow_quality (#260)", () => {
  it("stores each module's quality effect and each recipe's allow_quality", () => {
    const db = runImport({
      recipe: {
        // the quality mod sets allow_quality = false; absent means the engine default, true
        "basic-oil-processing": { allow_quality: false, results: [] },
        "iron-gear-wheel": { results: [] },
      },
      module: {
        "quality-module": { category: "quality", effect: { quality: 0.01, speed: -0.05 } },
        "speed-module": { category: "speed", effect: { speed: 0.2, quality: -0.01 } },
        "efficiency-module": { category: "efficiency", effect: { consumption: -0.3 } },
      },
    });
    expect(db.prepare(`SELECT name, allow_quality FROM recipes ORDER BY name`).all()).toEqual([
      { name: "basic-oil-processing", allow_quality: 0 },
      { name: "iron-gear-wheel", allow_quality: 1 },
    ]);
    expect(db.prepare(`SELECT name, eff_quality FROM modules ORDER BY name`).all()).toEqual([
      { name: "efficiency-module", eff_quality: 0 },
      { name: "quality-module", eff_quality: 0.01 },
      { name: "speed-module", eff_quality: -0.01 },
    ]);
    db.close();
  });
});

describe("importFactorioDump — quality capability", () => {
  const hasQuality = (raw: Record<string, unknown>) => {
    const db = runImport(raw);
    const row = db.prepare(`SELECT value FROM meta WHERE key = 'has_quality'`).get() as {
      value: string;
    };
    db.close();
    return row.value;
  };

  it("is on only when normal quality links to a next level", () => {
    expect(
      hasQuality({ quality: { normal: { level: 0, next: "uncommon" }, uncommon: { level: 1 } } }),
    ).toBe("1");
  });

  it("stays off for a lone normal quality, even with a recycler (Py)", () => {
    expect(
      hasQuality({
        quality: { normal: { level: 0 } },
        furnace: { recycler: { crafting_speed: 1 } },
      }),
    ).toBe("0");
    expect(hasQuality({})).toBe("0");
  });
});

describe("importFactorioDump — machine effect receivers (#258)", () => {
  it("stores each machine's effect_receiver with defaults filled in", () => {
    const db = runImport({
      "assembling-machine": {
        // Py farm: assembling-machine.fawogae-plantation-mk01
        "fawogae-plantation-mk01": {
          crafting_categories: ["fawogae"],
          effect_receiver: { base_effect: { speed: -1 }, speed_limits: { low: -0.9999 } },
        },
        "assembling-machine-1": {
          crafting_categories: ["crafting"],
          effect_receiver: { uses_module_effects: false, uses_beacon_effects: false },
        },
        plain: { crafting_categories: ["crafting"] },
      },
      // Py mine: mining-drill.salt-mine (synthesized into crafting_machines)
      "mining-drill": {
        "salt-mine": {
          resource_categories: ["salt-rock"],
          effect_receiver: { base_effect: { consumption: 9 } },
        },
      },
    });
    const rx = (name: string) => {
      const v = db
        .prepare(`SELECT effect_receiver FROM crafting_machines WHERE name = ?`)
        .pluck()
        .get(name) as string | null;
      return v == null ? null : JSON.parse(v);
    };
    expect(rx("plain")).toBeNull();
    expect(rx("fawogae-plantation-mk01")).toEqual({
      ...DEFAULT_EFFECT_RECEIVER,
      baseEffect: { ...DEFAULT_EFFECT_RECEIVER.baseEffect, speed: -1 },
      limits: { ...DEFAULT_EFFECT_RECEIVER.limits, speed: { low: -0.9999, high: 1000 } },
    });
    expect(rx("assembling-machine-1")).toMatchObject({
      usesModuleEffects: false,
      usesBeaconEffects: false,
    });
    expect(rx("salt-mine").baseEffect).toMatchObject({ consumption: 9, speed: 0 });
    db.close();
  });
});

describe("importFactorioDump — electric drain", () => {
  it("applies the engine default for crafting machines and honors explicit keys", () => {
    // Shapes and values from Py's dump; the in-game drain is in each comment.
    const db = runImport({
      "assembling-machine": {
        // no drain key, 333.33 kW in game (energy_usage / 30)
        "automated-factory-mk04": {
          crafting_categories: ["crafting"],
          energy_usage: "10MW",
          energy_source: { type: "electric", usage_priority: "secondary-input" },
        },
        // explicit key, 400 kW in game
        "dino-dig-site": {
          crafting_categories: ["dino"],
          energy_usage: "1W",
          energy_source: { type: "electric", drain: "400kW" },
        },
        // burner sources have no drain
        "burner-assembler": {
          crafting_categories: ["crafting"],
          energy_usage: "100kW",
          energy_source: { type: "burner", fuel_categories: ["chemical"] },
        },
      },
      // no drain key, 0 in game: the default is for crafting machines only
      "mining-drill": {
        "electric-mining-drill": {
          resource_categories: ["basic-solid"],
          energy_usage: "90kW",
          energy_source: { type: "electric" },
        },
      },
      lab: {
        lab: { energy_usage: "60kW", energy_source: { type: "electric" }, inputs: [] },
      },
    });
    const drain = (table: string, name: string) =>
      db.prepare(`SELECT drain_w FROM ${table} WHERE name = ?`).pluck().get(name);
    expect(drain("crafting_machines", "automated-factory-mk04")).toBeCloseTo(10_000_000 / 30, 3);
    expect(drain("crafting_machines", "dino-dig-site")).toBe(400_000);
    expect(drain("crafting_machines", "burner-assembler")).toBeNull();
    expect(drain("crafting_machines", "electric-mining-drill")).toBe(0);
    expect(drain("crafting_machines", "lab")).toBe(0);
    expect(drain("labs", "lab")).toBe(0);
    db.close();
  });
});

describe("importFactorioDump — machine footprints", () => {
  it("derives placed tile dimensions from array and named selection boxes", () => {
    const db = runImport({
      "assembling-machine": {
        burner: {
          crafting_categories: ["crafting"],
          selection_box: [
            [-1.5, -1.5],
            [1.5, 1.5],
          ],
        },
        odd: {
          crafting_categories: ["crafting"],
          selection_box: {
            left_top: { x: -1, y: -1.5 },
            right_bottom: { x: 1, y: 1.5 },
          },
        },
      },
    });
    const rows = db
      .prepare(
        `SELECT name, tile_width tileWidth, tile_height tileHeight
         FROM crafting_machines ORDER BY name`,
      )
      .all();
    expect(rows).toEqual([
      { name: "burner", tileWidth: 3, tileHeight: 3 },
      { name: "odd", tileWidth: 2, tileHeight: 3 },
    ]);
    db.close();
  });

  it("falls back to the collision box and leaves missing boxes unknown", () => {
    const db = runImport({
      furnace: {
        boxed: {
          crafting_categories: ["smelting"],
          collision_box: [
            [-1.2, -1.2],
            [1.2, 1.2],
          ],
        },
        legacy: { crafting_categories: ["smelting"] },
      },
    });
    const rows = db
      .prepare(
        `SELECT name, tile_width tileWidth, tile_height tileHeight
         FROM crafting_machines ORDER BY name`,
      )
      .all();
    expect(rows).toEqual([
      { name: "boxed", tileWidth: 3, tileHeight: 3 },
      { name: "legacy", tileWidth: null, tileHeight: null },
    ]);
    db.close();
  });
});

describe("importFactorioDump — inserters (#281)", () => {
  it("stores the prototype's built-in hand bonus from stack_size_bonus", () => {
    const db = runImport({
      inserter: {
        inserter: { rotation_speed: 0.02, extension_speed: 0.035 },
        "py-stack-inserter": {
          rotation_speed: 0.0238,
          extension_speed: 0.1,
          bulk: true,
          stack_size_bonus: 12,
          max_belt_stack_size: 8,
        },
      },
    });
    const rows = db
      .prepare(`SELECT name, base_stack_bonus, max_belt_stack_size FROM inserters ORDER BY name`)
      .all();
    expect(rows).toEqual([
      { name: "inserter", base_stack_bonus: 0, max_belt_stack_size: 1 },
      { name: "py-stack-inserter", base_stack_bonus: 12, max_belt_stack_size: 8 },
    ]);
    db.close();
  });
});

describe("importFactorioDump — logistic robots (#255)", () => {
  it("stores robot speed, cargo and battery in joules, and roboport charge rate", () => {
    const db = runImport({
      "logistic-robot": {
        // py-logistic-robot-mk01's values in the Py dump
        "py-logistic-robot-mk01": {
          speed: 0.08,
          max_payload_size: 3,
          max_energy: "1.5MJ",
          energy_per_tick: "0.05kJ",
          energy_per_move: "4kJ",
          min_to_charge: 0.2,
          max_to_charge: 0.95,
        },
        "logistic-robot": { speed: 0.05, hidden: true },
      },
      roboport: {
        "py-roboport-mk01": { charging_energy: "350kW", logistics_radius: 30 },
      },
    });
    expect(db.prepare(`SELECT * FROM logistic_robots`).all()).toEqual([
      {
        name: "py-logistic-robot-mk01",
        display: null,
        order: null,
        speed: 0.08,
        max_payload_size: 3,
        max_energy_j: 1_500_000,
        energy_per_move_j: 4000,
        energy_per_tick_j: 50,
        min_to_charge: 0.2,
        max_to_charge: 0.95,
      },
    ]);
    expect(
      db.prepare(`SELECT name, charging_energy_w, logistics_radius FROM roboports`).all(),
    ).toEqual([{ name: "py-roboport-mk01", charging_energy_w: 350_000, logistics_radius: 30 }]);
    db.close();
  });
});

describe("importFactorioDump — TURD master detection", () => {
  it("infers current planner masters from their sub-tech gate prerequisites", () => {
    const db = runImport({
      technology: {
        "dhilmos-upgrade": { prerequisites: ["dhilmos-mk04"] },
        "double-intake": {
          prerequisites: ["dhilmos-upgrade", "turd-select-double-intake"],
        },
        "turd-select-double-intake": { enabled: false },
        automation: { prerequisites: [] },
        "legacy-turd-master": { is_turd: true },
      },
    });
    const rows = db
      .prepare(`SELECT name, is_turd isTurd FROM technologies ORDER BY name`)
      .all() as { name: string; isTurd: number }[];
    expect(rows).toEqual([
      { name: "automation", isTurd: 0 },
      { name: "dhilmos-upgrade", isTurd: 1 },
      { name: "double-intake", isTurd: 0 },
      { name: "legacy-turd-master", isTurd: 1 },
      { name: "turd-select-double-intake", isTurd: 0 },
    ]);
    db.close();
  });
});

// Fixture values are a real slice of the Py dump (data-raw-dump.json):
// technology.microfilters grants change-recipe-productivity fawogae-spore +0.15
// and navens-spore +0.4; technology.mining-productivity-1 grants
// mining-drill-productivity-bonus +0.1; recipe.fawogae-spore has
// allow_productivity=true and maximum_productivity=1000000.
describe("importFactorioDump — research productivity effects (#92)", () => {
  const raw = {
    recipe: {
      "fawogae-spore": {
        category: "sporer",
        energy_required: 20,
        allow_productivity: true,
        maximum_productivity: 1_000_000,
        results: [{ type: "item", name: "fawogae-spore", amount: 1 }],
      },
      // no maximum_productivity → engine default (stored NULL)
      "bhoddos-spore": {
        category: "sporer",
        results: [{ type: "item", name: "bhoddos-spore", amount: 1 }],
      },
    },
    technology: {
      microfilters: {
        prerequisites: ["machines-mk01"],
        effects: [
          { type: "change-recipe-productivity", recipe: "fawogae-spore", change: 0.15 },
          { type: "change-recipe-productivity", recipe: "navens-spore", change: 0.4 },
        ],
        unit: {
          count: 120,
          ingredients: [
            ["logistic-science-pack", 1],
            ["py-science-pack-1", 2],
            ["automation-science-pack", 3],
          ],
        },
      },
      "mining-productivity-1": {
        effects: [{ type: "mining-drill-productivity-bonus", modifier: 0.1 }],
        unit: {
          count: 90,
          ingredients: [
            ["py-science-pack-1", 1],
            ["automation-science-pack", 2],
          ],
        },
      },
      // no productivity effects → no rows
      "research-speed-1": {
        effects: [{ type: "laboratory-speed", modifier: 0.2 }],
      },
    },
  };

  it("captures change-recipe-productivity per (tech, recipe)", () => {
    const db = runImport(raw);
    const rows = db
      .prepare(
        `SELECT recipe, modifier FROM tech_productivity_bonuses
         WHERE technology = 'microfilters' ORDER BY recipe`,
      )
      .all() as { recipe: string; modifier: number }[];
    expect(rows).toEqual([
      { recipe: "fawogae-spore", modifier: 0.15 },
      { recipe: "navens-spore", modifier: 0.4 },
    ]);
    db.close();
  });

  it("captures mining-drill-productivity-bonus under the '' (mining) key", () => {
    const db = runImport(raw);
    const row = db
      .prepare(
        `SELECT recipe, modifier FROM tech_productivity_bonuses
         WHERE technology = 'mining-productivity-1'`,
      )
      .get() as { recipe: string; modifier: number };
    expect(row).toEqual({ recipe: "", modifier: 0.1 });
    db.close();
  });

  it("stores no rows for techs without productivity effects", () => {
    const db = runImport(raw);
    const n = db
      .prepare(
        `SELECT count(*) c FROM tech_productivity_bonuses WHERE technology = 'research-speed-1'`,
      )
      .get() as { c: number };
    expect(n.c).toBe(0);
    db.close();
  });

  it("imports recipe maximum_productivity (NULL when the prototype omits it)", () => {
    const db = runImport(raw);
    const caps = db
      .prepare(`SELECT name, maximum_productivity mp FROM recipes ORDER BY name`)
      .all() as { name: string; mp: number | null }[];
    expect(caps).toEqual([
      { name: "bhoddos-spore", mp: null },
      { name: "fawogae-spore", mp: 1_000_000 },
    ]);
    db.close();
  });

  it("accumulates multiple effects on the same recipe within one tech", () => {
    const db = runImport({
      technology: {
        "double-up": {
          effects: [
            { type: "change-recipe-productivity", recipe: "fawogae-spore", change: 0.1 },
            { type: "change-recipe-productivity", recipe: "fawogae-spore", change: 0.2 },
            { type: "mining-drill-productivity-bonus", modifier: 0.1 },
            { type: "mining-drill-productivity-bonus", modifier: 0.1 },
          ],
        },
      },
    });
    const rows = db
      .prepare(
        `SELECT recipe, modifier FROM tech_productivity_bonuses
         WHERE technology = 'double-up' ORDER BY recipe`,
      )
      .all() as { recipe: string; modifier: number }[];
    expect(rows[0].recipe).toBe("");
    expect(rows[0].modifier).toBeCloseTo(0.2);
    expect(rows[1].recipe).toBe("fawogae-spore");
    expect(rows[1].modifier).toBeCloseTo(0.3);
    db.close();
  });
});

// Fixture values verbatim from the Py dump: nuclear-reactor-mk01 draws 300kW
// through a temperature-fed uf6 source (scale_fluid_usage false,
// maximum_temperature 250) — the engine derives a FIXED per-tick usage from
// the cap; compost-plant-mk01-turd draws 1MW at effectivity 1000 with
// scale_fluid_usage true — the drain follows the energy draw, so only the
// usable J per unit is stored. fluid.uf6: default_temperature 0.01,
// heat_capacity "0.02kJ"; fluid.sweet-syrup: default_temperature 0, no
// heat_capacity (engine default 1kJ).
describe("importFactorioDump — temperature-fed fluid energy sources (#114)", () => {
  const raw = {
    fluid: {
      uf6: { default_temperature: 0.01, max_temperature: 10000, heat_capacity: "0.02kJ" },
      "sweet-syrup": { default_temperature: 0, max_temperature: 100 },
    },
    "assembling-machine": {
      "nuclear-reactor-mk01": {
        crafting_categories: ["nuclear-fission"],
        crafting_speed: 2,
        energy_usage: "300kW",
        energy_source: {
          type: "fluid",
          effectivity: 1,
          burns_fluid: false,
          scale_fluid_usage: false,
          maximum_temperature: 250,
          fluid_box: { filter: "uf6" },
        },
      },
    },
    furnace: {
      "compost-plant-mk01-turd": {
        crafting_categories: ["composting"],
        crafting_speed: 1,
        energy_usage: "1MW",
        energy_source: {
          type: "fluid",
          effectivity: 1000,
          burns_fluid: false,
          scale_fluid_usage: true,
          maximum_temperature: 10,
          fluid_box: { filter: "sweet-syrup" },
        },
      },
    },
  };

  it("derives the uf6 reactor's fixed drain from its maximum_temperature", () => {
    const db = runImport(raw);
    const row = db
      .prepare(
        `SELECT energy_usage_w w, burns_fluid bf, fluid_fuel_filter ff,
                fluid_fuel_per_sec ps, fluid_fuel_energy_j ej
         FROM crafting_machines WHERE name = 'nuclear-reactor-mk01'`,
      )
      .get() as { w: number; bf: number; ff: string; ps: number; ej: number };
    expect(row).toMatchObject({ w: 300_000, bf: 0, ff: "uf6" });
    // 300000 W ÷ ((250 − 0.01)° × 20 J/°) ≈ 60.0024 uf6/s, fixed
    expect(row.ej).toBeCloseTo(4999.8);
    expect(row.ps).toBeCloseTo(60.0024, 4);
    db.close();
  });

  it("stores only the usable J per unit for a scale_fluid_usage source", () => {
    const db = runImport(raw);
    const row = db
      .prepare(
        `SELECT energy_usage_w w, burns_fluid bf, fluid_fuel_filter ff,
                fluid_fuel_per_sec ps, fluid_fuel_energy_j ej
         FROM crafting_machines WHERE name = 'compost-plant-mk01-turd'`,
      )
      .get() as { w: number; bf: number; ff: string; ps: number | null; ej: number };
    // effectivity 1000 folds into the stored draw (1MW → 1kW of heat drawn)
    expect(row).toMatchObject({ w: 1000, bf: 0, ff: "sweet-syrup", ps: null });
    // (10 − 0)° × 1kJ engine-default heat_capacity = 10kJ per unit
    expect(row.ej).toBeCloseTo(10_000);
    db.close();
  });
});

describe("importFactorioDump — labs", () => {
  // Shapes mirror Py's real prototypes: `lab` has no slots of its own and takes
  // only vatbrain-category effects (delivered by the Vatbrain biocomputer's
  // hidden beacon); `ee-super-lab` is a conventional modulable lab.
  const raw = {
    lab: {
      lab: {
        researching_speed: 1,
        module_slots: 0,
        energy_usage: "60kW",
        energy_source: { type: "electric", emissions_per_minute: { pollution: 2 } },
        allowed_effects: ["consumption", "productivity", "pollution"],
        allowed_module_categories: ["vatbrain"],
        inputs: ["automation-science-pack", "py-science-pack-1", "logistic-science-pack"],
        selection_box: [
          [-1.5, -1.5],
          [1.5, 1.5],
        ],
      },
      "ee-super-lab": {
        researching_speed: 100,
        module_slots: 10,
        energy_usage: "1MW",
        energy_source: { type: "electric" },
        allowed_module_categories: ["productivity", "speed"],
        inputs: ["automation-science-pack"],
      },
      "hidden-test-lab": { inputs: ["automation-science-pack"], hidden: true },
    },
  };

  it("imports lab prototypes with speed, slots, power and pack inputs", () => {
    const db = runImport(raw);
    const row = db
      .prepare(
        `SELECT researching_speed rs, module_slots ms, energy_usage_w w, energy_source es,
                pollution_per_min ppm, allowed_effects ae, allowed_module_categories amc,
                inputs, tile_width tw, tile_height th
         FROM labs WHERE name = 'lab'`,
      )
      .get() as Record<string, unknown>;
    expect(row).toMatchObject({
      rs: 1,
      ms: 0,
      w: 60_000,
      es: "electric",
      ppm: 2,
      tw: 3,
      th: 3,
    });
    expect(JSON.parse(row.ae as string)).toEqual(["consumption", "productivity", "pollution"]);
    // the vatbrain restriction is the whole reason this column matters for labs
    expect(JSON.parse(row.amc as string)).toEqual(["vatbrain"]);
    expect(JSON.parse(row.inputs as string)).toEqual([
      "automation-science-pack",
      "py-science-pack-1",
      "logistic-science-pack",
    ]);
    db.close();
  });

  it("defaults researching_speed and records hidden labs rather than skipping them", () => {
    const db = runImport(raw);
    const rows = db
      .prepare(`SELECT name, researching_speed rs, hidden FROM labs ORDER BY name`)
      .all() as { name: string; rs: number; hidden: number }[];
    expect(rows).toEqual([
      { name: "ee-super-lab", rs: 100, hidden: 0 },
      { name: "hidden-test-lab", rs: 1, hidden: 1 },
      { name: "lab", rs: 1, hidden: 0 },
    ]);
    db.close();
  });

  // Pass 1 records the lab prototype faithfully in its own table; pass 2 also
  // registers it as a crafting machine under the synthetic research category, so
  // the block solver can put labs on rows and give them modules and beacons.
  // Neither is redundant: `labs.inputs` is the authoritative pack list, and no
  // real crafting category exists to join a lab to a recipe.
  it("adds no lab to crafting_machines from the prototype pass itself", () => {
    const db = runImport(raw);
    const rows = db.prepare(`SELECT name, kind FROM crafting_machines ORDER BY name`).all() as {
      name: string;
      kind: string;
    }[];
    // every crafting-machine row here came from synthesis, not the lab import
    expect(rows.every((r) => r.kind === "lab")).toBe(true);
    db.close();
  });

  it("registers labs as research-category machines so the solver can use them", () => {
    const db = runImport(raw);
    const rows = db
      .prepare(
        `SELECT m.name, m.crafting_speed speed, m.module_slots slots
         FROM crafting_machines m JOIN machine_categories c ON c.machine = m.name
         WHERE c.category = 'pyops-research' ORDER BY m.name`,
      )
      .all();
    expect(rows).toEqual([
      { name: "ee-super-lab", speed: 100, slots: 10 },
      { name: "lab", speed: 1, slots: 0 },
    ]);
    db.close();
  });
});

describe("importFactorioDump — technology research cost", () => {
  // A tech is either lab-researched (unit) or trigger-researched (research_trigger);
  // Py's dump has no tech with both and none with neither.
  const raw = {
    technology: {
      "silver-mk01": {
        unit: {
          count: 175,
          time: 60,
          ingredients: [
            ["logistic-science-pack", 1],
            ["py-science-pack-1", 2],
          ],
        },
      },
      "steam-power": {
        research_trigger: { type: "craft-item", item: "iron-plate", count: 10 },
      },
      "no-unit": {},
    },
  };

  it("stores unit.time alongside unit.count, defaulting to null", () => {
    const db = runImport(raw);
    const rows = db
      .prepare(`SELECT name, unit_count uc, unit_time ut FROM technologies ORDER BY name`)
      .all() as { name: string; uc: number | null; ut: number | null }[];
    expect(rows).toEqual([
      { name: "no-unit", uc: null, ut: null },
      { name: "silver-mk01", uc: 175, ut: 60 },
      { name: "steam-power", uc: null, ut: null },
    ]);
    db.close();
  });

  it("stores a trigger tech's research_trigger and leaves its unit columns null", () => {
    const db = runImport(raw);
    const rows = db
      .prepare(
        `SELECT name, research_trigger rt FROM technologies WHERE research_trigger IS NOT NULL`,
      )
      .all() as { name: string; rt: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("steam-power");
    expect(JSON.parse(rows[0]!.rt)).toEqual({
      type: "craft-item",
      item: "iron-plate",
      count: 10,
    });
    db.close();
  });
});

describe("importFactorioDump — meta is not the importer's to clear", () => {
  // A sync rebuilds reference data. It must not take user preferences or the live
  // game state the mod bridge syncs in down with it.
  const PRESERVED: Record<string, string> = {
    logistics_stacking: "0",
    logistics_belt: "fast-transport-belt",
    logistics_mover_kind: "loader",
    research_mode: "now",
    researched_techs: '["automation","logistics"]',
    research_mining_productivity_bonus: "0.4",
    factory_pins_v1: '[{"good":"automation-science-pack","kind":"item","rate":0.5}]',
    // clearing this silently re-baselines mod renames, so a pending rename is lost
    migrations_applied: '["pyalienlife/1.2.3.json"]',
    built_synced_count: "42",
    turd_synced_at: "2026-07-28T00:00:00.000Z",
  };

  const seedAndImport = () => {
    const seed = new Database(fx.file);
    const stmt = seed.prepare(`INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)`);
    for (const [k, v] of Object.entries(PRESERVED)) stmt.run(k, v);
    // a stale value for a key the importer DOES own
    stmt.run("rocket_lift_weight", "1");
    seed.close();
    return runImport({
      recipe: { "iron-plate": { results: [{ type: "item", name: "iron-plate", amount: 1 }] } },
      "utility-constants": { default: { rocket_lift_weight: 999, default_item_weight: 100 } },
    });
  };

  it("preserves preferences, live research state, pins and the rename baseline", () => {
    const db = seedAndImport();
    const rows = db.prepare(`SELECT key, value FROM meta`).all() as {
      key: string;
      value: string;
    }[];
    const got = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    for (const [k, v] of Object.entries(PRESERVED)) expect(got[k]).toBe(v);
    db.close();
  });

  it("still overwrites the keys that describe the dump", () => {
    const db = seedAndImport();
    const get = (k: string) =>
      (db.prepare(`SELECT value FROM meta WHERE key = ?`).get(k) as { value: string } | undefined)
        ?.value;
    expect(get("rocket_lift_weight")).toBe("999"); // stale seed replaced
    expect(get(REFERENCE_DATA_FORMAT_META_KEY)).toBe(String(REFERENCE_DATA_FORMAT_VERSION));
    expect(get("imported_from")).toBeTruthy();
    db.close();
  });
});

describe("importFactorioDump — Py beacon exports", () => {
  // Current Py prototypes, trimmed: the Vatbrain biocomputer, its hidden carrier
  // `hidden-beacon-vatbrain`, the TURD carrier (which also accepts vatbrains), one
  // AM/FM beacon, and the dump helper's two mod-data exports.
  const raw = {
    "assembling-machine": {
      "vat-brain": {
        crafting_categories: ["vat"],
        crafting_speed: 1,
        energy_usage: "900kW",
        energy_source: { type: "electric" },
      },
      "chemical-plant": {
        crafting_categories: ["chemistry"],
        crafting_speed: 1,
        energy_usage: "210kW",
        energy_source: { type: "electric" },
      },
      "fawogae-plantation-mk02": {
        crafting_categories: ["fawogae"],
        crafting_speed: 1,
        energy_usage: "100kW",
        energy_source: { type: "electric" },
      },
    },
    beacon: {
      "hidden-beacon-vatbrain": {
        hidden: true,
        module_slots: 1,
        energy_usage: "1W",
        distribution_effectivity: 1,
        allowed_module_categories: ["vatbrain"],
      },
      "hidden-beacon-turd": {
        hidden: true,
        module_slots: 1,
        energy_usage: "1W",
        distribution_effectivity: 1,
        allowed_module_categories: ["productivity", "speed", "vatbrain", "fawogae"],
      },
      "beacon-AM2-FM2": {
        module_slots: 2,
        energy_usage: "4MW",
        distribution_effectivity: 0.8,
        allowed_module_categories: ["productivity", "speed"],
      },
    },
    module: {
      "vatbrain-4": { category: "vatbrain", hidden: true, effect: { productivity: 1 } },
    },
    "mod-data": {
      "pyops-effect-beacons": {
        data: {
          beacons: [
            {
              machine: "vat-brain",
              energy_usage: "900kW",
              crafting_speed: 1,
              tiers: [
                {
                  recipe: "brain-food-04",
                  module: "vatbrain-4",
                  item: "brain-cartridge-04",
                  energy: 20,
                },
              ],
            },
          ],
        },
      },
      "pyops-beacon-interference": {
        data: {
          beacons: { "beacon-AM2-FM2": ["AM2", "FM2"] },
          exempt: ["fawogae-plantation-mk02"],
        },
      },
    },
  };

  it("builds the vat-brain beacon from the derived carrier, with power and upkeep", () => {
    const db = runImport(raw);
    expect(
      db
        .prepare(
          `SELECT hidden, energy_usage_w w, module_slots slots, distribution_effectivity de,
                  allowed_module_categories amc FROM beacons WHERE name = 'vat-brain'`,
        )
        .get(),
    ).toEqual({ hidden: 0, w: 900_000, slots: 1, de: 1, amc: '["vatbrain"]' });
    expect(db.prepare(`SELECT module, item, per_sec perSec FROM beacon_upkeep`).all()).toEqual([
      { module: "vatbrain-4", item: "brain-cartridge-04", perSec: 0.05 },
    ]);
    db.close();
  });

  it("stores interference groups and exempt machines", () => {
    const db = runImport(raw);
    const groups = db.prepare(`SELECT name, interference FROM beacons ORDER BY name`).all();
    expect(groups).toEqual([
      { name: "beacon-AM2-FM2", interference: '["AM2","FM2"]' },
      { name: "hidden-beacon-turd", interference: null },
      { name: "hidden-beacon-vatbrain", interference: null },
      { name: "vat-brain", interference: null },
    ]);
    const exempt = db
      .prepare(
        `SELECT name FROM crafting_machines WHERE beacon_interference_exempt = 1 ORDER BY name`,
      )
      .all();
    expect(exempt).toEqual([{ name: "fawogae-plantation-mk02" }]);
    db.close();
  });
});

/* The quality mod as Factorio 2.1.24 ships it, trimmed to what the importer
 * reads. `normal` is base's (base/prototypes/categories/quality.lua) with the
 * quality mod's `next` (quality/prototypes/base-data-updates.lua:1) and
 * `hidden = false` (quality/data.lua); the other tiers are
 * quality/prototypes/quality.lua; the modules quality/prototypes/item.lua; the
 * `unlock-quality` effects quality/prototypes/technology.lua. */
const QUALITY_MOD = {
  quality: {
    normal: {
      level: 0,
      next: "uncommon",
      next_probability: 1,
      chain_probability: 0.1,
      hidden: false,
    },
    uncommon: {
      level: 1,
      next: "rare",
      next_probability: 1,
      chain_probability: 0.1,
      beacon_power_usage_multiplier: 5 / 6,
      science_pack_drain_multiplier: 99 / 100,
    },
    rare: {
      level: 2,
      next: "epic",
      next_probability: 1,
      chain_probability: 0.1,
      beacon_power_usage_multiplier: 4 / 6,
      science_pack_drain_multiplier: 98 / 100,
    },
    epic: {
      level: 3,
      next: "legendary",
      next_probability: 1,
      chain_probability: 0.1,
      beacon_power_usage_multiplier: 3 / 6,
      science_pack_drain_multiplier: 97 / 100,
    },
    legendary: {
      level: 5,
      beacon_power_usage_multiplier: 1 / 6,
      science_pack_drain_multiplier: 95 / 100,
    },
    // core/prototypes/unknown.lua
    "quality-unknown": { level: 0, hidden: true },
  },
  module: {
    "quality-module": { category: "quality", effect: { quality: 0.01, speed: -0.05 } },
    "quality-module-3": { category: "quality", effect: { quality: 0.025, speed: -0.05 } },
  },
  technology: {
    "quality-module": {
      effects: [
        { type: "unlock-recipe", recipe: "quality-module" },
        { type: "unlock-quality", quality: "uncommon" },
        { type: "unlock-quality", quality: "rare" },
      ],
    },
    "epic-quality": { effects: [{ type: "unlock-quality", quality: "epic" }] },
    "legendary-quality": { effects: [{ type: "unlock-quality", quality: "legendary" }] },
  },
};

describe("importFactorioDump — quality prototypes (#265)", () => {
  const all = (db: Database.Database, sql: string) => db.prepare(sql).all();

  it("imports the quality mod's tiers with the 2.1 defaults filled in", () => {
    writeFileSync(
      join(dumpDir, "quality-locale.json"),
      JSON.stringify({ names: { normal: "Normal", legendary: "Legendary" } }),
    );
    const db = runImport(QUALITY_MOD);
    const q = (name: string) =>
      db.prepare(`SELECT * FROM qualities WHERE name = ?`).get(name) as Record<string, unknown>;

    expect(q("normal")).toMatchObject({
      display: "Normal",
      level: 0,
      next: "uncommon",
      next_probability: 1,
      chain_probability: 0.1,
      hidden: 0,
      module_quality_multiplier: 1,
      crafting_machine_module_slots_bonus: 0,
      tool_durability_multiplier: 1,
    });
    // uncommon sets only its beacon power and drain; the rest are defaults
    // from level 1: default_multiplier 1.3, slot bonuses 1, durability 2
    expect(q("uncommon")).toEqual({
      name: "uncommon",
      display: null,
      level: 1,
      next: "rare",
      next_probability: 1,
      chain_probability: 0.1,
      hidden: 0,
      module_speed_multiplier: 1.3,
      module_productivity_multiplier: 1.3,
      module_consumption_multiplier: 1.3,
      module_pollution_multiplier: 1.3,
      module_quality_multiplier: 1.3,
      crafting_machine_speed_multiplier: 1.3,
      crafting_machine_energy_usage_multiplier: 1,
      crafting_machine_module_slots_bonus: 1,
      beacon_power_usage_multiplier: 5 / 6,
      beacon_module_slots_bonus: 1,
      lab_research_speed_multiplier: 1.3,
      lab_module_slots_bonus: 1,
      mining_drill_module_slots_bonus: 1,
      science_pack_drain_multiplier: 0.99,
      tool_durability_multiplier: 2,
    });
    // the top of the chain: no next, so no chance to go further
    expect(q("legendary")).toMatchObject({
      display: "Legendary",
      level: 5,
      next: null,
      next_probability: 0,
      chain_probability: 0,
      crafting_machine_speed_multiplier: 2.5,
      beacon_module_slots_bonus: 5,
      tool_durability_multiplier: 6,
    });
    expect(q("quality-unknown")).toMatchObject({ hidden: 1, next: null });

    expect(
      all(db, `SELECT technology, quality FROM tech_quality_unlocks ORDER BY quality`),
    ).toEqual([
      { technology: "epic-quality", quality: "epic" },
      { technology: "legendary-quality", quality: "legendary" },
      { technology: "quality-module", quality: "rare" },
      { technology: "quality-module", quality: "uncommon" },
    ]);
    expect(all(db, `SELECT name, eff_quality FROM modules ORDER BY name`)).toEqual([
      { name: "quality-module", eff_quality: 0.01 },
      { name: "quality-module-3", eff_quality: 0.025 },
    ]);
    expect(
      db.prepare(`SELECT value FROM meta WHERE key = 'quality_effect_step'`).pluck().get(),
    ).toBe("0.0001");
    db.close();
  });

  it("defaults each module effect to scale with quality only when it helps", () => {
    const db = runImport({
      module: {
        "quality-module": { category: "quality", effect: { quality: 0.01, speed: -0.05 } },
        // base speed module 1: speed +0.2, consumption +0.5, quality -0.01
        "speed-module": {
          category: "speed",
          effect: { speed: 0.2, consumption: 0.5, quality: -0.01 },
        },
        "efficiency-module": { category: "efficiency", effect: { consumption: -0.3 } },
        "productivity-module": {
          category: "productivity",
          effect: { productivity: 0.04, consumption: 0.4, pollution: 0.05, speed: -0.05 },
          pollution_quality_multiplier: 0.5,
        },
      },
    });
    expect(
      db
        .prepare(
          `SELECT name, speed_quality_multiplier s, productivity_quality_multiplier pr, consumption_quality_multiplier c, pollution_quality_multiplier po, quality_quality_multiplier q FROM modules ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "efficiency-module", s: 0, pr: 0, c: 1, po: 0, q: 0 },
      { name: "productivity-module", s: 0, pr: 1, c: 0, po: 0.5, q: 0 },
      { name: "quality-module", s: 0, pr: 0, c: 0, po: 0, q: 1 },
      { name: "speed-module", s: 1, pr: 0, c: 0, po: 0, q: 0 },
    ]);
    db.close();
  });

  it("uses a quality's own values over the defaults", () => {
    const db = runImport({
      quality: {
        normal: { level: 0, next: "shiny", next_probability: 1, chain_probability: 0.1 },
        shiny: {
          level: 2,
          next_probability: 0.5,
          default_multiplier: 1.5,
          module_quality_multiplier: 3,
          lab_module_slots_bonus: 0,
        },
      },
    });
    expect(db.prepare(`SELECT * FROM qualities WHERE name = 'shiny'`).get()).toMatchObject({
      chain_probability: 0.05, // clamp(next_probability × 0.1, 0, 1)
      module_speed_multiplier: 1.5,
      module_quality_multiplier: 3,
      lab_module_slots_bonus: 0,
      crafting_machine_module_slots_bonus: 2,
    });
    db.close();
  });

  // Factorio 2.0: no chain_probability, next_probability 0.1, and quality
  // effects 10× larger (quality module 1 = 0.1, speed modules -0.1)
  const DUMP_2_0 = {
    quality: {
      normal: { level: 0, next: "uncommon", next_probability: 0.1 },
      uncommon: { level: 1, next_probability: 0.1 },
    },
    module: {
      "quality-module": { category: "quality", effect: { quality: 0.1, speed: -0.05 } },
      "speed-module": { category: "speed", effect: { speed: 0.2, quality: -0.1 } },
    },
    "assembling-machine": {
      refinery: {
        crafting_categories: ["crafting"],
        // base quality 0.5 capped at 0.2 on the 2.0 scale
        effect_receiver: { base_effect: { quality: 0.5 }, quality_limits: { high: 0.2 } },
      },
    },
  };
  const metaValue = (db: Database.Database, key: string) =>
    db.prepare(`SELECT value FROM meta WHERE key = ?`).pluck().get(key);

  it("keeps a 2.1 dump on the 2.1 scale even when normal has no chain_probability", () => {
    // a mod set that drops chain_probability and relies on the default
    const db = runImport(
      {
        quality: {
          normal: { level: 0, next: "uncommon", next_probability: 1 },
          uncommon: { level: 1, next_probability: 1 },
        },
        module: { "quality-module": { category: "quality", effect: { quality: 0.01 } } },
      },
      "2.1.24",
    );
    expect(
      all(db, `SELECT name, next_probability, chain_probability FROM qualities ORDER BY level`),
    ).toEqual([
      { name: "normal", next_probability: 1, chain_probability: 0.1 },
      { name: "uncommon", next_probability: 1, chain_probability: 0.1 },
    ]);
    expect(db.prepare(`SELECT eff_quality FROM modules`).pluck().get()).toBe(0.01);
    expect(metaValue(db, "quality_effect_step")).toBe("0.0001");
    expect(metaValue(db, "quality_scale_basis")).toBe("base 2.1.24");
    expect(metaValue(db, "factorio_version")).toBe("2.1.24");
    db.close();
  });

  it("rescales a 2.0 dump's quality values to the 2.1 scale", () => {
    const db = runImport(DUMP_2_0, "2.0.76");
    expect(
      all(db, `SELECT name, next_probability, chain_probability FROM qualities ORDER BY level`),
    ).toEqual([
      { name: "normal", next_probability: 1, chain_probability: 0.1 },
      { name: "uncommon", next_probability: 1, chain_probability: 0.1 },
    ]);
    const modules = all(db, `SELECT name, eff_quality FROM modules ORDER BY name`) as {
      eff_quality: number;
    }[];
    expect(modules.map((m) => m.eff_quality)).toEqual([
      expect.closeTo(0.01, 12),
      expect.closeTo(-0.01, 12),
    ]);
    const rx = JSON.parse(
      db
        .prepare(`SELECT effect_receiver FROM crafting_machines WHERE name = 'refinery'`)
        .pluck()
        .get() as string,
    );
    // the cap converts with the effect; the unset low bound keeps its 2.1 default
    expect(rx.baseEffect.quality).toBeCloseTo(0.05, 12);
    expect(rx.limits.quality.high).toBeCloseTo(0.02, 12);
    expect(rx.limits.quality.low).toBe(0);
    expect(rx.limits.speed).toEqual({ low: -0.8, high: 1000 });
    expect(metaValue(db, "quality_effect_step")).toBe("0.001");
    expect(metaValue(db, "quality_scale_basis")).toBe("base 2.0.76");
    db.close();
  });

  it("falls back to normal.chain_probability when the base version is unknown", () => {
    const db = runImport(DUMP_2_0);
    expect(
      db.prepare(`SELECT eff_quality FROM modules WHERE name = 'quality-module'`).pluck().get(),
    ).toBeCloseTo(0.01, 12);
    expect(metaValue(db, "quality_scale_basis")).toBe(
      "base version unknown; normal.chain_probability check",
    );
    expect(metaValue(db, "factorio_version")).toBe("unknown");
    db.close();
  });
});

describe("importFactorioDump — recipe quality and effect flags (#265)", () => {
  it("stores allow_* flags and can_set_quality with the engine defaults", () => {
    const item = (name: string, extra = {}) => ({ type: "item", name, amount: 1, ...extra });
    const fluid = (name: string) => ({ type: "fluid", name, amount: 10 });
    const db = runImport({
      recipe: {
        gear: { ingredients: [item("iron-plate")], results: [] },
        legacy: { ingredients: [["iron-plate", 2]], results: [] },
        "fluid-only": { ingredients: [fluid("water")], allow_speed: false, results: [] },
        mixed: { ingredients: [fluid("water"), item("iron-plate")], results: [] },
        // space-age's space platform foundation pins its ingredient to normal
        pinned: {
          ingredients: [item("steel-plate", { quality_min: "normal", quality_max: "normal" })],
          allow_consumption: false,
          allow_pollution: false,
          results: [],
        },
        empty: { ingredients: [], results: [] },
        param: { parameter: true, results: [] },
        forced: { ingredients: [fluid("water")], can_set_quality: true, results: [] },
      },
    });
    expect(
      db
        .prepare(
          `SELECT name, can_set_quality q, allow_speed s, allow_consumption c, allow_pollution p FROM recipes WHERE kind = 'real' ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "empty", q: 0, s: 1, c: 1, p: 1 },
      { name: "fluid-only", q: 0, s: 0, c: 1, p: 1 },
      { name: "forced", q: 1, s: 1, c: 1, p: 1 },
      { name: "gear", q: 1, s: 1, c: 1, p: 1 },
      { name: "legacy", q: 1, s: 1, c: 1, p: 1 },
      { name: "mixed", q: 1, s: 1, c: 1, p: 1 },
      { name: "param", q: 1, s: 1, c: 1, p: 1 },
      { name: "pinned", q: 0, s: 1, c: 0, p: 0 },
    ]);
    db.close();
  });

  it("leaves synthetic recipes at normal", () => {
    const db = runImport({
      "mining-drill": { drill: { resource_categories: ["basic-solid"] } },
      resource: { ore: { minable: { result: "ore" } } },
    });
    const synthetic = db
      .prepare(`SELECT DISTINCT can_set_quality FROM recipes WHERE kind != 'real'`)
      .pluck()
      .all();
    expect(synthetic).toEqual([0]);
    db.close();
  });
});

describe("importFactorioDump — entity quality fields (#265)", () => {
  it("stores the quality flags and per-quality overrides machines opt into", () => {
    const db = runImport({
      "assembling-machine": {
        tuned: {
          crafting_categories: ["crafting"],
          quality_affects_module_slots: true,
          quality_affects_energy_usage: true,
          crafting_speed_quality_multiplier: { uncommon: 1.5 },
          energy_usage_quality_multiplier: { uncommon: 0.9 },
          module_slots_quality_bonus: { uncommon: 2 },
          effect_receiver: { base_effect: { quality: 0.1 }, quality_limits: { low: -1 } },
        },
        plain: { crafting_categories: ["crafting"] },
      },
      "mining-drill": {
        drill: { resource_categories: ["basic-solid"], quality_affects_module_slots: true },
      },
      beacon: {
        // base/prototypes/entity/entities.lua: the vanilla beacon
        beacon: { distribution_effectivity_bonus_per_quality_level: 0.2 },
        plain: {},
      },
      lab: {
        lab: { inputs: [], quality_affects_module_slots: true, uses_quality_drain_modifier: true },
        plain: { inputs: [] },
      },
    });
    const machine = (name: string) =>
      db
        .prepare(
          `SELECT quality_affects_module_slots, quality_affects_energy_usage, crafting_speed_quality_multiplier, energy_usage_quality_multiplier, module_slots_quality_bonus FROM crafting_machines WHERE name = ?`,
        )
        .get(name);
    expect(machine("tuned")).toEqual({
      quality_affects_module_slots: 1,
      quality_affects_energy_usage: 1,
      crafting_speed_quality_multiplier: '{"uncommon":1.5}',
      energy_usage_quality_multiplier: '{"uncommon":0.9}',
      module_slots_quality_bonus: '{"uncommon":2}',
    });
    expect(machine("plain")).toEqual({
      quality_affects_module_slots: 0,
      quality_affects_energy_usage: 0,
      crafting_speed_quality_multiplier: null,
      energy_usage_quality_multiplier: null,
      module_slots_quality_bonus: null,
    });
    const rx = JSON.parse(
      db
        .prepare(`SELECT effect_receiver FROM crafting_machines WHERE name = 'tuned'`)
        .pluck()
        .get() as string,
    );
    expect(rx.baseEffect.quality).toBe(0.1);
    expect(rx.limits.quality).toEqual({ low: -1, high: 1000 });

    const rows = (sql: string) => db.prepare(sql).all();
    expect(rows(`SELECT name, quality_affects_module_slots q FROM mining_drills`)).toEqual([
      { name: "drill", q: 1 },
    ]);
    expect(
      rows(
        `SELECT name, distribution_effectivity_bonus_per_quality_level b, quality_affects_module_slots q FROM beacons ORDER BY name`,
      ),
    ).toEqual([
      { name: "beacon", b: 0.2, q: 0 },
      { name: "plain", b: 0, q: 0 },
    ]);
    expect(
      rows(
        `SELECT name, quality_affects_module_slots q, uses_quality_drain_modifier d FROM labs ORDER BY name`,
      ),
    ).toEqual([
      { name: "lab", q: 1, d: 1 },
      { name: "plain", q: 0, d: 0 },
    ]);
    db.close();
  });
});
