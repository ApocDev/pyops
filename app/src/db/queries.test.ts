import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { db, switchDatabase } from "./index.ts";
import {
  blockMissingRefs,
  blockReferenceFingerprint,
  getResearchHorizon,
  goodExists,
  goodGraphCounts,
  machineSufficiency,
  setBuiltMachines,
  setResearchHorizon,
} from "./queries.ts";
import { type TestDb, makeTestDb } from "./test-helpers.ts";

let fx: TestDb;

beforeEach(async () => {
  fx = await makeTestDb();
  // seed reference data through the raw handle, then hand the file to the query
  // layer (its own connection) so there's a single writer at a time
  fx.db.exec(`
    INSERT INTO recipes (name, kind, hidden) VALUES
      ('smelt-plate','real',0),
      ('make-gear','real',0),
      ('make-circuit','real',0),
      ('hidden-sink','real',1);
    INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
      ('smelt-plate',0,'item','plate',1);
    INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES
      ('make-gear',0,'item','plate',2),
      ('make-circuit',0,'item','plate',1),
      ('hidden-sink',0,'item','plate',1);

    INSERT INTO items (name, display) VALUES ('plate','Plate'),('gear','Gear');

    INSERT INTO crafting_machines (name, kind, crafting_speed) VALUES ('furnace','furnace',1);
    INSERT INTO blocks (id, name, data) VALUES (1,'smelting','{}');
    INSERT INTO block_machines (block_id, machine, recipe, count) VALUES (1,'furnace','smelt-plate',10);
  `);
  fx.db.close();
  switchDatabase(fx.file);
});

afterEach(() => fx.cleanup());

describe("goodGraphCounts", () => {
  it("counts distinct producing and consuming recipes, ignoring hidden ones", () => {
    const c = goodGraphCounts("plate");
    expect(c.producers).toBe(1); // smelt-plate
    expect(c.consumers).toBe(2); // make-gear + make-circuit (hidden-sink excluded)
  });

  it("returns zeros for an unknown good", () => {
    expect(goodGraphCounts("nonexistent")).toEqual({ producers: 0, consumers: 0 });
  });
});

describe("setBuiltMachines + machineSufficiency", () => {
  it("records built counts and computes the per-recipe shortfall", () => {
    const res = setBuiltMachines([{ machine: "furnace", recipe: "smelt-plate", count: 7 }]);
    expect(res).toMatchObject({ applied: 1, total: 7, changed: true });

    const suff = machineSufficiency();
    const furnace = suff.find((s) => s.machine === "furnace")!;
    expect(furnace.requiredTotal).toBe(10);
    expect(furnace.builtTotal).toBe(7);
    expect(furnace.recipeAware).toBe(true);
    expect(furnace.short).toBe(3); // ceil(10 − 7)
  });

  it("merges duplicate (machine,recipe) pairs and drops non-positive counts", () => {
    const res = setBuiltMachines([
      { machine: "furnace", recipe: "smelt-plate", count: 3 },
      { machine: "furnace", recipe: "smelt-plate", count: 4 },
      { machine: "furnace", recipe: "smelt-plate", count: 0 },
    ]);
    expect(res.applied).toBe(1); // merged to one row
    expect(res.total).toBe(7); // 3 + 4
  });

  it("replaces the snapshot on each call (authoritative, not additive)", () => {
    setBuiltMachines([{ machine: "furnace", recipe: "smelt-plate", count: 5 }]);
    const second = setBuiltMachines([{ machine: "furnace", recipe: "smelt-plate", count: 2 }]);
    expect(second.total).toBe(2); // not 7
    expect(machineSufficiency().find((s) => s.machine === "furnace")!.builtTotal).toBe(2);
  });
});

describe("research horizon round-trip", () => {
  it("persists and reloads the researched-tech set in 'now' mode", () => {
    setResearchHorizon({ mode: "now", researched: ["automation", "logistics"] });
    const h = getResearchHorizon();
    expect(h.mode).toBe("now");
    expect([...h.researched].sort()).toEqual(["automation", "logistics"]);
  });
});

describe("drift detection: missing refs + reference fingerprint", () => {
  it("goodExists covers items (and rejects unknowns)", () => {
    expect(goodExists("plate")).toBe(true);
    expect(goodExists("vanished-good")).toBe(false);
  });

  it("blockMissingRefs is empty when every recipe and goal good exists", () => {
    const missing = blockMissingRefs({
      goals: [{ name: "plate", rate: 1 }],
      recipes: ["smelt-plate", "make-gear"],
    });
    expect(missing).toEqual({ recipes: [], goods: [] });
  });

  it("flags recipes and goal goods that no longer exist (deduped)", () => {
    const missing = blockMissingRefs({
      goals: [
        { name: "ghost-good", rate: 1 },
        { name: "plate", rate: 2 }, // still exists
        { name: "ghost-good", rate: 3 }, // duplicate of the first goal
      ],
      recipes: ["smelt-plate", "gone-recipe", "gone-recipe"],
    });
    expect(missing.recipes).toEqual(["gone-recipe"]);
    expect(missing.goods).toEqual(["ghost-good"]);
  });

  it("fingerprint is stable for the same data but changes when a recipe changes", () => {
    const data = { goals: [{ name: "plate", rate: 1 }], recipes: ["smelt-plate", "make-gear"] };
    const fp1 = blockReferenceFingerprint(data);
    // recipe order in the doc must not matter (it's normalized)
    expect(blockReferenceFingerprint({ ...data, recipes: ["make-gear", "smelt-plate"] })).toBe(fp1);

    // an in-place change to a referenced recipe's products must shift the fingerprint
    db.run(sql`UPDATE recipe_products SET amount = 2 WHERE recipe = 'smelt-plate'`);
    expect(blockReferenceFingerprint(data)).not.toBe(fp1);
  });

  it("fingerprint differs when a referenced recipe goes missing", () => {
    const present = blockReferenceFingerprint({
      goals: [{ name: "plate", rate: 1 }],
      recipes: ["smelt-plate"],
    });
    const gone = blockReferenceFingerprint({
      goals: [{ name: "plate", rate: 1 }],
      recipes: ["gone-recipe"],
    });
    expect(gone).not.toBe(present);
  });
});
