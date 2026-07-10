import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { db, switchDatabase } from "./index.server.ts";
import {
  blockBuildStatus,
  blockMissingRefs,
  blockReferenceFingerprint,
  blocksWithFlows,
  browseDetail,
  buildCost,
  createGroup,
  dataCapabilities,
  deleteGroup,
  getResearchHorizon,
  goodExists,
  goodGraphCounts,
  factoryBlocks,
  listBlocks,
  listGroups,
  logisticsForGood,
  machineSufficiency,
  metaSet,
  modulesFittingMachine,
  modulePickerData,
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

describe("modulePickerData availability", () => {
  const seed = () => {
    db.run(sql`
      INSERT INTO recipes (name, kind, category, energy_required, enabled, hidden) VALUES
        ('plate-recipe','real','crafting',1,1,0),
        ('craft-speed-1','real','crafting',1,1,0),
        ('craft-speed-2','real','crafting',1,0,0),
        ('craft-ee-super-speed','real','crafting',1,1,0),
        ('craft-beacon-1','real','crafting',1,1,0),
        ('craft-beacon-2','real','crafting',1,0,0),
        ('craft-ee-super-beacon','real','crafting',1,1,0)
    `);
    db.run(sql`
      INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
        ('craft-speed-1',0,'item','speed-1',1),
        ('craft-speed-2',0,'item','speed-2',1),
        ('craft-ee-super-speed',0,'item','ee-super-speed-module',1),
        ('craft-beacon-1',0,'item','beacon-1',1),
        ('craft-beacon-2',0,'item','beacon-2',1),
        ('craft-ee-super-beacon',0,'item','ee-super-beacon',1)
    `);
    db.run(sql`
      INSERT INTO technologies (name, display) VALUES ('speed-2-tech','Speed 2'),('beacon-2-tech','Beacon 2')
    `);
    db.run(sql`
      INSERT INTO tech_ingredients (technology, name, amount) VALUES
        ('speed-2-tech','logistic-science-pack',1),
        ('beacon-2-tech','logistic-science-pack',1)
    `);
    db.run(sql`
      INSERT INTO tech_unlocks (technology, recipe) VALUES
        ('speed-2-tech','craft-speed-2'),
        ('beacon-2-tech','craft-beacon-2')
    `);
    db.run(sql`
      INSERT INTO crafting_machines (name, kind, crafting_speed, module_slots) VALUES
        ('assembler','assembling-machine',1,2)
    `);
    db.run(sql`
      INSERT INTO modules (name, display, category, hidden, tier, eff_speed, eff_productivity, eff_consumption) VALUES
        ('speed-1','Speed 1','speed',0,1,0.2,0,0),
        ('speed-2','Speed 2','speed',0,2,0.4,0,0),
        ('ee-super-speed-module','Super speed module','speed',0,99,5,0,0),
        ('creative-speed','Creative speed','speed',0,99,1,0,0)
    `);
    db.run(sql`
      INSERT INTO beacons (name, display, distribution_effectivity, module_slots, hidden) VALUES
        ('beacon-1','Beacon 1',1,2,0),
        ('beacon-2','Beacon 2',1,2,0),
        ('ee-super-beacon','Super beacon',1,2,0),
        ('creative-beacon','Creative beacon',1,2,0)
    `);
  };

  it("marks modules and beacons outside the current horizon as locked", () => {
    seed();
    setResearchHorizon({ mode: "now", packs: [], researched: [] });
    const p = modulePickerData("plate-recipe", "assembler")!;

    expect(Object.fromEntries(p.modules.map((m) => [m.name, m.unlocked]))).toMatchObject({
      "speed-1": true,
      "speed-2": false,
      "creative-speed": false,
    });
    expect(p.modules.map((m) => m.name)).not.toContain("ee-super-speed-module");
    expect(Object.fromEntries(p.beacons.map((b) => [b.name, b.unlocked]))).toMatchObject({
      "beacon-1": true,
      "beacon-2": false,
      "creative-beacon": false,
    });
    expect(p.beacons.map((b) => b.name)).not.toContain("ee-super-beacon");
  });

  it("treats tech-unlockable modules and beacons as unlocked in future mode", () => {
    seed();
    setResearchHorizon({ mode: "future" });
    const p = modulePickerData("plate-recipe", "assembler")!;

    expect(Object.fromEntries(p.modules.map((m) => [m.name, m.unlocked]))).toMatchObject({
      "speed-1": true,
      "speed-2": true,
      "creative-speed": false,
    });
    expect(p.modules.map((m) => m.name)).not.toContain("ee-super-speed-module");
    expect(Object.fromEntries(p.beacons.map((b) => [b.name, b.unlocked]))).toMatchObject({
      "beacon-1": true,
      "beacon-2": true,
      "creative-beacon": false,
    });
    expect(p.beacons.map((b) => b.name)).not.toContain("ee-super-beacon");
  });

  it("omits excluded modules from machine detail helpers too", () => {
    seed();
    const names = modulesFittingMachine("assembler").map((m) => m.name);
    expect(names).toContain("speed-1");
    expect(names).not.toContain("ee-super-speed-module");
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

  it("NOW mode uses the bridge-synced mining productivity scalar when present", () => {
    seed();
    setResearchHorizon({
      mode: "now",
      packs: ["automation-science-pack", "py-science-pack-1"],
      researched: ["microfilters"],
    });
    metaSet("research_mining_productivity_bonus", "1.2");
    const b = productivityBonuses();
    expect(b.mining).toBeCloseTo(1.2);
    expect(b.recipes.get("fawogae-spore")).toBeCloseTo(0.15);
  });

  it("NOW mode uses bridge-synced exact recipe productivity when present", () => {
    seed();
    setResearchHorizon({
      mode: "now",
      packs: ["automation-science-pack", "py-science-pack-1"],
      researched: ["microfilters"],
      recipeProductivityBonuses: {
        "fawogae-spore": 0.35,
        "bhoddos-spore": 1,
      },
    });
    const b = productivityBonuses();
    expect(b.recipes.get("fawogae-spore")).toBeCloseTo(0.35);
    expect(b.recipes.get("bhoddos-spore")).toBeCloseTo(1);
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
      {
        name,
        iconKind: null,
        iconName: null,
        data,
        electricityW: null,
        dataFingerprint: blockReferenceFingerprint(data),
      },
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

describe("batched recipe reads", () => {
  const preparedStatements = <T>(read: () => T): { result: T; count: number } => {
    const prepare = vi.spyOn(db.$client, "prepare");
    try {
      const result = read();
      return { result, count: prepare.mock.calls.length };
    } finally {
      prepare.mockRestore();
    }
  };

  const seedBulkCategory = () => {
    db.run(sql`UPDATE recipes SET category = 'bulk-crafting'`);
    db.run(
      sql`INSERT INTO machine_categories (machine, category) VALUES ('furnace', 'bulk-crafting')`,
    );
  };

  const seedBulkRecipes = (count: number) => {
    for (let i = 0; i < count; i++) {
      const recipe = `bulk-plate-${i}`;
      db.run(sql`
        INSERT INTO recipes (name, display, kind, category, hidden, enabled)
        VALUES (${recipe}, ${`Bulk plate ${i}`}, 'real', 'bulk-crafting', 0, 1)
      `);
      db.run(sql`
        INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount)
        VALUES (${recipe}, 0, 'item', 'gear', 2)
      `);
      db.run(sql`
        INSERT INTO recipe_products (recipe, idx, kind, name, amount)
        VALUES (${recipe}, 0, 'item', 'plate', 1)
      `);
    }
  };

  it("keeps recipe-candidate statement count flat as candidate count grows", () => {
    seedBulkCategory();
    const small = preparedStatements(() => recipeCandidates("plate", "produce"));
    seedBulkRecipes(24);
    const large = preparedStatements(() => recipeCandidates("plate", "produce"));

    expect(small.result).toHaveLength(1);
    expect(large.result).toHaveLength(25);
    expect(large.count).toBeLessThanOrEqual(small.count + 2);
    expect(large.result.find((r) => r.name === "bulk-plate-0")?.ingredients).toEqual([
      { kind: "item", name: "gear", display: "Gear", amount: 2 },
    ]);
  });

  it("keeps browser-detail statement count flat and preserves card enrichment", () => {
    seedBulkCategory();
    const small = preparedStatements(() => browseDetail("plate"));
    seedBulkRecipes(24);
    const large = preparedStatements(() => browseDetail("plate"));

    expect(large.count).toBeLessThanOrEqual(small.count + 2);
    expect(large.result?.producedBy).toHaveLength((small.result?.producedBy.length ?? 0) + 24);
    const card = large.result?.producedBy.find((r) => r.name === "bulk-plate-0");
    expect(card?.machines).toEqual([{ name: "furnace", display: null, craftingSpeed: 1 }]);
    expect(card?.ingredients).toEqual([{ kind: "item", name: "gear", display: "Gear", amount: 2 }]);
    expect(card?.unlocks).toEqual([]);
  });
});

describe("batched block projections", () => {
  const preparedStatements = <T>(read: () => T): { result: T; count: number } => {
    const prepare = vi.spyOn(db.$client, "prepare");
    try {
      const result = read();
      return { result, count: prepare.mock.calls.length };
    } finally {
      prepare.mockRestore();
    }
  };

  const saveReferencedBlock = (index: number) => {
    const good = `batch-good-${index}`;
    const recipe = `batch-recipe-${index}`;
    db.run(sql`
      INSERT INTO items (name, display) VALUES (${good}, ${`Batch good ${index}`})
    `);
    db.run(sql`
      INSERT INTO recipes (name, kind, hidden) VALUES (${recipe}, 'real', 0)
    `);
    db.run(sql`
      INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount)
      VALUES (${recipe}, 0, 'item', 'plate', 1)
    `);
    db.run(sql`
      INSERT INTO recipe_products (recipe, idx, kind, name, amount)
      VALUES (${recipe}, 0, 'item', ${good}, 1)
    `);
    const data = { goals: [{ name: good, rate: 1 }], recipes: [recipe] };
    return saveBlockRow(
      {
        name: `batch-block-${index.toString().padStart(2, "0")}`,
        iconKind: null,
        iconName: null,
        data,
        electricityW: null,
        dataFingerprint: blockReferenceFingerprint(data),
        solveStatus: "solved",
      },
      null,
    );
  };

  it("keeps listBlocks statement count flat as saved references grow", () => {
    const firstId = saveReferencedBlock(0);
    const small = preparedStatements(() => listBlocks());
    for (let i = 1; i <= 24; i++) saveReferencedBlock(i);
    const large = preparedStatements(() => listBlocks());

    expect(large.count).toBe(small.count);
    expect(large.result).toHaveLength(small.result.length + 24);
    expect(large.result.find((block) => block.id === firstId)).toMatchObject({
      broken: false,
      health: "ok",
      unmadeGoals: [],
    });
  });

  const addFlowBlock = (index: number, enabled = true) => {
    const id = saveBlockRow(
      {
        name: `flow-block-${index.toString().padStart(2, "0")}`,
        iconKind: null,
        iconName: null,
        data: { goals: [{ name: "plate", rate: index + 1 }], recipes: ["smelt-plate"] },
        electricityW: null,
        dataFingerprint: null,
      },
      [
        { item: "plate", kind: "item", role: "primary", rate: index + 1 },
        { item: "gear", kind: "item", role: "import", rate: -(index + 2) },
      ],
    );
    db.run(
      sql`UPDATE blocks SET enabled = ${enabled ? 1 : 0}, sort_order = ${index + 1} WHERE id = ${id}`,
    );
    return id;
  };

  it("loads factory flows with a flat statement count and excludes disabled blocks", () => {
    db.run(sql`UPDATE blocks SET sort_order = 0 WHERE id = 1`);
    db.run(sql`
      INSERT INTO block_flows (block_id, item, kind, role, rate) VALUES
        (1, 'plate', 'item', 'primary', 10),
        (1, 'gear', 'item', 'byproduct', 2),
        (1, 'steel', 'item', 'stock', 3),
        (1, 'drill', 'item', 'import', -4)
    `);
    const disabledId = addFlowBlock(90, false);

    const smallWhatIf = preparedStatements(() => blocksWithFlows());
    const smallFactory = preparedStatements(() => factoryBlocks());
    const addedIds = Array.from({ length: 24 }, (_, index) => addFlowBlock(index));
    const largeWhatIf = preparedStatements(() => blocksWithFlows());
    const largeFactory = preparedStatements(() => factoryBlocks());

    expect(largeWhatIf.count).toBe(smallWhatIf.count);
    expect(largeFactory.count).toBe(smallFactory.count);
    expect(largeWhatIf.result.map((block) => block.id)).toEqual([1, ...addedIds]);
    expect(largeWhatIf.result.some((block) => block.id === disabledId)).toBe(false);
    expect(largeWhatIf.result[0].flows).toEqual([
      { item: "plate", kind: "item", role: "primary", rate: 10 },
      { item: "gear", kind: "item", role: "byproduct", rate: 2 },
      { item: "steel", kind: "item", role: "stock", rate: 3 },
      { item: "drill", kind: "item", role: "import", rate: -4 },
    ]);
    expect(largeFactory.result[0]).toEqual({
      id: 1,
      name: "smelting",
      makes: [
        { item: "plate", kind: "item", rate: 10 },
        { item: "steel", kind: "item", rate: 3, stock: true },
      ],
      byproducts: [{ item: "gear", kind: "item", rate: 2 }],
      imports: [{ item: "drill", kind: "item", rate: -4 }],
    });
  });
});

describe("blockBuildStatus", () => {
  // block 1 ('smelting', furnace/smelt-plate/10) comes from the top-level fixture.
  beforeEach(() => {
    db.run(
      sql`INSERT INTO crafting_machines (name, kind, crafting_speed) VALUES ('reactor','reactor',1)`,
    );

    // block 2: enabled, SAME machine+recipe as block 1, comfortably covered
    // by the shared built count once it lands
    db.run(sql`INSERT INTO blocks (id, name, data, enabled) VALUES (2,'copper','{}',1)`);
    db.run(
      sql`INSERT INTO block_machines (block_id, machine, recipe, count) VALUES (2,'furnace','smelt-plate',2)`,
    );

    // block 3: disabled, would be under-built if it counted
    db.run(sql`INSERT INTO blocks (id, name, data, enabled) VALUES (3,'spare','{}',0)`);
    db.run(
      sql`INSERT INTO block_machines (block_id, machine, recipe, count) VALUES (3,'furnace','smelt-plate',20)`,
    );

    // block 4: a recipe-blind machine (reactor / local heat source)
    db.run(sql`INSERT INTO blocks (id, name, data, enabled) VALUES (4,'heat','{}',1)`);
    db.run(
      sql`INSERT INTO block_machines (block_id, machine, recipe, count) VALUES (4,'reactor','generate-heat-py-burner',1.5)`,
    );

    setBuiltMachines([
      { machine: "furnace", recipe: "smelt-plate", count: 7 },
      { machine: "reactor", recipe: "", count: 1 },
    ]);
  });

  it("reports required (ceiled)/built/missing for one block", () => {
    const res = blockBuildStatus(1);
    expect(res).toHaveLength(1);
    expect(res[0].recipes[0]).toEqual({
      recipe: "smelt-plate",
      machine: "furnace",
      required: 10,
      built: 7,
      missing: 3,
    });
    expect(res[0].totalMissing).toBe(3);
  });

  it("with no blockId, lists only enabled blocks with a shortfall, worst-missing first", () => {
    const res = blockBuildStatus();
    expect(res.map((b) => b.blockId)).toEqual([1, 4]);
    expect(res[0].totalMissing).toBe(3);
    expect(res[1].totalMissing).toBe(1);
  });

  it("an explicit blockId still returns a disabled block, exposing the shared-built-count caveat", () => {
    const res = blockBuildStatus(3);
    expect(res).toHaveLength(1);
    expect(res[0].enabled).toBe(false);
    // required 20 vs. the SAME shared built count of 7 block 1 also saw
    expect(res[0].recipes[0].missing).toBe(13);
  });

  it("falls back to a machine-level total for a recipe-blind machine (reactor)", () => {
    const res = blockBuildStatus(4);
    expect(res).toHaveLength(1);
    expect(res[0].recipes[0]).toEqual({
      recipe: "generate-heat-py-burner",
      machine: "reactor",
      required: 2, // ceil(1.5)
      built: null,
      missing: null,
    });
    expect(res[0].machineFallback).toEqual([
      { machine: "reactor", requiredTotal: 2, builtTotal: 1, missing: 1 },
    ]);
    expect(res[0].totalMissing).toBe(1);
  });

  it("returns empty for an unknown block id", () => {
    expect(blockBuildStatus(999999)).toEqual([]);
  });
});

describe("logisticsForGood (#126): belts/inserters gated to unlocked tiers", () => {
  const seed = () => {
    db.run(sql`
      INSERT INTO items (name, display) VALUES
        ('transport-belt','Transport belt'),
        ('fast-transport-belt','Fast transport belt'),
        ('inserter','Inserter'),
        ('fast-inserter','Fast inserter')
    `);
    db.run(sql`
      INSERT INTO belts (name, display, speed) VALUES
        ('transport-belt','Transport belt',0.03125),
        ('fast-transport-belt','Fast transport belt',0.0625)
    `);
    db.run(sql`
      INSERT INTO inserters
        (name, display, rotation_speed, extension_speed, pickup_x, pickup_y, drop_x, drop_y, bulk, base_stack_bonus, max_belt_stack_size)
      VALUES
        ('inserter','Inserter',0.02,0.035,0,-1,0,1.19921875,0,0,1),
        ('fast-inserter','Fast inserter',0.04,0.1,0,-1,0,1.19921875,0,0,1)
    `);
    db.run(sql`
      INSERT INTO recipes (name, kind, category, energy_required, enabled, hidden) VALUES
        ('craft-transport-belt','real','crafting',0.5,1,0),
        ('craft-inserter','real','crafting',0.5,1,0),
        ('craft-fast-transport-belt','real','crafting',0.5,0,0),
        ('craft-fast-inserter','real','crafting',0.5,0,0)
    `);
    db.run(sql`
      INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
        ('craft-transport-belt',0,'item','transport-belt',1),
        ('craft-inserter',0,'item','inserter',1),
        ('craft-fast-transport-belt',0,'item','fast-transport-belt',1),
        ('craft-fast-inserter',0,'item','fast-inserter',1)
    `);
    db.run(sql`
      INSERT INTO tech_unlocks (technology, recipe) VALUES
        ('logistics-2','craft-fast-transport-belt'),
        ('logistics-2','craft-fast-inserter')
    `);
    db.run(sql`
      INSERT INTO tech_ingredients (technology, name, amount) VALUES
        ('logistics-2','logistic-science-pack',1)
    `);
  };

  it("NOW mode: only the reachable tier is unlocked, math matches the pure lib formulas", () => {
    seed();
    setResearchHorizon({ mode: "now", packs: [], researched: [] });
    const r = logisticsForGood("plate", 22.5);
    if (!("kind" in r) || r.kind !== "item") throw new Error("expected item result");
    expect(r.belts.map((b) => b.belt)).toEqual(["transport-belt"]); // fast tier gated out
    expect(r.belts[0].count).toBe(2); // ceil(22.5 / (0.03125*480*1))
    expect(r.belts[0].saturation).toBeCloseTo(0.75, 3);
    expect(r.inserters.map((i) => i.inserter)).toEqual(["inserter"]); // fast-inserter gated out
    expect(r.inserters[0].count).toBe(19); // ceil(22.5 / 1.2)
  });

  it("FUTURE mode: tech-unlockable tiers count even though unreached", () => {
    seed();
    setResearchHorizon({ mode: "future" });
    const r = logisticsForGood("plate", 22.5);
    if (!("kind" in r) || r.kind !== "item") throw new Error("expected item result");
    expect(r.belts.map((b) => b.belt)).toEqual(["transport-belt", "fast-transport-belt"]);
    expect(r.inserters.map((i) => i.inserter)).toEqual(["inserter", "fast-inserter"]);
  });

  it("a fluid short-circuits to a note, no belt/inserter math", () => {
    db.run(sql`INSERT INTO fluids (name, display) VALUES ('molten-iron','Molten iron')`);
    const r = logisticsForGood("molten-iron", 10);
    expect(r).toMatchObject({ kind: "fluid", good: "molten-iron", display: "Molten iron" });
  });

  it("errors on an unknown good", () => {
    expect(logisticsForGood("no-such-good", 5)).toEqual({ error: "no good 'no-such-good'" });
  });
});
