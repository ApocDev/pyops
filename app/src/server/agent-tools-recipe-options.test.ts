/**
 * `optionsFor` (the shared helper behind recipeOptions/recipeOptionsBatch and
 * buildingBill's `producers`) resolves its representative `machine` the same
 * favorite-then-fallback way computeBlock/recipeDefaultsFn do — the user's
 * stored category favorite, else the lowest-tier `pickDefaultMachine` pick —
 * NOT the fastest machine in the category (#130). `fastestMachine` surfaces
 * the fastest tier separately, only when it differs from the resolved pick.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "../db/index.server.ts";
import { setFavoriteMachine, setResearchHorizon } from "../db/queries.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { recipeOptions } from "./agent-tools.server.ts";

type Candidate = {
  recipe: string;
  machine: string | null;
  machineFavorite?: boolean;
  fastestMachine?: string;
};

const options = async (good: string) =>
  (await recipeOptions.execute!(
    { good, direction: "produce", limit: 12 },
    { toolCallId: "test", messages: [] },
  )) as Candidate[];

describe("optionsFor resolves 'machine' the same way computeBlock does (#130)", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    fx.db.exec(`
      INSERT INTO items (name, display) VALUES
        ('iron-ore','Iron ore'),('iron-plate','Iron plate'),
        ('stone-furnace','Stone furnace'),('electric-furnace','Electric furnace'),
        ('big-furnace','Big furnace'),('automation-science-pack','Automation science pack');

      INSERT INTO recipes (name, kind, category, energy_required, enabled, hidden) VALUES
        ('iron-plate','real','smelting',3.2,1,0),
        ('craft-stone-furnace','real','crafting',0.5,1,0),
        ('craft-electric-furnace','real','crafting',0.5,1,0),
        ('craft-big-furnace','real','crafting',0.5,0,0);

      INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES
        ('iron-plate',0,'item','iron-ore',1),
        ('craft-stone-furnace',0,'item','iron-ore',5),
        ('craft-electric-furnace',0,'item','iron-ore',10),
        ('craft-big-furnace',0,'item','iron-ore',20);
      INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
        ('iron-plate',0,'item','iron-plate',1),
        ('craft-stone-furnace',0,'item','stone-furnace',1),
        ('craft-electric-furnace',0,'item','electric-furnace',1),
        ('craft-big-furnace',0,'item','big-furnace',1);

      INSERT INTO crafting_machines
        (name, display, kind, crafting_speed, module_slots, energy_usage_w, energy_source)
      VALUES
        ('stone-furnace','Stone furnace','furnace',1,0,90000,'electric'),
        ('electric-furnace','Electric furnace','furnace',2,2,180000,'electric'),
        ('big-furnace','Big furnace','furnace',4,2,360000,'electric');
      INSERT INTO machine_categories (machine, category) VALUES
        ('stone-furnace','smelting'),
        ('electric-furnace','smelting'),
        ('big-furnace','smelting');

      INSERT INTO technologies (name, display) VALUES ('big-furnace-tech','Big Furnace Tech');
      INSERT INTO tech_unlocks (technology, recipe) VALUES ('big-furnace-tech','craft-big-furnace');
      -- gives big-furnace-tech a real science cost so it isn't vacuously
      -- "reached" under a NOW/target horizon with no packs available yet
      INSERT INTO tech_ingredients (technology, name, amount) VALUES
        ('big-furnace-tech','automation-science-pack',10);
    `);
    fx.db.close();
    switchDatabase(fx.file);
  });

  afterEach(() => fx.cleanup());

  it("resolves the low-tier fallback, not the fastest tier, when no favorite is set", async () => {
    const res = await options("iron-plate");
    const c = res.find((r) => r.recipe === "iron-plate")!;
    expect(c.machine).toContain("Stone furnace");
    expect(c.machine).not.toContain("Big furnace");
    expect(c.machine).toContain("available");
    expect(c.machine).not.toContain("needs");
    expect(c.machineFavorite).toBeUndefined();
    expect(c.fastestMachine).toBeDefined();
    expect(c.fastestMachine).toContain("Big furnace");
    expect(c.fastestMachine).toContain("needs Big Furnace Tech");
  });

  it("prefers the user's stored favorite over both the fastest and the fallback", async () => {
    setFavoriteMachine("smelting", "electric-furnace");
    const res = await options("iron-plate");
    const c = res.find((r) => r.recipe === "iron-plate")!;
    expect(c.machine).toContain("Electric furnace");
    expect(c.machineFavorite).toBe(true);
    expect(c.fastestMachine).toBeDefined();
    expect(c.fastestMachine).toContain("Big furnace");
  });

  it("omits fastestMachine when the resolved pick is already the fastest tier", async () => {
    setFavoriteMachine("smelting", "big-furnace");
    const res = await options("iron-plate");
    const c = res.find((r) => r.recipe === "iron-plate")!;
    expect(c.machine).toContain("Big furnace");
    expect(c.machineFavorite).toBe(true);
    expect(c.fastestMachine).toBeUndefined();
  });

  it("keeps resolving an unlocked favorite under a NOW research horizon", async () => {
    setFavoriteMachine("smelting", "electric-furnace");
    setResearchHorizon({ mode: "now" });
    const res = await options("iron-plate");
    const c = res.find((r) => r.recipe === "iron-plate")!;
    expect(c.machine).toContain("Electric furnace");
    expect(c.machineFavorite).toBe(true);
  });

  it("restricts the favorite/fallback pool to unlocked machines under a NOW research horizon (#130)", async () => {
    // big-furnace-tech is never researched in this fixture's horizon, so the
    // stored favorite (big-furnace) is locked: under NOW/target planning the
    // resolution must fall through to the low-tier unlocked fallback instead
    // of silently recommending an unbuildable machine.
    setFavoriteMachine("smelting", "big-furnace");
    setResearchHorizon({ mode: "now" });
    const res = await options("iron-plate");
    const c = res.find((r) => r.recipe === "iron-plate")!;
    expect(c.machine).toContain("Stone furnace");
    expect(c.machine).not.toContain("Big furnace");
    expect(c.machineFavorite).toBeUndefined();
  });
});

describe("optionsFor's fastestMachine requires a STRICTLY faster tier", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    fx.db.exec(`
      INSERT INTO items (name, display) VALUES
        ('iron-ore','Iron ore'),('iron-plate','Iron plate'),
        ('assembler-a','Assembler A'),('assembler-b','Assembler B');

      INSERT INTO recipes (name, kind, category, energy_required, enabled, hidden) VALUES
        ('iron-plate','real','crafting',3.2,1,0);
      INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES
        ('iron-plate',0,'item','iron-ore',1);
      INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
        ('iron-plate',0,'item','iron-plate',1);

      -- Two machine tiers with the SAME crafting speed (a tie) — neither is
      -- strictly faster than the other, so fastestMachine must not surface
      -- either one over the resolved pick.
      INSERT INTO crafting_machines
        (name, display, kind, crafting_speed, module_slots, energy_usage_w, energy_source)
      VALUES
        ('assembler-a','Assembler A','assembler',2,2,150000,'electric'),
        ('assembler-b','Assembler B','assembler',2,4,150000,'electric');
      INSERT INTO machine_categories (machine, category) VALUES
        ('assembler-a','crafting'),
        ('assembler-b','crafting');
    `);
    fx.db.close();
    switchDatabase(fx.file);
  });

  afterEach(() => fx.cleanup());

  it("omits fastestMachine when the only other tier ties on crafting speed", async () => {
    // Resolve via a stored favorite that ISN'T the machine the name-only
    // reduce would land on, so a bug that only compares names (not speed)
    // would wrongly surface the other equal-speed tier as "faster".
    setFavoriteMachine("crafting", "assembler-b");
    const res = await options("iron-plate");
    const c = res.find((r) => r.recipe === "iron-plate")!;
    expect(c.machine).toContain("Assembler B");
    expect(c.fastestMachine).toBeUndefined();
  });
});
