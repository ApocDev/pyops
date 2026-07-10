/**
 * Undo system (#90): the trigger-based inverse log, the withUndoAction
 * grouping/marker semantics, retention, and undoLast's execute-without-relogging
 * + cache re-solve. Runs against a real migrated temp db (test-helpers), so the
 * triggers under test are exactly the ones a production db gets.
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { db, switchDatabase } from "../db/index.server.ts";
import { blockFlows, blocks, tasks, undoActions, undoCurrent, undoLog } from "../db/schema.ts";
import { deleteBlock, getBlock, saveBlockRow, setBlockEnabled } from "../db/queries.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { UNDO_RETAIN, withUndoAction } from "./undo-action.server.ts";
import { undoLast, undoStatus } from "./undo.server.ts";

let fx: TestDb;

beforeEach(async () => {
  fx = await makeTestDb();
  // minimal reference data so the post-undo cache re-solve has something to chew
  fx.db.exec(`
    INSERT INTO items (name, display) VALUES ('plate','Plate'),('ore','Ore');
    INSERT INTO recipes (name, kind, hidden) VALUES ('smelt-plate','real',0);
    INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES ('smelt-plate',0,'item','ore',1);
    INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES ('smelt-plate',0,'item','plate',1);
  `);
  fx.db.close();
  switchDatabase(fx.file);
});

afterEach(() => fx.cleanup());

const BLOCK_DATA = { goals: [{ name: "plate", rate: 1 }], recipes: ["smelt-plate"] };

/** Insert a block through the normal save path, OUTSIDE any action (untracked). */
function seedBlock(name = "Smelting") {
  return saveBlockRow(
    {
      name,
      iconKind: "item",
      iconName: "plate",
      data: BLOCK_DATA,
      electricityW: 0,
      dataFingerprint: "fp",
    },
    [{ item: "plate", kind: "item", role: "primary", rate: 1 }],
    [],
  );
}

describe("undo triggers (round-trip)", () => {
  it("inverts an INSERT: undo deletes the created row and its caches", async () => {
    const id = await withUndoAction('Create block "Smelting"', () => seedBlock());
    expect(getBlock(id)).not.toBeNull();
    expect(db.select().from(blockFlows).where(eq(blockFlows.blockId, id)).all()).toHaveLength(1);

    const res = await undoLast();
    expect(res).toEqual({ undone: 'Create block "Smelting"', changedBlockIds: [id] });
    expect(getBlock(id)).toBeNull();
    // the flow cache has no triggers — undoLast cleans it up explicitly
    expect(db.select().from(blockFlows).where(eq(blockFlows.blockId, id)).all()).toHaveLength(0);
    expect(undoStatus().depth).toBe(0);
  });

  it("inverts an UPDATE: undo restores the old values exactly (quotes and all)", async () => {
    const id = seedBlock("It's \"tricky\" — o'clock");
    const before = db.select().from(blocks).where(eq(blocks.id, id)).get()!;

    await withUndoAction("Edit block", () => {
      db.update(blocks)
        .set({ name: "Renamed", enabled: false, sortOrder: 42 })
        .where(eq(blocks.id, id))
        .run();
    });
    expect(db.select().from(blocks).where(eq(blocks.id, id)).get()!.name).toBe("Renamed");

    const res = await undoLast();
    expect(res.undone).toBe("Edit block");
    expect(res.changedBlockIds).toEqual([id]);
    const after = db.select().from(blocks).where(eq(blocks.id, id)).get()!;
    // the cache re-solve rewrites solved columns/updatedAt; the user-owned
    // fields must be byte-for-byte back
    expect(after.name).toBe(before.name);
    expect(after.enabled).toBe(before.enabled);
    expect(after.sortOrder).toBe(before.sortOrder);
    expect(after.data).toEqual(before.data);
  });

  it("inverts a DELETE: undo restores the row under its old id and rebuilds the flow cache", async () => {
    const id = seedBlock();
    await withUndoAction('Delete block "Smelting"', () => deleteBlock(id));
    expect(getBlock(id)).toBeNull();
    expect(db.select().from(blockFlows).where(eq(blockFlows.blockId, id)).all()).toHaveLength(0);

    const res = await undoLast();
    expect(res.undone).toBe('Delete block "Smelting"');
    expect(res.changedBlockIds).toEqual([id]);
    const row = getBlock(id);
    expect(row?.name).toBe("Smelting");
    expect(row?.data).toEqual(BLOCK_DATA);
    // block_flows carries no triggers, so the restore re-solved the block
    const flows = db.select().from(blockFlows).where(eq(blockFlows.blockId, id)).all();
    expect(flows.some((f) => f.item === "plate" && f.role === "primary")).toBe(true);
  });
});

