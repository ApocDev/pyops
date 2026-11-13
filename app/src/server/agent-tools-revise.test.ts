/**
 * reviseBlock recipe-set revision (#12): the propose-then-apply tool can now
 * swap an existing block's recipes, not just its rate. The proposal re-solves
 * the new set and must surface the diff (recipesAdded/recipesRemoved) and any
 * NEW dangling byproducts vs the block's current cached exports, so the user
 * sees closure damage before applying.
 *
 * Fixture: an iron-plate block on the basic ore recipe, revised to the
 * molten-iron variant whose smelting emits a `slag` byproduct; and a small
 * mall block (plates at a rate, gears kept in stock) whose goals are changed
 * by name (#132); and a boiler block making steam at 165° and 500°, whose
 * preview must keep each goal's temperature.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "../db/index.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { reviseBlock } from "./agent-tools.server.ts";

type GoalValue = { rate: number; temperature?: number; stock?: number; window?: number };
type Update = {
  ok: boolean;
  kind: "update";
  updateBlockId: number;
  blockName?: string;
  goalChanges?: {
    name: string;
    temperature?: number;
    display: string;
    before: GoalValue;
    after: GoalValue;
  }[];
  buildings?: { recipe: string; machine: string; count: number }[];
  goals?: GoalValue[];
  rate?: number;
  recipes?: string[];
  recipesAdded?: string[];
  recipesRemoved?: string[];
  newByproducts?: string[];
  byproducts?: { good: string }[];
  imports?: string[];
  error?: string;
  missing?: boolean;
};

const revise = async (input: {
  blockId: number;
  rate?: number;
  goals?: { name: string; temperature?: number; rate?: number; stock?: number; window?: number }[];
  recipes?: string[];
}): Promise<Update> =>
  (await reviseBlock.execute!(input, { toolCallId: "test", messages: [], context: {} })) as Update;

describe("reviseBlock recipe-set revision (#12)", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    fx.db.exec(`
      INSERT INTO items (name, display) VALUES
        ('iron-plate','Iron plate'),('iron-ore','Iron ore'),('slag','Slag'),('iron-gear','Iron gear');
      INSERT INTO fluids (name, display) VALUES ('molten-iron','Molten iron');
      INSERT INTO fluids (name, display, default_temperature, max_temperature) VALUES
        ('steam','Steam',15,5000);

      INSERT INTO recipes (name, kind, category, energy_required, enabled, hidden) VALUES
        ('iron-plate','real','smelting',3.2,1,0),
        ('iron-plate-adv','real','casting',2,1,0),
        ('molten-iron-01','real','smelting',4,1,0),
        ('iron-gear','real','crafting',1,1,0),
        ('steam-165','real','boiling',1,1,0),
        ('steam-500','real','boiling',1,1,0);
      INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES
        ('iron-plate',0,'item','iron-ore',1),
        ('iron-plate-adv',0,'fluid','molten-iron',10),
        ('molten-iron-01',0,'item','iron-ore',3),
        ('iron-gear',0,'item','iron-plate',2);
      INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
        ('iron-plate',0,'item','iron-plate',1),
        ('iron-plate-adv',0,'item','iron-plate',2),
        ('molten-iron-01',0,'fluid','molten-iron',20),
        ('molten-iron-01',1,'item','slag',1),
        ('iron-gear',0,'item','iron-gear',1);
      INSERT INTO recipe_products (recipe, idx, kind, name, amount, temperature) VALUES
        ('steam-165',0,'fluid','steam',10,165),
        ('steam-500',0,'fluid','steam',10,500);

      INSERT INTO crafting_machines
        (name, display, kind, crafting_speed, module_slots, energy_usage_w, energy_source)
      VALUES
        ('stone-furnace','Stone furnace','furnace',1,0,90000,'electric'),
        ('caster','Caster','assembling-machine',1,0,200000,'electric'),
        ('assembler','Assembler','assembling-machine',1,0,75000,'electric'),
        ('boiler','Boiler','assembling-machine',1,0,100000,'electric');
      INSERT INTO machine_categories (machine, category) VALUES
        ('stone-furnace','smelting'),
        ('caster','casting'),
        ('assembler','crafting'),
        ('boiler','boiling');

      INSERT INTO blocks (id, name, data, enabled) VALUES
        (1,'Iron plates','{"goals":[{"name":"iron-plate","rate":2}],"recipes":["iron-plate"],"machines":{"iron-plate":"stone-furnace"}}',1),
        (2,'Mall','{"goals":[{"name":"iron-plate","rate":1},{"name":"iron-gear","rate":0.1,"stock":60,"window":600}],"recipes":["iron-plate","iron-gear"]}',1),
        (3,'Boilers','{"goals":[{"name":"steam","rate":60,"temperature":165},{"name":"steam","rate":20,"temperature":500}],"recipes":["steam-165","steam-500"]}',1);
      INSERT INTO block_flows (block_id, item, kind, role, rate) VALUES
        (1,'iron-plate','item','primary',2),
        (1,'iron-ore','item','import',2);
    `);
    fx.db.close();
    switchDatabase(fx.file);
  });

  afterEach(() => fx.cleanup());

  it("proposes a recipe swap with the diff and flags NEW dangling byproducts", async () => {
    const res = await revise({ blockId: 1, recipes: ["iron-plate-adv", "molten-iron-01"] });
    expect(res.ok).toBe(true);
    expect(res.kind).toBe("update");
    expect(res.updateBlockId).toBe(1);
    // rate omitted → the block's current rate is kept
    expect(res.rate).toBe(2);
    expect(res.goalChanges).toEqual([]);
    expect(res.recipesAdded?.sort()).toEqual(["iron-plate-adv", "molten-iron-01"]);
    expect(res.recipesRemoved).toEqual(["iron-plate"]);
    // slag is produced by the new set and consumed by nothing — and the stored
    // block never exported it, so it's flagged as a NEW byproduct to route
    expect(res.byproducts?.map((b) => b.good)).toContain("slag");
    expect(res.newByproducts).toContain("slag");
    // the re-solved closure shows the new import chain (ore feeds the melt)
    expect(res.imports).toContain("iron-ore");
  });

  it("a rate-only revision has an empty recipe diff and no new byproducts", async () => {
    const res = await revise({ blockId: 1, rate: 5 });
    expect(res.ok).toBe(true);
    expect(res.rate).toBe(5);
    expect(res.goalChanges).toEqual([
      { name: "iron-plate", display: "Iron plate", before: { rate: 2 }, after: { rate: 5 } },
    ]);
    expect(res.recipesAdded).toEqual([]);
    expect(res.recipesRemoved).toEqual([]);
    expect(res.newByproducts).toEqual([]);
  });

  it("changes any goal of a multi-goal block by name, several at once", async () => {
    const res = await revise({
      blockId: 2,
      goals: [
        { name: "iron-gear", stock: 120 },
        { name: "iron-plate", rate: 3 },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.goalChanges).toEqual([
      {
        name: "iron-gear",
        display: "Iron gear",
        before: { rate: 0.1, stock: 60, window: 600 },
        after: { rate: 0.2, stock: 120, window: 600 },
      },
      { name: "iron-plate", display: "Iron plate", before: { rate: 1 }, after: { rate: 3 } },
    ]);
    // the preview solves the block's full, changed goal set
    expect(res.goals).toEqual([
      { name: "iron-plate", rate: 3 },
      { name: "iron-gear", rate: 0.2, stock: 120, window: 600 },
    ]);
  });

  it("previews a change to one temperature of a fluid, keeping each goal's temperature", async () => {
    const res = await revise({
      blockId: 3,
      goals: [{ name: "steam", temperature: 500, rate: 40 }],
    });
    expect(res.ok).toBe(true);
    expect(res.goalChanges).toEqual([
      {
        name: "steam",
        temperature: 500,
        display: "Steam",
        before: { rate: 20 },
        after: { rate: 40 },
      },
    ]);
    expect(res.goals).toEqual([
      { name: "steam", rate: 60, temperature: 165 },
      { name: "steam", rate: 40, temperature: 500 },
    ]);
    // each boiler recipe is sized for its own goal: 60/s at 165° and 40/s at 500°
    expect(res.buildings).toEqual([
      { recipe: "steam-165", machine: "boiler", count: 6 },
      { recipe: "steam-500", machine: "boiler", count: 4 },
    ]);
  });

  it("rejects a goal the block doesn't have, naming its goals", async () => {
    const res = await revise({ blockId: 2, goals: [{ name: "slag", rate: 1 }] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('"slag" is not a goal of this block (its goals: iron-plate, iron-gear)');
  });

  it("rejects a revision that changes nothing", async () => {
    const res = await revise({ blockId: 1 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/nothing to revise/);
  });

  it("still reports a missing block", async () => {
    const res = await revise({ blockId: 99, rate: 1 });
    expect(res.ok).toBe(false);
    expect(res.missing).toBe(true);
  });
});
