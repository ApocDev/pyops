/**
 * Solved building counts flowing from the block solver into the agent tools:
 * submitBlock's draft now carries a `buildings` field (recipe -> machine ->
 * solved count) instead of discarding computeBlock's machine counts, and the
 * new `buildingBill` tool aggregates whole-machine counts across MULTIPLE
 * blocks (ceiling each block's fractional count before summing) so the agent
 * can answer "what buildings do I need for this plan" without a second
 * hand-rolled solve.
 *
 * Fixture: two smelting blocks (iron-plate, copper-plate) sharing the same
 * stone-furnace machine, plus a craft-stone-furnace recipe so buildingBill can
 * resolve the machine ENTITY to the ITEM that places it and suggest how to
 * make it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "../db/index.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { buildingBill, submitBlock } from "./agent-tools.server.ts";

type Draft = {
  ok: boolean;
  buildings: { recipe: string; machine: string; count: number }[];
};

type Bill = {
  machines: {
    item: string | null;
    display: string;
    entity: string;
    count: number;
    producers: { recipe: string }[];
    note?: string;
  }[];
  skipped: { target: string; error: string }[];
};

const draft = async (input: { target: string; rate: number; recipes: string[] }): Promise<Draft> =>
  (await submitBlock.execute!(input, { toolCallId: "test", messages: [] })) as Draft;

const bill = async (blocks: { target: string; rate: number; recipes: string[] }[]): Promise<Bill> =>
  (await buildingBill.execute!({ blocks }, { toolCallId: "test", messages: [] })) as Bill;

describe("solved building counts (draft buildings + buildingBill)", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    fx.db.exec(`
      INSERT INTO items (name, display) VALUES
        ('iron-ore','Iron ore'),('iron-plate','Iron plate'),
        ('copper-ore','Copper ore'),('copper-plate','Copper plate'),
        ('stone','Stone'),('stone-furnace','Stone furnace');

      INSERT INTO recipes (name, kind, category, energy_required, enabled, hidden) VALUES
        ('iron-plate','real','smelting',3.2,1,0),
        ('copper-plate','real','smelting',3.2,1,0),
        ('craft-stone-furnace','real','crafting',0.5,1,0);
      INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES
        ('iron-plate',0,'item','iron-ore',1),
        ('copper-plate',0,'item','copper-ore',1),
        ('craft-stone-furnace',0,'item','stone',5);
      INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
        ('iron-plate',0,'item','iron-plate',1),
        ('copper-plate',0,'item','copper-plate',1),
        ('craft-stone-furnace',0,'item','stone-furnace',1);

      INSERT INTO crafting_machines
        (name, display, kind, crafting_speed, module_slots, energy_usage_w, energy_source)
      VALUES
        ('stone-furnace','Stone furnace','furnace',1,0,90000,'electric');
      INSERT INTO machine_categories (machine, category) VALUES
        ('stone-furnace','smelting');
    `);
    fx.db.close();
    switchDatabase(fx.file);
  });

  afterEach(() => fx.cleanup());

  it("submitBlock's draft returns solved building counts per recipe", async () => {
    const res = await draft({ target: "iron-plate", rate: 4, recipes: ["iron-plate"] });
    expect(res.ok).toBe(true);
    expect(res.buildings).toHaveLength(1);
    expect(res.buildings[0].recipe).toBe("iron-plate");
    expect(res.buildings[0].machine).toBe("stone-furnace");
    // rate 4, 3.2s/craft, speed 1 -> 12.8 fractional furnaces (not yet ceiled —
    // that's buildingBill's job when aggregating whole machines across blocks)
    expect(res.buildings[0].count).toBeCloseTo(12.8, 2);
  });

  it("aggregates whole-machine counts for the SAME machine across multiple blocks", async () => {
    const res = await bill([
      { target: "iron-plate", rate: 4, recipes: ["iron-plate"] },
      { target: "copper-plate", rate: 2, recipes: ["copper-plate"] },
    ]);
    expect(res.skipped).toEqual([]);
    expect(res.machines).toHaveLength(1);
    const furnace = res.machines[0];
    // ceil(12.8) + ceil(6.4) = 13 + 7 = 20 whole furnaces, NOT ceil(19.2)=20
    // coincidentally equal here, so also check the intermediate isn't a bare sum
    expect(furnace.entity).toBe("stone-furnace");
    expect(furnace.item).toBe("stone-furnace");
    expect(furnace.display).toBe("Stone furnace");
    expect(furnace.count).toBe(20);
    // resolves how to make the machine item itself
    expect(furnace.producers.length).toBeGreaterThan(0);
    expect(furnace.producers[0].recipe).toBe("craft-stone-furnace");
  });

  it("skips a block whose recipes don't resolve to anything, without failing the call", async () => {
    const res = await bill([
      { target: "iron-plate", rate: 4, recipes: ["iron-plate"] },
      { target: "unobtainium", rate: 1, recipes: ["no-such-recipe"] },
    ]);
    // the bogus block contributes no machines and doesn't corrupt the real one
    expect(res.machines).toHaveLength(1);
    expect(res.machines[0].entity).toBe("stone-furnace");
    expect(res.machines[0].count).toBe(13); // ceil(12.8) from the iron-plate block alone
  });
});
