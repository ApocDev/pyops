/**
 * Applying an assistant update (#132): goal changes by name and a recipe swap
 * persist in one re-solve, the cached flows follow, and one undo restores the
 * block exactly. A proposal saved before named goal changes carries only a
 * `rate`, which still means the block's first goal.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { switchDatabase } from "../db/index.server.ts";
import { getBlock, getBlockFlows } from "../db/queries.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { applyBlockUpdate } from "./block-update.server.ts";
import { undoLast } from "./undo.server.ts";

let fx: TestDb;

const BOILERS = {
  goals: [
    { name: "steam", rate: 60, temperature: 165 },
    { name: "steam", rate: 20, temperature: 500 },
  ],
  recipes: ["steam-165", "steam-500"],
};

const MALL = {
  goals: [
    { name: "plate", rate: 1 },
    { name: "gear", rate: 0.1, stock: 60, window: 600 },
  ],
  recipes: ["smelt-plate", "make-gear"],
};

beforeEach(async () => {
  fx = await makeTestDb();
  fx.db.exec(`
    INSERT INTO items (name, display) VALUES ('plate','Plate'),('ore','Ore'),('gear','Gear');
    INSERT INTO recipes (name, kind, category, energy_required, enabled, hidden) VALUES
      ('smelt-plate','real','smelting',1,1,0),
      ('make-gear','real','crafting',1,1,0),
      ('make-gear-cheap','real','crafting',1,1,0),
      ('steam-165','real','boiling',1,1,0),
      ('steam-500','real','boiling',1,1,0);
    INSERT INTO fluids (name, display, default_temperature, max_temperature) VALUES
      ('steam','Steam',15,5000);
    INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES
      ('smelt-plate',0,'item','ore',1),
      ('make-gear',0,'item','plate',2),
      ('make-gear-cheap',0,'item','plate',1);
    INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
      ('smelt-plate',0,'item','plate',1),
      ('make-gear',0,'item','gear',1),
      ('make-gear-cheap',0,'item','gear',1);
    INSERT INTO recipe_products (recipe, idx, kind, name, amount, temperature) VALUES
      ('steam-165',0,'fluid','steam',10,165),
      ('steam-500',0,'fluid','steam',10,500);
    INSERT INTO crafting_machines
      (name, display, kind, crafting_speed, module_slots, energy_usage_w, energy_source)
    VALUES
      ('furnace','Furnace','furnace',1,0,90000,'electric'),
      ('assembler','Assembler','assembling-machine',1,0,75000,'electric'),
      ('boiler','Boiler','assembling-machine',1,0,100000,'electric');
    INSERT INTO machine_categories (machine, category) VALUES
      ('furnace','smelting'),('assembler','crafting'),('boiler','boiling');
  `);
  fx.db
    .prepare("INSERT INTO blocks (id, name, data, enabled) VALUES (1, 'Mall', ?, 1)")
    .run(JSON.stringify(MALL));
  fx.db
    .prepare("INSERT INTO blocks (id, name, data, enabled) VALUES (2, 'Boilers', ?, 1)")
    .run(JSON.stringify(BOILERS));
  fx.db.close();
  switchDatabase(fx.file);
});

afterEach(() => fx.cleanup());

describe("applyBlockUpdate", () => {
  it("changes several goals and the recipe set, then undoes as one step", async () => {
    const res = await applyBlockUpdate({
      blockId: 1,
      goals: [
        { name: "gear", stock: 120 },
        { name: "plate", rate: 3 },
      ],
      recipes: ["smelt-plate", "make-gear-cheap"],
    });
    expect(res).toEqual({ ok: true });

    const saved = getBlock(1)!.data;
    expect(saved.goals).toEqual([
      { name: "plate", rate: 3 },
      { name: "gear", rate: 0.2, stock: 120, window: 600 },
    ]);
    expect(saved.recipes).toEqual(["smelt-plate", "make-gear-cheap"]);
    // the solve cache follows: 3/s plates out + 0.2/s plates into cheap gears
    const ore = getBlockFlows(1).find((f) => f.item === "ore");
    expect(ore?.rate).toBeCloseTo(3.2);

    expect(await undoLast()).toEqual({
      undone: 'Change "Mall" recipes',
      changedBlockIds: [1],
    });
    expect(getBlock(1)!.data).toEqual(MALL);
  });

  it("applies a legacy rate-only update to the first goal at its temperature", async () => {
    // a bare "steam" would be ambiguous here; `rate` names the 165° goal
    expect(await applyBlockUpdate({ blockId: 2, rate: 90 })).toEqual({ ok: true });
    expect(getBlock(2)!.data.goals).toEqual([
      { name: "steam", rate: 90, temperature: 165 },
      { name: "steam", rate: 20, temperature: 500 },
    ]);
  });

  it("refuses an unknown goal without saving", async () => {
    const res = await applyBlockUpdate({ blockId: 1, goals: [{ name: "ore", rate: 1 }] });
    expect(res).toEqual({
      ok: false,
      error: '"ore" is not a goal of this block (its goals: plate, gear)',
    });
    expect(getBlock(1)!.data).toEqual(MALL);
  });
});
