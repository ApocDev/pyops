import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "./index.ts";
import {
  getResearchHorizon,
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