describe("withUndoAction (grouping + marker)", () => {
  it("groups many row changes into ONE undo step", async () => {
    await withUndoAction("Apply plan", () => {
      db.insert(tasks).values({ title: "a" }).run();
      db.insert(tasks).values({ title: "b" }).run();
      db.insert(tasks).values({ title: "c" }).run();
    });
    expect(undoStatus()).toMatchObject({ depth: 1, top: { name: "Apply plan" } });

    await undoLast();
    expect(db.select().from(tasks).all()).toHaveLength(0);
    expect(undoStatus().depth).toBe(0);
  });

  it("a nested wrapper joins the enclosing action instead of opening a new step", async () => {
    await withUndoAction("outer", async () => {
      db.insert(tasks).values({ title: "a" }).run();
      await withUndoAction("inner", () => db.insert(tasks).values({ title: "b" }).run());
    });
    expect(undoStatus()).toMatchObject({ depth: 1, top: { name: "outer" } });
    await undoLast();
    expect(db.select().from(tasks).all()).toHaveLength(0);
  });

  it("serializes overlapping async requests into separate undo steps", async () => {
    let firstStarted!: () => void;
    let releaseFirst!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withUndoAction("first request", async () => {
      db.insert(tasks).values({ title: "first-before" }).run();
      firstStarted();
      await blocked;
      db.insert(tasks).values({ title: "first-after" }).run();
    });
    await started;

    let secondEntered = false;
    const second = withUndoAction("second request", async () => {
      secondEntered = true;
      db.insert(tasks).values({ title: "second" }).run();
    });
    await Promise.resolve();
    expect(secondEntered).toBe(false);

    releaseFirst();
    await Promise.all([first, second]);
    expect(undoStatus()).toMatchObject({ depth: 2, top: { name: "second request" } });

    expect((await undoLast()).undone).toBe("second request");
    expect(
      db
        .select()
        .from(tasks)
        .all()
        .map((t) => t.title),
    ).toEqual(["first-before", "first-after"]);
    expect((await undoLast()).undone).toBe("first request");
    expect(db.select().from(tasks).all()).toHaveLength(0);
  });

  it("fail-soft: a write that bypasses the wrapper is simply not logged", async () => {
    seedBlock();
    db.insert(tasks).values({ title: "untracked" }).run();
    expect(db.select().from(undoLog).all()).toHaveLength(0);
    expect(undoStatus().depth).toBe(0);
    expect(await undoLast()).toEqual({ undone: null, changedBlockIds: [] });
    // nothing was reverted
    expect(db.select().from(tasks).all()).toHaveLength(1);
  });

  it("{ undo: false } runs without the marker — nothing is logged", async () => {
    await withUndoAction("system", () => db.insert(tasks).values({ title: "sys" }).run(), {
      undo: false,
    });
    expect(db.select().from(undoLog).all()).toHaveLength(0);
    expect(undoStatus().depth).toBe(0);
    expect(db.select().from(undoCurrent).all()).toHaveLength(0);
  });

  it("{ undo: false } nested in a tracked action lifts the marker around the system write", async () => {
    const id = seedBlock();
    await withUndoAction("user edit", async () => {
      db.insert(tasks).values({ title: "tracked" }).run();
      await withUndoAction(
        "cache refresh",
        () => setBlockEnabled(id, false), // system write mid-action
        { undo: false },
      );
      db.insert(tasks).values({ title: "also tracked" }).run();
    });
    const res = await undoLast();
    expect(res.undone).toBe("user edit");
    // the tracked inserts were reverted…
    expect(db.select().from(tasks).all()).toHaveLength(0);
    // …but the suppressed system write was not
    expect(db.select().from(blocks).where(eq(blocks.id, id)).get()!.enabled).toBe(false);
  });

  it("an action with no writes leaves no undo step", async () => {
    await withUndoAction("noop", () => 42);
    expect(undoStatus().depth).toBe(0);
    expect(db.select().from(undoActions).all()).toHaveLength(0);
  });

  it("the marker is cleared even when the mutation throws", async () => {
    await expect(
      withUndoAction("boom", () => {
        db.insert(tasks).values({ title: "partial" }).run();
        throw new Error("kaput");
      }),
    ).rejects.toThrow("kaput");
    expect(db.select().from(undoCurrent).all()).toHaveLength(0);
    // the partial write stays logged, so it can still be undone
    expect(undoStatus()).toMatchObject({ depth: 1, top: { name: "boom" } });
    await undoLast();
    expect(db.select().from(tasks).all()).toHaveLength(0);
  });
});

