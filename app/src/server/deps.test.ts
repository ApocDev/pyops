import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { db, switchDatabase } from "../db/index.server.ts";
import { recipeAvailability, searchAll, setExclusions } from "../db/queries.server.ts";
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

function preparedStatementCount(run: () => void): number {
  const client = db.$client as unknown as { prepare: (source: string) => unknown };
  const prepare = client.prepare.bind(db.$client);
  let count = 0;
  client.prepare = (source) => {
    count++;
    return prepare(source);
  };
  try {
    run();
    return count;
  } finally {
    client.prepare = prepare;
  }
}

beforeEach(async () => {
  fx = await makeTestDb();
  fx.db.exec(`
    INSERT INTO items (name, display) VALUES
      ('ore','Ore'),('plate','Plate'),('gear','Gear'),('scrap','Scrap'),
      ('loop-a','Loop A'),('loop-b','Loop B'),('trinket','Trinket'),
      ('turd-input','TURD input'),('turd-good','TURD good'),('sp1','Science pack 1');
    INSERT INTO fluids (name, display) VALUES ('water','Water');

    INSERT INTO recipes (name, display, kind, hidden, enabled) VALUES
      ('smelt-plate','Smelt plate','real',0,1),
      ('make-gear','Make gear','real',0,0),
      ('alt-gear','Alt gear','real',0,1),
      ('turd-a','TURD A','real',0,0),
      ('turd-b','TURD B','real',0,0),
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
      ('turd-a',0,'item','turd-input',1),
      ('turd-b',0,'item','turd-input',1),
      ('hidden-gear',0,'item','ore',1),
      ('recycle-a',0,'item','loop-b',1),
      ('recycle-b',0,'item','loop-a',1),
      ('fill-water-barrel',0,'fluid','water',50);
    INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
      ('smelt-plate',0,'item','plate',1),
      ('make-gear',0,'item','gear',1),
      ('alt-gear',0,'item','gear',1),
      ('turd-a',0,'item','turd-good',1),
      ('turd-b',0,'item','turd-good',1),
      ('hidden-gear',0,'item','gear',1),
      ('recycle-a',0,'item','loop-a',1),
      ('recycle-b',0,'item','loop-b',1),
      ('fill-water-barrel',0,'item','water-barrel',1);

    -- make-gear is tech-locked behind a science pack we don't have
    INSERT INTO technologies (name, display, is_turd) VALUES
      ('tech-gear','Gear tech',0),
      ('turd-master','TURD master',1),
      ('turd-a-tech','TURD choice A',0),
      ('turd-b-tech','TURD choice B',0);
    INSERT INTO tech_unlocks (technology, recipe) VALUES
      ('tech-gear','make-gear'),
      ('turd-a-tech','turd-a'),
      ('turd-b-tech','turd-b');
    INSERT INTO tech_ingredients (technology, name, amount) VALUES ('tech-gear','sp1',1);
    INSERT INTO tech_prerequisites (technology, prerequisite) VALUES
      ('turd-a-tech','turd-master'),
      ('turd-a-tech','turd-select-turd-a-tech'),
      ('turd-b-tech','turd-master'),
      ('turd-b-tech','turd-select-turd-b-tech');
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

describe("depsTree query shape", () => {
  it("uses a fixed set of bulk reads as the number of recipe nodes grows", () => {
    const smallCount = preparedStatementCount(() => {
      depsTree({ kind: "good", name: "gear", dir: "requires", depth: 10 });
    });

    const recipeValues = Array.from(
      { length: 40 },
      (_, i) => `('bulk-${i}','Bulk ${i}','real',0,1)`,
    ).join(",");
    const ingredientValues = Array.from(
      { length: 40 },
      (_, i) => `('bulk-${i}',0,'item','ore',1)`,
    ).join(",");
    const productValues = Array.from(
      { length: 40 },
      (_, i) => `('bulk-${i}',0,'item','gear',1)`,
    ).join(",");
    db.$client.exec(`
      INSERT INTO recipes (name, display, kind, hidden, enabled) VALUES ${recipeValues};
      INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES ${ingredientValues};
      INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES ${productValues};
    `);

    const largeCount = preparedStatementCount(() => {
      const tree = depsTree({ kind: "good", name: "gear", dir: "requires", depth: 10 });
      expect(Object.keys(tree!.nodes).length).toBeGreaterThan(40);
    });

    expect(largeCount).toBe(smallCount);
    expect(largeCount).toBeLessThanOrEqual(14);
  });
});

describe("depsTree availability parity", () => {
  const expectParity = (root: string, recipe: string, enabled: boolean) => {
    const tree = depsTree({ kind: "good", name: root, dir: "requires", depth: 2 })!;
    const node = tree.nodes[`r:${recipe}`];
    const expected = recipeAvailability(recipe, enabled);
    expect(node.avail).toEqual({
      research: expected.avail.research,
      needs: expected.avail.needs,
      turd: expected.avail.turd,
    });
    expect(node.unlockedBy).toEqual(expected.unlockedBy);
  };

  it("matches the canonical helper for enabled, locked, and researched recipes", () => {
    expectParity("gear", "alt-gear", true);
    expectParity("gear", "make-gear", false);

    db.$client
      .prepare("INSERT INTO meta (key, value) VALUES ('researched_techs', ?)")
      .run(JSON.stringify(["tech-gear"]));
    expectParity("gear", "make-gear", false);
  });

  it("matches TURD pickable, active, and blocked states", () => {
    expectParity("turd-good", "turd-a", false);
    expectParity("turd-good", "turd-b", false);

    db.$client
      .prepare("INSERT INTO turd_selections (master_tech, sub_tech) VALUES (?, ?)")
      .run("turd-master", "turd-a-tech");
    expectParity("turd-good", "turd-a", false);
    expectParity("turd-good", "turd-b", false);
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

  it("uses one exclusion snapshot rather than a metadata read per hit", () => {
    const count = preparedStatementCount(() => {
      expect(depsSearch("gear").length).toBeGreaterThan(0);
    });
    expect(count).toBeLessThanOrEqual(4);
  });

  it("keeps goods search and user-glob exclusions in parity with canonical search", () => {
    db.$client.exec(`
      INSERT INTO items (name, display, subgroup) VALUES
        ('gear-visible','Gear visible','parts'),
        ('gear-excluded','Gear excluded','excluded-tools');
      INSERT INTO recipes (name, display, kind, subgroup, hidden, enabled) VALUES
        ('gear-visible-recipe','Gear visible recipe','real','parts',0,1),
        ('gear-excluded-recipe','Gear excluded recipe','real','excluded-tools',0,1);
    `);
    setExclusions({ globs: ["excluded-*"] });

    const actual = depsSearch("gear");
    expect(actual.filter((hit) => hit.kind !== "recipe")).toEqual(searchAll("gear", 60));
    expect(actual.map((hit) => hit.name)).toContain("gear-visible-recipe");
    expect(actual.map((hit) => hit.name)).not.toContain("gear-excluded-recipe");
  });
});
