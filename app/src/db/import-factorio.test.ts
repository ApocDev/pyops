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
