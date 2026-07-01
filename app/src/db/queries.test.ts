import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { db, switchDatabase } from "./index.ts";
import {
  blockMissingRefs,
  blockReferenceFingerprint,
  buildCost,
  createGroup,
  dataCapabilities,
  deleteGroup,
  getResearchHorizon,
  goodExists,
  goodGraphCounts,
  listBlocks,
  listGroups,
  machineSufficiency,
  setBlockGroup,
  setBuiltMachines,
  setGroupParent,
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

    INSERT INTO items (name, display) VALUES ('plate','Plate'),('gear','Gear'),('drill','Drill'),('steel','Steel');

    -- a building ('drill') with its own construction recipe, for buildCost
    INSERT INTO recipes (name, kind, hidden) VALUES ('make-drill','real',0);
    INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES ('make-drill',0,'item','drill',1);
    INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES
      ('make-drill',0,'item','gear',3),
      ('make-drill',1,'item','steel',2);

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

describe("dataCapabilities", () => {
  it("reports hasTurd false when the dataset has no TURD techs", () => {
    expect(dataCapabilities()).toEqual({ hasTurd: false });
  });

  it("reports hasTurd true once a TURD master tech is present", () => {
    db.run(
      sql`INSERT INTO technologies (name, unit_count, enabled, is_turd) VALUES ('t-master', 1, 1, 1)`,
    );
    expect(dataCapabilities()).toEqual({ hasTurd: true });
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

describe("buildCost", () => {
  it("expands building counts into their construction materials", () => {
    const c = buildCost([{ name: "drill", count: 2.2 }]); // ceil → 3 drills
    expect(c.buildings).toEqual([
      { name: "drill", display: "Drill", count: 3, recipe: "make-drill" },
    ]);
    const mat = new Map(c.materials.map((m) => [m.name, m.amount]));
    expect(mat.get("gear")).toBe(9); // 3 per drill × 3
    expect(mat.get("steel")).toBe(6); // 2 per drill × 3
  });

  it("lists a building with no build recipe but contributes no materials", () => {
    const c = buildCost([{ name: "furnace", count: 1 }]);
    expect(c.buildings).toEqual([{ name: "furnace", display: "furnace", count: 1, recipe: null }]);
    expect(c.materials).toEqual([]);
  });
});

describe("nested folders", () => {
  it("setGroupParent nests folders and rejects cycles", () => {
    const a = createGroup("A");
    const b = createGroup("B");
    const c = createGroup("C");
    expect(setGroupParent(b, a)).toBe(true); // B under A
    expect(setGroupParent(c, b)).toBe(true); // C under B
    expect(setGroupParent(a, c)).toBe(false); // A under C would form A→C→B→A
    expect(setGroupParent(a, a)).toBe(false); // can't parent to self
    const parentOf = new Map(listGroups().map((g) => [g.id, g.parentId]));
    expect(parentOf.get(b)).toBe(a);
    expect(parentOf.get(c)).toBe(b);
    expect(parentOf.get(a)).toBe(null);
  });

  it("deleteGroup moves child folders and blocks up to the parent", () => {
    const parent = createGroup("Parent");
    const mid = createGroup("Mid");
    const leaf = createGroup("Leaf");
    setGroupParent(mid, parent);
    setGroupParent(leaf, mid);
    setBlockGroup(1, mid); // seeded block #1 now lives in Mid
    deleteGroup(mid);
    const groups = listGroups();
    expect(groups.some((g) => g.id === mid)).toBe(false);
    expect(groups.find((g) => g.id === leaf)?.parentId).toBe(parent); // subfolder → grandparent
    expect(listBlocks().find((b) => b.id === 1)?.groupId).toBe(parent); // block → parent
  });
});
