/**
 * computeBlock with quality (#266), on a fixture seeded from Factorio 2.1's own
 * data: base's iron gear wheel and assembling machine 3, the quality mod's
 * qualities and quality module 3 (`quality/prototypes/quality.lua`,
 * `item.lua`), and the recycler mod's recycler and generated gear recycling
 * recipe (`recycler/data.lua`, `recycling.lua`). Only uncommon and rare are
 * unlocked: epic and legendary need a pack the research horizon doesn't have,
 * so upgrade chances past rare land on rare.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "../db/index.server.ts";
import { qualityRow } from "../db/quality-import.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { boundaryFlows, computeBlock, goalFlows, machineReqs } from "./block-compute.server.ts";

const QUALITIES: [string, Record<string, unknown>][] = [
  ["normal", { level: 0, next: "uncommon", next_probability: 1, chain_probability: 0.1 }],
  ["uncommon", { level: 1, next: "rare", next_probability: 1, chain_probability: 0.1 }],
  ["rare", { level: 2, next: "epic", next_probability: 1, chain_probability: 0.1 }],
  ["epic", { level: 3, next: "legendary", next_probability: 1, chain_probability: 0.1 }],
  ["legendary", { level: 5 }],
];

let fx: TestDb;

beforeEach(async () => {
  fx = await makeTestDb();
  fx.db.exec(`
    INSERT INTO items (name, display) VALUES
      ('iron-plate','Iron plate'),('iron-gear-wheel','Iron gear wheel'),
      ('quality-module-3','Quality module 3');
    INSERT INTO recipes
      (name, display, kind, category, energy_required, allow_productivity, allow_quality,
       can_set_quality, enabled, hidden)
      VALUES
      ('iron-gear-wheel','Iron gear wheel','real','crafting',0.5,1,1,1,1,0),
      ('iron-gear-wheel-recycling','Iron gear wheel recycling','real','recycling',0.03125,0,1,1,1,1);
    INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES
      ('iron-gear-wheel',0,'item','iron-plate',2),
      ('iron-gear-wheel-recycling',0,'item','iron-gear-wheel',1);
    INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
      ('iron-gear-wheel',0,'item','iron-gear-wheel',1),
      ('iron-gear-wheel-recycling',0,'item','iron-plate',0.5);
    INSERT INTO crafting_machines
      (name, kind, crafting_speed, module_slots, energy_usage_w, energy_source, allowed_effects)
      VALUES
      ('assembling-machine-3','assembling-machine',1.25,4,375000,'electric',
       '["consumption","speed","productivity","pollution","quality"]'),
      ('recycler','furnace',0.5,4,180000,'electric',
       '["consumption","speed","pollution","quality"]');
    INSERT INTO machine_categories (machine, category) VALUES
      ('assembling-machine-3','crafting'),('recycler','recycling');
    INSERT INTO modules
      (name, category, hidden, eff_speed, eff_productivity, eff_consumption, eff_pollution,
       eff_quality, quality_quality_multiplier)
      VALUES ('quality-module-3','quality',0,-0.05,0,0,0,0.025,1);
    INSERT INTO tech_quality_unlocks (technology, quality) VALUES
      ('epic-quality','epic'),('legendary-quality','legendary');
    INSERT INTO tech_ingredients (technology, name, amount) VALUES
      ('epic-quality','space-science-pack',1),('legendary-quality','space-science-pack',1);
    INSERT INTO meta (key, value) VALUES
      ('quality_effect_step','0.0001'),('research_mode','now'),('available_science_packs','[]');
  `);
  const insert = fx.db.prepare(
    `INSERT INTO qualities (name, display, level, next, next_probability, chain_probability,
       module_quality_multiplier, crafting_machine_speed_multiplier)
     VALUES (@name, @display, @level, @next, @next_probability, @chain_probability,
       @module_quality_multiplier, @crafting_machine_speed_multiplier)`,
  );
  for (const [name, raw] of QUALITIES) {
    const row = qualityRow(name, raw, name[0].toUpperCase() + name.slice(1), false);
    insert.run({
      name: row.name,
      display: row.display,
      level: row.level,
      next: row.next,
      next_probability: row.next_probability,
      chain_probability: row.chain_probability,
      module_quality_multiplier: row.module_quality_multiplier,
      crafting_machine_speed_multiplier: row.crafting_machine_speed_multiplier,
    });
  }
  fx.db.close();
  switchDatabase(fx.file);
});

afterEach(() => fx.cleanup());

const quality4 = Array(4).fill("quality-module-3");

describe("computeBlock with quality", () => {
  it("solves a craft-and-recycle loop to rare gears", async () => {
    const doc = {
      goals: [{ name: "iron-gear-wheel", rate: 1, quality: "rare" }],
      recipes: ["iron-gear-wheel", "iron-gear-wheel-recycling"],
      machines: {
        "iron-gear-wheel": "assembling-machine-3",
        "iron-gear-wheel-recycling": "recycler",
      },
      modules: { "iron-gear-wheel": quality4, "iron-gear-wheel-recycling": quality4 },
      rowQuality: {
        "iron-gear-wheel": { min: "normal", max: "rare" },
        "iron-gear-wheel-recycling": { min: "normal", max: "uncommon" },
      },
      made: ["iron-plate@uncommon", "iron-plate@rare"],
      pins: [
        { kind: "drain" as const, recipe: "iron-gear-wheel-recycling", item: "iron-gear-wheel" },
        {
          kind: "drain" as const,
          recipe: "iron-gear-wheel-recycling",
          item: "iron-gear-wheel",
          quality: "uncommon",
        },
      ],
    };
    const r = await computeBlock(doc);
    expect(r.status).toBe("solved");

    // the same steady state solver/quality.test.ts derives by hand (Q = 0.1)
    const g1PerG0 = 0.081 / 1.595;
    const g2PerG0 = (0.009 + 0.045 * g1PerG0) / 2;
    const g0 = 1 / (0.01 + 0.1 * g1PerG0 + g2PerG0);
    const gear = r.rows.find((row) => row.recipe === "iron-gear-wheel")!;
    expect(gear.qualityRates?.map((q) => q.quality)).toEqual([null, "uncommon", "rare"]);
    expect(gear.qualityRates?.[0].rate).toBeCloseTo(g0, 4);
    expect(gear.qualityRates?.[2].rate).toBeCloseTo(g2PerG0 * g0, 4);
    expect(gear.rate).toBeCloseTo(g0 * (1 + g1PerG0 + g2PerG0), 4);
    expect(gear.effects.quality).toBeCloseTo(0.1);
    // one machine count per row: 0.5 s per craft at 1.25 × (1 − 4 × 5%) speed
    expect(gear.machine?.count).toBeCloseTo(gear.rate * 0.5, 4);

    const flows = boundaryFlows(goalFlows(doc), r);
    expect(flows.find((f) => f.role === "primary")).toEqual({
      item: "iron-gear-wheel",
      kind: "item",
      role: "primary",
      rate: 1,
      quality: "rare",
    });
    const plates = flows.filter((f) => f.item === "iron-plate");
    expect(plates).toHaveLength(1);
    expect(plates[0].role).toBe("import");
    expect("quality" in plates[0]).toBe(false); // normal stays bare
    expect(plates[0].rate).toBeCloseTo(1.595 * g0, 3);
    expect(flows.filter((f) => f.role === "byproduct" && f.kind === "item")).toEqual([]);
  });

  it("scales a legendary machine and modules and exports the upgraded share", async () => {
    const doc = {
      goals: [{ name: "iron-gear-wheel", rate: 1 }],
      recipes: ["iron-gear-wheel"],
      machines: { "iron-gear-wheel": "assembling-machine-3" },
      modules: { "iron-gear-wheel": quality4 },
      rowQuality: { "iron-gear-wheel": { machine: "legendary", modules: "legendary" } },
    };
    const r = await computeBlock(doc);
    expect(r.status).toBe("solved");
    const row = r.rows[0];
    // legendary quality module 3: 0.025 × 2.5 = 6.25%, four of them = 25%
    expect(row.effects.quality).toBeCloseTo(0.25);
    // normal 0.75, uncommon 0.225, rare 0.025 (epic and legendary are locked)
    expect(row.rate).toBeCloseTo(1 / 0.75, 6);
    expect(row.machine?.craftingSpeed).toBeCloseTo(3.125); // 1.25 × 2.5
    expect(row.machine?.count).toBeCloseTo((row.rate * 0.5) / (3.125 * 0.8), 6);
    expect(machineReqs(r.rows)).toEqual([
      {
        machine: "assembling-machine-3",
        recipe: "iron-gear-wheel",
        count: row.machine!.count,
        quality: "legendary",
      },
    ]);

    const byproducts = boundaryFlows(goalFlows(doc), r).filter((f) => f.role === "byproduct");
    expect(byproducts.map((f) => [f.item, "quality" in f ? f.quality : null])).toEqual([
      ["iron-gear-wheel", "rare"],
      ["iron-gear-wheel", "uncommon"],
    ]);
    expect(byproducts[0].rate).toBeCloseTo(0.025 / 0.75, 6);
    expect(byproducts[1].rate).toBeCloseTo(0.225 / 0.75, 6);
    expect(r.display["iron-gear-wheel@uncommon"]).toBe("Iron gear wheel (Uncommon)");
  });
});
