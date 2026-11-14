import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { qualityRow } from "../db/quality-import.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { switchDatabase } from "../db/index.server.ts";
import {
  ensureScienceBlock,
  labOptions,
  ratesForTechIn,
  saveScienceBank,
  scienceBlock,
  solveScienceBank,
  techCosts,
} from "./science-block.server.ts";

let fx: TestDb;
beforeEach(async () => {
  fx = await makeTestDb();
  fx.db.exec(`
    INSERT INTO labs (name, display, researching_speed, module_slots, energy_usage_w,
                      allowed_effects, allowed_module_categories, inputs, hidden)
    VALUES ('lab','Lab',1,0,60000,'["consumption","productivity"]','["vatbrain"]',
            '["automation-science-pack","logistic-science-pack","py-science-pack-1"]',0),
           ('biolab','Biolab',3,4,120000,NULL,NULL,'["automation-science-pack"]',0),
           ('ee-super-lab','Super lab',100,10,1,NULL,NULL,'["automation-science-pack"]',0),
           ('secret-lab','Secret',1,0,1,NULL,NULL,'[]',1);
    INSERT INTO technologies (name, display, unit_count, unit_time) VALUES
      ('silver-mk01','Silver MK01',175,60),
      ('steam-power','Steam power',NULL,NULL);
    INSERT INTO tech_ingredients (technology, name, amount) VALUES
      ('silver-mk01','automation-science-pack',3),
      ('silver-mk01','logistic-science-pack',1),
      ('silver-mk01','py-science-pack-1',2);
  `);
  fx.db.close();
  switchDatabase(fx.file);
});
afterEach(() => fx.cleanup());

describe("labOptions", () => {
  it("offers every visible lab with its own prototype figures", () => {
    // slowest first; a hidden lab and Editor Extensions creative content drop out
    expect(labOptions().map((l) => l.name)).toEqual(["lab", "biolab"]);
    expect(labOptions()[1]).toMatchObject({ researchingSpeed: 3, moduleSlots: 4 });
  });
});

describe("techCosts", () => {
  it("lists technologies that cost science and skips trigger ones", () => {
    const costs = techCosts();
    expect(costs.map((t) => t.name)).toEqual(["silver-mk01"]);
    expect(costs[0]!.ratio).toEqual({
      "automation-science-pack": 3,
      "logistic-science-pack": 1,
      "py-science-pack-1": 2,
    });
  });
});

describe("ratesForTechIn", () => {
  it("turns a technology and a duration in minutes into rates and the pool scalar", () => {
    const r = ratesForTechIn("silver-mk01", 30)!;
    const units = 175 / (30 * 60);
    expect(r.packs["automation-science-pack"]).toBeCloseTo(units * 3, 9);
    expect(r.labSecondsPerPack).toBeCloseTo(10, 9); // 60s over 3+1+2 packs
  });
  it("returns null for an unknown or trigger technology", () => {
    expect(ratesForTechIn("steam-power", 10)).toBeNull();
    expect(ratesForTechIn("nope", 10)).toBeNull();
  });
});

describe("the science block is a singleton", () => {
  it("creates one, then returns the same one", () => {
    const first = ensureScienceBlock();
    expect(first.created).toBe(true);
    const second = ensureScienceBlock();
    expect(second).toEqual({ id: first.id, created: false });
    expect(scienceBlock()?.id).toBe(first.id);
  });

  it("starts empty on the first available lab", () => {
    ensureScienceBlock();
    expect(scienceBlock()?.bank).toMatchObject({ lab: "lab", packs: {} });
  });

  it("round-trips a saved bank and solves it", () => {
    const { id } = ensureScienceBlock();
    const derived = ratesForTechIn("silver-mk01", 30)!;
    saveScienceBank(id, {
      lab: "lab",
      packs: derived.packs,
      labSecondsPerPack: derived.labSecondsPerPack,
    });
    const stored = scienceBlock()!;
    expect(stored.bank.packs).toEqual(derived.packs);
    // 175 units × 60 s of lab time, finished in 30 min → 5.83 labs
    const result = solveScienceBank(stored.bank)!;
    expect(result.labs).toBeCloseTo((175 * 60) / (30 * 60), 6);
    expect(result.totalPowerW).toBeCloseTo(60_000 * result.labs, 3);
  });

  it("returns null when the chosen lab is gone", () => {
    expect(solveScienceBank({ lab: "vanished", packs: {}, labSecondsPerPack: 60 })).toBeNull();
  });
});

