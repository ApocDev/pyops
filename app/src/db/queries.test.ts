import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { db, switchDatabase } from "./index.server.ts";
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
  productivityBonuses,
  recipeCandidates,
  saveBlockRow,
  setBlockGroup,
  setBuiltMachines,
  setGroupParent,
  setResearchHorizon,
} from "./queries.server.ts";
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

  it("listBlocks reports recipe/goal counts for the delete-block confirm", () => {
    const id = saveBlockRow(
      {
        name: "plates",
        iconKind: null,
        iconName: null,
        data: {
          goals: [{ name: "plate", rate: 1 }],
          recipes: ["smelt-plate", "make-gear"],
        },
        electricityW: null,
        dataFingerprint: null,
      },
      null,
    );
    const byId = new Map(listBlocks().map((b) => [b.id, b]));
    expect(byId.get(1)).toMatchObject({ recipeCount: 0, goalCount: 0 }); // seeded '{}' block
    expect(byId.get(id)).toMatchObject({ recipeCount: 2, goalCount: 1 });
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

// Research-driven productivity bonuses (#92). Techs + science costs are real Py
// dump values: mining-productivity-1/-2 cost py-science-pack-1 ×1 + automation ×2
// and grant mining-drill-productivity-bonus +0.1 each; microfilters (logistic ×1 +
// py1 ×2 + automation ×3) grants fawogae-spore +0.15; microfilters-mk02 (py2 ×1 +
// logistic ×2 + py1 ×3 + automation ×6) grants fawogae-spore +0.20.
describe("productivityBonuses (research horizon gated)", () => {
  const seed = () => {
    db.run(sql`
      INSERT INTO tech_productivity_bonuses (technology, recipe, modifier) VALUES
        ('mining-productivity-1', '', 0.1),
        ('mining-productivity-2', '', 0.1),
        ('microfilters', 'fawogae-spore', 0.15),
        ('microfilters-mk02', 'fawogae-spore', 0.2)
    `);
    db.run(sql`
      INSERT INTO tech_ingredients (technology, name, amount) VALUES
        ('mining-productivity-1', 'py-science-pack-1', 1),
        ('mining-productivity-1', 'automation-science-pack', 2),
        ('mining-productivity-2', 'py-science-pack-1', 1),
        ('mining-productivity-2', 'automation-science-pack', 2),
        ('microfilters', 'logistic-science-pack', 1),
        ('microfilters', 'py-science-pack-1', 2),
        ('microfilters', 'automation-science-pack', 3),
        ('microfilters-mk02', 'py-science-pack-2', 1),
        ('microfilters-mk02', 'logistic-science-pack', 2),
        ('microfilters-mk02', 'py-science-pack-1', 3),
        ('microfilters-mk02', 'automation-science-pack', 6)
    `);
  };

  it("FUTURE mode sums every tech's bonus", () => {
    seed();
    setResearchHorizon({ mode: "future" });
    const b = productivityBonuses();
    expect(b.mining).toBeCloseTo(0.2); // two mining-productivity levels
    expect(b.recipes.get("fawogae-spore")).toBeCloseTo(0.35); // both microfilter tiers
  });

  it("NOW mode gates by available science packs (reachable techs count)", () => {
    seed();
    setResearchHorizon({
      mode: "now",
      packs: ["automation-science-pack", "py-science-pack-1"],
      researched: [],
    });
    const b = productivityBonuses();
    // both mining-productivity techs cost only automation + py1 → reached
    expect(b.mining).toBeCloseTo(0.2);
    // microfilters needs logistic science, mk02 needs py2 → neither counts
    expect(b.recipes.has("fawogae-spore")).toBe(false);
  });

  it("NOW mode counts an explicitly researched tech past the pack gate", () => {
    seed();
    setResearchHorizon({ mode: "now", packs: [], researched: ["microfilters"] });
    const b = productivityBonuses();
    expect(b.mining).toBe(0); // neither mining tech researched, no packs
    expect(b.recipes.get("fawogae-spore")).toBeCloseTo(0.15); // microfilters only
  });

  it("returns empty bonuses when the table has no rows", () => {
    setResearchHorizon({ mode: "future" });
    const b = productivityBonuses();
    expect(b.mining).toBe(0);
    expect(b.recipes.size).toBe(0);
  });
});

describe("listBlocks health: sink goals need a consumer, not a producer", () => {
  const save = (name: string, data: Parameters<typeof saveBlockRow>[0]["data"]) =>
    saveBlockRow(
      { name, iconKind: null, iconName: null, data, electricityW: null, dataFingerprint: null },
      null,
    );
  const health = (id: number) => new Map(listBlocks().map((b) => [b.id, b])).get(id)!;

  it("a SINK goal (rate < 0) is satisfied by a CONSUMER in the block", () => {
    // dispose of plate: make-gear consumes it → the sink is met, no warning
    const id = save("dispose", { goals: [{ name: "plate", rate: -1 }], recipes: ["make-gear"] });
    const b = health(id);
    expect(b.unmadeGoals).toEqual([]);
    expect(b.health).toBe("ok");
  });

  it("a SINK goal with no consumer in the block is flagged unmet", () => {
    // smelt-plate PRODUCES plate but nothing consumes it → the sink can't run
    const id = save("no-consumer", {
      goals: [{ name: "plate", rate: -1 }],
      recipes: ["smelt-plate"],
    });
    const b = health(id);
    expect(b.unmadeGoals).toEqual(["plate"]);
    expect(b.health).toBe("warn");
  });

  it("a PRODUCE goal (rate ≥ 0) still needs a producer, not a consumer", () => {
    const ok = save("make", { goals: [{ name: "plate", rate: 1 }], recipes: ["smelt-plate"] });
    const bad = save("consume-only", {
      goals: [{ name: "plate", rate: 1 }],
      recipes: ["make-gear"],
    });
    expect(health(ok).unmadeGoals).toEqual([]);
    expect(health(bad).unmadeGoals).toEqual(["plate"]);
  });
});

describe("recipeCandidates availability: prerequisite-gated techs (empty own cost)", () => {
  const seed = () => {
    db.run(sql`
      INSERT INTO items (name, display) VALUES ('circuit','Circuit')
    `);
    db.run(sql`
      INSERT INTO recipes (name, kind, hidden, enabled) VALUES ('circuit-basic','real',0,0),('circuit-exotic','real',0,0)
    `);
    db.run(sql`
      INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
        ('circuit-basic',0,'item','circuit',1),
        ('circuit-exotic',0,'item','circuit',1)
    `);
    db.run(sql`
      INSERT INTO technologies (name, display) VALUES ('t-basic','Basic'),('t-exotic','Exotic'),('t-prereq','Prereq')
    `);
    db.run(sql`
      INSERT INTO tech_ingredients (technology, name, amount) VALUES
        ('t-basic','automation-science-pack',1),
        ('t-prereq','py-science-pack-1',1)
    `);
    // t-exotic has NO own science cost — it's gated purely through its prerequisite
    db.run(
      sql`INSERT INTO tech_prerequisites (technology, prerequisite) VALUES ('t-exotic','t-prereq')`,
    );
    db.run(sql`
      INSERT INTO tech_unlocks (technology, recipe) VALUES
        ('t-basic','circuit-basic'),
        ('t-exotic','circuit-exotic')
    `);
  };

  it("a tech with empty own cost is gated by its prerequisites, not vacuously reachable", () => {
    seed();
    // the horizon supplies only automation science (the basic tier)
    setResearchHorizon({ mode: "now", packs: ["automation-science-pack"], researched: [] });
    const cands = recipeCandidates("circuit", "produce");
    const basic = cands.find((c) => c.name === "circuit-basic")!;
    const exotic = cands.find((c) => c.name === "circuit-exotic")!;
    // basic (automation only) is available now
    expect(basic.avail.research).toBe("available");
    expect(basic.avail.availableNow).toBe(true);
    // exotic's unlocking tech has an EMPTY own cost but its prereq needs
    // py-science-1 — before the fix [].every() made it vacuously "available"
    expect(exotic.avail.research).toBe("needs-research");
    expect(exotic.avail.availableNow).toBe(false);
    expect(exotic.avail.needs).toContain("py-science-pack-1");
    // so the basic recipe ranks ABOVE the exotic one
    expect(cands.findIndex((c) => c.name === "circuit-basic")).toBeLessThan(
      cands.findIndex((c) => c.name === "circuit-exotic"),
    );
  });

  it("a researched prerequisite is not re-demanded (NOW mode)", () => {
    seed();
    // you produce only automation science, but t-prereq is already researched →
    // t-exotic is now reachable (its remaining frontier costs nothing you lack)
    setResearchHorizon({
      mode: "now",
      packs: ["automation-science-pack"],
      researched: ["t-prereq"],
    });
    const exotic = recipeCandidates("circuit", "produce").find((c) => c.name === "circuit-exotic")!;
    expect(exotic.avail.research).toBe("available");
  });
});
