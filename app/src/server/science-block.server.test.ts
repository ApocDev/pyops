import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
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
