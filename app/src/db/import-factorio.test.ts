import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
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
const runImport = (raw: Record<string, unknown>) => {
  const dumpPath = join(dumpDir, "data-raw-dump.json");
  writeFileSync(dumpPath, JSON.stringify(raw));
  importFactorioDump({ dumpPath, dbUrl: fx.file });
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
