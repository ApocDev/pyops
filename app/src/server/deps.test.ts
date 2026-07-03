import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "../db/index.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { depsSearch, depsTree } from "./deps.server.ts";

/**
 * Dependency explorer traversal (#100) over a small fixture chain:
 *
 *   ore ──smelt-plate──▶ plate ──make-gear──▶ gear
 *                        scrap ──alt-gear───▶ gear   (second producer = OR)
 *   loop-a ◀─recycle-a── loop-b ◀─recycle-b── loop-a (a 2-cycle)
 *
 * plus a hidden recipe and a barrel-category recipe that must never appear.
 */
let fx: TestDb;

beforeEach(async () => {
  fx = await makeTestDb();
  fx.db.exec(`
    INSERT INTO items (name, display) VALUES
      ('ore','Ore'),('plate','Plate'),('gear','Gear'),('scrap','Scrap'),
      ('loop-a','Loop A'),('loop-b','Loop B'),('trinket','Trinket'),('sp1','Science pack 1');
    INSERT INTO fluids (name, display) VALUES ('water','Water');

    INSERT INTO recipes (name, display, kind, hidden, enabled) VALUES
      ('smelt-plate','Smelt plate','real',0,1),
      ('make-gear','Make gear','real',0,0),
      ('alt-gear','Alt gear','real',0,1),
      ('hidden-gear','Hidden gear','real',1,1),
      ('recycle-a','Recycle A','real',0,1),
      ('recycle-b','Recycle B','real',0,1);
    INSERT INTO recipes (name, display, kind, category, hidden, enabled) VALUES
      ('fill-water-barrel','Fill water barrel','real','py-barreling',0,1);

    INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES
      ('smelt-plate',0,'item','ore',1),
      ('smelt-plate',1,'fluid','water',5),
      ('make-gear',0,'item','plate',2),
      ('alt-gear',0,'item','scrap',4),
      ('hidden-gear',0,'item','ore',1),
      ('recycle-a',0,'item','loop-b',1),
      ('recycle-b',0,'item','loop-a',1),
      ('fill-water-barrel',0,'fluid','water',50);
    INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
      ('smelt-plate',0,'item','plate',1),
      ('make-gear',0,'item','gear',1),
      ('alt-gear',0,'item','gear',1),
      ('hidden-gear',0,'item','gear',1),
      ('recycle-a',0,'item','loop-a',1),
      ('recycle-b',0,'item','loop-b',1),
      ('fill-water-barrel',0,'item','water-barrel',1);

    -- make-gear is tech-locked behind a science pack we don't have
    INSERT INTO technologies (name, display) VALUES ('tech-gear','Gear tech');
    INSERT INTO tech_unlocks (technology, recipe) VALUES ('tech-gear','make-gear');
    INSERT INTO tech_ingredients (technology, name, amount) VALUES ('tech-gear','sp1',1);
  `);
  fx.db.close();
  switchDatabase(fx.file);
});

afterEach(() => fx.cleanup());

describe("depsTree (requires)", () => {
  it("walks good → producers (OR) → ingredients (AND) down to raw inputs", () => {
    const t = depsTree({ kind: "good", name: "gear", dir: "requires", depth: 10 })!;
    expect(t.root).toBe("g:gear");
    const root = t.nodes["g:gear"];
    expect(root.children.sort()).toEqual(["r:alt-gear", "r:make-gear"]);
    expect(root.childCount).toBe(2); // hidden-gear is not part of the graph
    expect(t.nodes["r:make-gear"].children).toEqual(["g:plate"]);
    expect(t.nodes["g:plate"].children).toEqual(["r:smelt-plate"]);
    expect(t.nodes["r:smelt-plate"].children.sort()).toEqual(["g:ore", "g:water"]);
    // raw inputs: no producers
    expect(t.nodes["g:ore"].childCount).toBe(0);
    expect(t.nodes["g:ore"].closure).toEqual({ goods: 0, recipes: 0 });
    // water is a fluid and the barrel recipe never shows up anywhere
    expect(t.nodes["g:water"].goodKind).toBe("fluid");
    expect(Object.keys(t.nodes).some((k) => k.includes("barrel"))).toBe(false);
    expect(Object.keys(t.nodes)).not.toContain("r:hidden-gear");
  });

  it("reports the transitive closure size per node", () => {
    const t = depsTree({ kind: "good", name: "gear", dir: "requires", depth: 10 })!;
    // goods: plate, scrap, ore, water; recipes: make-gear, alt-gear, smelt-plate
    expect(t.nodes["g:gear"].closure).toEqual({ goods: 4, recipes: 3 });
    expect(t.nodes["g:plate"].closure).toEqual({ goods: 2, recipes: 1 });
  });

  it("annotates tech-locked recipes with availability + unlocking tech", () => {
    const t = depsTree({ kind: "good", name: "gear", dir: "requires", depth: 10 })!;
    const locked = t.nodes["r:make-gear"];
    expect(locked.avail?.research).toBe("needs-research");
    expect(locked.avail?.needs).toEqual(["sp1"]);
    expect(locked.unlockedBy).toEqual(["Gear tech"]);
    expect(t.nodes["r:alt-gear"].avail?.research).toBe("enabled");
    expect(t.nodes["r:alt-gear"].unlockedBy).toEqual([]);
  });

  it("supports a recipe root", () => {
    const t = depsTree({ kind: "recipe", name: "make-gear", dir: "requires", depth: 10 })!;
    expect(t.root).toBe("r:make-gear");
    expect(t.nodes["r:make-gear"].children).toEqual(["g:plate"]);
    expect(t.nodes["r:make-gear"].closure).toEqual({ goods: 3, recipes: 1 });
  });

  it("is cycle-safe: each node appears once and closures terminate", () => {
    const t = depsTree({ kind: "good", name: "loop-a", dir: "requires", depth: 10 })!;
    expect(Object.keys(t.nodes).sort()).toEqual([
      "g:loop-a",
      "g:loop-b",
      "r:recycle-a",
      "r:recycle-b",
    ]);
    // recycle-b's ingredient is loop-a — a back-reference to an existing key
    expect(t.nodes["r:recycle-b"].children).toEqual(["g:loop-a"]);
    expect(t.nodes["g:loop-a"].closure).toEqual({ goods: 1, recipes: 2 });
  });
});