describe("quality in the science bank (#266)", () => {
  // Factorio 2.1's quality mod: rare is level 2, so a rare pack lasts
  // tool_durability 1 + 2 = 3 times as long and a rare lab researches at
  // default_multiplier 1 + 0.3 × 2 = 1.6; a lab with
  // uses_quality_drain_modifier drains rare packs at 98/100.
  beforeEach(() => {
    const raw = new Database(fx.file);
    const insert = raw.prepare(
      `INSERT INTO qualities (name, level, next, next_probability, chain_probability,
         lab_research_speed_multiplier, science_pack_drain_multiplier, tool_durability_multiplier)
       VALUES (@name, @level, @next, @next_probability, @chain_probability,
         @lab_research_speed_multiplier, @science_pack_drain_multiplier, @tool_durability_multiplier)`,
    );
    for (const [name, q] of [
      ["normal", { level: 0, next: "uncommon", next_probability: 1, chain_probability: 0.1 }],
      [
        "uncommon",
        { level: 1, next: "rare", next_probability: 1, science_pack_drain_multiplier: 0.99 },
      ],
      ["rare", { level: 2, next_probability: 1, science_pack_drain_multiplier: 0.98 }],
    ] as const) {
      const row = qualityRow(name, q, null, false);
      insert.run({
        name,
        level: row.level,
        next: row.next,
        next_probability: row.next_probability,
        chain_probability: row.chain_probability,
        lab_research_speed_multiplier: row.lab_research_speed_multiplier,
        science_pack_drain_multiplier: row.science_pack_drain_multiplier,
        tool_durability_multiplier: row.tool_durability_multiplier,
      });
    }
    raw.prepare(`UPDATE labs SET uses_quality_drain_modifier = 1 WHERE name = 'biolab'`).run();
    raw.close();
  });

  it("counts a rare pack as three normal ones and speeds up a rare lab", () => {
    const normalLab = solveScienceBank({
      lab: "lab",
      packs: { "automation-science-pack@rare": 1 },
      labSecondsPerPack: 60,
    })!;
    expect(normalLab.unsupported).toEqual([]);
    expect(normalLab.labs).toBeCloseTo(60, 6); // the work is the same
    expect(normalLab.packDemand["automation-science-pack@rare"]).toBeCloseTo(1 / 3, 9);

    const rareBiolab = solveScienceBank({
      lab: "biolab",
      labQuality: "rare",
      packs: { "automation-science-pack@rare": 1 },
      labSecondsPerPack: 60,
    })!;
    expect(rareBiolab.labs).toBeCloseTo(60 / (3 * 1.6), 6);
    expect(rareBiolab.packDemand["automation-science-pack@rare"]).toBeCloseTo(0.98 / 3, 9);
    expect(rareBiolab.qualityCapped).toBeUndefined();
  });

  it("plans a lab quality the research horizon hasn't unlocked at the best unlocked one", () => {
    // rare needs a pack the horizon doesn't have, so uncommon is the top
    const raw = new Database(fx.file);
    raw.exec(`
      INSERT INTO tech_quality_unlocks (technology, quality) VALUES ('rare-quality','rare');
      INSERT INTO tech_ingredients (technology, name, amount)
        VALUES ('rare-quality','space-science-pack',1);
      INSERT INTO meta (key, value) VALUES ('research_mode','now'),('available_science_packs','[]');
    `);
    raw.close();
    const result = solveScienceBank({
      lab: "biolab",
      labQuality: "rare",
      packs: { "automation-science-pack": 1 },
      labSecondsPerPack: 60,
    })!;
    expect(result.qualityCapped).toBe(true);
    expect(result.labs).toBeCloseTo(60 / (3 * 1.3), 6); // uncommon: 1 + 0.3
    expect(result.packDemand["automation-science-pack"]).toBeCloseTo(0.99, 9);
  });
});
