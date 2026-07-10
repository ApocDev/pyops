/**
 * blockBuildStatus (#123): built-vs-required MACHINE status for a block that
 * already exists, read from the last synced game state (block_machines vs.
 * built_machines) — no re-solve, works offline.
 *
 * Fixture: four blocks sharing a `furnace` running `smelt-iron` (blocks 1/2/3,
 * enabled/enabled/disabled) to exercise the force-wide built-count sharing
 * caveat, plus a `reactor` block (4) running a recipe-blind local heat-source
 * recipe to exercise the machineFallback path.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "../db/index.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import * as q from "../db/queries.server.ts";
import { markSolveGenerationResolved } from "../db/solve-generation.server.ts";
import { blockBuildStatus } from "./agent-tools.server.ts";

type Result = {
  ok: boolean;
  error?: string;
  syncedAt: string | null;
  syncedCount: number | null;
  blocks: {
    blockId: number;
    block: string;
    enabled: boolean;
    totalMissing: number;
    recipes: {
      recipe: string;
      machine: string;
      required: number;
      built: number | null;
      missing: number | null;
    }[];
    machineFallback?: {
      machine: string;
      requiredTotal: number;
      builtTotal: number;
      missing: number;
    }[];
  }[];
};

const status = async (blockId?: number, limit = 10): Promise<Result> =>
  (await blockBuildStatus.execute!(
    { blockId, limit },
    { toolCallId: "test", messages: [] },
  )) as Result;

describe("blockBuildStatus tool", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    fx.db.exec(`
      INSERT INTO items (name, display) VALUES ('iron-ore','Iron ore'),('iron-plate','Iron plate');
      INSERT INTO recipes (name, kind, hidden) VALUES ('smelt-iron','real',0);
      INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES ('smelt-iron',0,'item','iron-ore',1);
      INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES ('smelt-iron',0,'item','iron-plate',1);
      INSERT INTO crafting_machines (name, kind, crafting_speed) VALUES ('furnace','furnace',1),('reactor','reactor',1);

      INSERT INTO blocks (id, name, data, enabled) VALUES (1,'coke','{}',1);
      INSERT INTO block_machines (block_id, machine, recipe, count) VALUES (1,'furnace','smelt-iron',12.3);

      INSERT INTO blocks (id, name, data, enabled) VALUES (2,'copper','{}',1);
      INSERT INTO block_machines (block_id, machine, recipe, count) VALUES (2,'furnace','smelt-iron',2);

      INSERT INTO blocks (id, name, data, enabled) VALUES (3,'spare','{}',0);
      INSERT INTO block_machines (block_id, machine, recipe, count) VALUES (3,'furnace','smelt-iron',20);

      INSERT INTO blocks (id, name, data, enabled) VALUES (4,'heat','{}',1);
      INSERT INTO block_machines (block_id, machine, recipe, count) VALUES (4,'reactor','generate-heat-py-burner',1.5);
    `);
    fx.db.close();
    switchDatabase(fx.file);

    q.setBuiltMachines([
      { machine: "furnace", recipe: "smelt-iron", count: 7 },
      { machine: "reactor", recipe: "", count: 1 },
    ]);
    q.metaSet("built_synced_at", "2026-07-01T00:00:00.000Z");
    q.metaSet("built_synced_count", "8");
    markSolveGenerationResolved();
  });

  afterEach(() => fx.cleanup());

  it("reports required (ceiled)/built/missing for one block", async () => {
    const res = await status(1);
    expect(res.ok).toBe(true);
    expect(res.syncedAt).toBe("2026-07-01T00:00:00.000Z");
    expect(res.syncedCount).toBe(8);
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0].recipes[0]).toEqual({
      recipe: "smelt-iron",
      machine: "furnace",
      required: 13, // ceil(12.3)
      built: 7,
      missing: 6,
    });
    expect(res.blocks[0].totalMissing).toBe(6);
  });

  it("with no blockId, lists only enabled blocks with a shortfall, worst-missing first", async () => {
    const res = await status(undefined);
    expect(res.blocks.map((b) => b.blockId)).toEqual([1, 4]);
    expect(res.blocks[0].totalMissing).toBe(6);
    expect(res.blocks[1].totalMissing).toBe(1);
  });

  it("caps the no-blockId listing at `limit` (#127)", async () => {
    const res = await status(undefined, 1);
    expect(res.blocks.map((b) => b.blockId)).toEqual([1]);
  });

  it("ignores `limit` when an explicit blockId is given", async () => {
    const res = await status(1, 1);
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0].blockId).toBe(1);
  });

  it("an explicit blockId still returns a disabled block, exposing the shared-built-count caveat", async () => {
    const res = await status(3);
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0].enabled).toBe(false);
    // required 20 vs. the SAME shared built count of 7 the coke block also saw
    expect(res.blocks[0].recipes[0].missing).toBe(13);
  });

  it("falls back to a machine-level total for a recipe-blind machine (reactor)", async () => {
    const res = await status(4);
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0].recipes[0]).toEqual({
      recipe: "generate-heat-py-burner",
      machine: "reactor",
      required: 2, // ceil(1.5)
      built: null,
      missing: null,
    });
    expect(res.blocks[0].machineFallback).toEqual([
      { machine: "reactor", requiredTotal: 2, builtTotal: 1, missing: 1 },
    ]);
    expect(res.blocks[0].totalMissing).toBe(1);
  });

  it("errors on an unknown block id", async () => {
    const res = await status(999999);
    expect(res).toEqual({ ok: false, error: "no such block", blocks: [] });
  });
});