describe("depsTree (requiredBy)", () => {
  it("walks good → consumers → products up to final goods", () => {
    const t = depsTree({ kind: "good", name: "ore", dir: "requiredBy", depth: 10 })!;
    expect(t.nodes["g:ore"].children).toEqual(["r:smelt-plate"]);
    expect(t.nodes["r:smelt-plate"].children).toEqual(["g:plate"]);
    expect(t.nodes["g:plate"].children).toEqual(["r:make-gear"]);
    expect(t.nodes["r:make-gear"].children).toEqual(["g:gear"]);
    expect(t.nodes["g:gear"].childCount).toBe(0); // nothing uses gear
    expect(t.nodes["g:ore"].closure).toEqual({ goods: 2, recipes: 2 });
  });
});

describe("depsTree limits", () => {
  it("truncates at the depth limit and keeps the direct child count", () => {
    // depth 2 edges from gear: recipes at d=1, goods at d=2 — the goods' own
    // producers are beyond the limit
    const t = depsTree({ kind: "good", name: "gear", dir: "requires", depth: 2 })!;
    const plate = t.nodes["g:plate"];
    expect(plate.children).toEqual([]);
    expect(plate.childCount).toBe(1);
    expect(plate.truncated).toBe(true);
    expect(t.nodes).not.toHaveProperty("r:smelt-plate");
  });

  it("stops at the node budget and flags it", () => {
    const full = depsTree({ kind: "good", name: "gear", dir: "requires", depth: 10 })!;
    expect(full.budgetHit).toBe(false); // 8 nodes total — well under the default
    const t = depsTree({ kind: "good", name: "gear", dir: "requires", depth: 10, budget: 4 })!;
    expect(t.budgetHit).toBe(true);
    expect(Object.keys(t.nodes)).toHaveLength(4);
    // alt-gear's ingredient fell past the budget — marked, not silently dropped
    expect(t.nodes["r:alt-gear"].truncated).toBe(true);
    expect(t.nodes["r:alt-gear"].childCount).toBe(1);
  });

  it("returns null for an unknown root and a lone node for an unused good", () => {
    expect(depsTree({ kind: "good", name: "nope", dir: "requires", depth: 4 })).toBeNull();
    expect(depsTree({ kind: "recipe", name: "nope", dir: "requires", depth: 4 })).toBeNull();
    const t = depsTree({ kind: "good", name: "trinket", dir: "requires", depth: 4 })!;
    expect(t.nodes["g:trinket"]).toMatchObject({
      childCount: 0,
      closure: { goods: 0, recipes: 0 },
      display: "Trinket",
    });
  });
});

describe("depsSearch", () => {
  it("finds goods and recipes, hiding hidden and barrel recipes", () => {
    const hits = depsSearch("gear");
    const keys = hits.map((h) => `${h.kind}:${h.name}`);
    expect(keys).toContain("item:gear");
    expect(keys).toContain("recipe:make-gear");
    expect(keys).toContain("recipe:alt-gear");
    expect(keys).not.toContain("recipe:hidden-gear");
    expect(depsSearch("barrel").map((h) => h.name)).not.toContain("fill-water-barrel");
    expect(depsSearch("")).toEqual([]);
  });
});