describe("retention", () => {
  it(`keeps only the last ${UNDO_RETAIN} actions, trimmed on write`, async () => {
    for (let i = 0; i < UNDO_RETAIN + 5; i++) {
      await withUndoAction(`action ${i}`, () =>
        db
          .insert(tasks)
          .values({ title: `t${i}` })
          .run(),
      );
    }
    const actions = db.select().from(undoActions).all();
    expect(actions).toHaveLength(UNDO_RETAIN);
    expect(undoStatus().top?.name).toBe(`action ${UNDO_RETAIN + 4}`);
    expect(actions.some((a) => a.name === "action 0")).toBe(false);
    // no orphaned log rows for the trimmed actions
    const orphans =
      db
        .select({ n: sql<number>`count(*)` })
        .from(undoLog)
        .where(sql`action_id NOT IN (SELECT id FROM undo_actions)`)
        .get()?.n ?? 0;
    expect(orphans).toBe(0);
  });
});

describe("undoLast", () => {
  it("pops strictly from the top (linear undo) and does not re-log itself", async () => {
    await withUndoAction("first", () => db.insert(tasks).values({ title: "one" }).run());
    await withUndoAction("second", () => db.insert(tasks).values({ title: "two" }).run());

    expect((await undoLast()).undone).toBe("second");
    expect(
      db
        .select()
        .from(tasks)
        .all()
        .map((t) => t.title),
    ).toEqual(["one"]);
    // executing the undo produced no NEW undo step
    expect(undoStatus()).toMatchObject({ depth: 1, top: { name: "first" } });

    expect((await undoLast()).undone).toBe("first");
    expect(db.select().from(tasks).all()).toHaveLength(0);
    expect(undoStatus().depth).toBe(0);
  });

  it("reports every touched block id once", async () => {
    const a = seedBlock("A");
    const b = seedBlock("B");
    await withUndoAction("reorder", () => {
      db.update(blocks).set({ sortOrder: 1 }).where(eq(blocks.id, a)).run();
      db.update(blocks).set({ sortOrder: 0 }).where(eq(blocks.id, b)).run();
      db.update(blocks).set({ sortOrder: 2 }).where(eq(blocks.id, a)).run();
    });
    const res = await undoLast();
    const asc = (x: number, y: number) => x - y;
    expect([...res.changedBlockIds].sort(asc)).toEqual([a, b].sort(asc));
  });
});

describe("trigger coverage (migration drift guard)", () => {
  // If a migration adds a column to a triggered table without regenerating that
  // table's triggers, the UPDATE/DELETE inverses silently stop covering it.
  // This test fails the moment a trigger goes stale.
  const TRACKED = [
    "blocks",
    "block_groups",
    "module_presets",
    "tasks",
    "task_steps",
    "task_links",
    "notes",
  ];

  it("every tracked table has all three triggers covering all current columns", () => {
    for (const t of TRACKED) {
      const cols = db.all<{ name: string }>(sql.raw(`PRAGMA table_info(${t})`)).map((c) => c.name);
      expect(cols.length, t).toBeGreaterThan(0);
      for (const kind of ["insert", "update", "delete"]) {
        const trigger = db.get<{ sql: string } | undefined>(
          sql`SELECT sql FROM sqlite_master WHERE type='trigger' AND name=${`undo_${t}_${kind}`}`,
        );
        expect(trigger?.sql, `${t} ${kind} trigger missing`).toBeTruthy();
        if (kind === "insert") continue;
        for (const col of cols) {
          if (kind === "update" && col === "id") continue; // pk is the WHERE key
          expect(trigger!.sql, `undo_${t}_${kind} misses column ${col}`).toContain(`\`${col}\``);
        }
      }
    }
  });

  it("reference/cache tables carry no undo triggers", () => {
    const triggered = db
      .all<{ tbl_name: string }>(
        sql`SELECT DISTINCT tbl_name FROM sqlite_master WHERE type='trigger' AND name LIKE 'undo_%'`,
      )
      .map((r) => r.tbl_name)
      .sort();
    expect(triggered).toEqual([...TRACKED].sort());
  });
});
