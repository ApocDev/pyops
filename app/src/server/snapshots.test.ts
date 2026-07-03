/**
 * Block snapshots (#85): capture (dedup + throttle), retention, restore (with
 * the pre-restore auto snapshot and undoability), and survival of block
 * deletion. Runs against a real migrated temp db (test-helpers), same as the
 * undo suite.
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { db, switchDatabase } from "../db/index.server.ts";
import { blockSnapshots, blocks } from "../db/schema.ts";
import { deleteBlock, getBlock, saveBlockRow, setBlockEnabled } from "../db/queries.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { withUndoAction } from "./undo-action.server.ts";
import { undoLast, undoStatus } from "./undo.server.ts";
import {
  AUTO_RETAIN,
  captureSnapshot,
  listSnapshots,
  pruneAutoSnapshots,
  restoreSnapshot,
} from "./snapshots.server.ts";

let fx: TestDb;

beforeEach(async () => {
  fx = await makeTestDb();
  // minimal reference data so restore's re-solve has something to chew
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

const DOC = (rate: number) => ({ goals: [{ name: "plate", rate }], recipes: ["smelt-plate"] });

function seedBlock(rate = 1, name = "Smelting") {
  return saveBlockRow(
    {
      name,
      iconKind: "item",
      iconName: "plate",
      data: DOC(rate),
      electricityW: 0,
      dataFingerprint: "fp",
    },
    [{ item: "plate", kind: "item", role: "primary", rate }],
    [],
  );
}

/** Re-rate the block directly (the content change between snapshots). */
function rerate(id: number, rate: number) {
  saveBlockRow(
    {
      id,
      name: "Smelting",
      iconKind: "item",
      iconName: "plate",
      data: DOC(rate),
      electricityW: 0,
      dataFingerprint: "fp",
    },
    null,
    null,
  );
}

/** Backdate a snapshot so the capture throttle window has elapsed. */
function age(snapshotId: number, seconds: number) {
  db.run(
    sql`UPDATE block_snapshots SET created_at = created_at - ${seconds} WHERE id = ${snapshotId}`,
  );
}

describe("captureSnapshot", () => {
  it("freezes the block's stored definition (face + doc, export-shaped)", async () => {
    const id = seedBlock(2);
    const snapId = await captureSnapshot(id, { kind: "manual", label: "before refactor" });
    expect(snapId).not.toBeNull();
    const row = db.select().from(blockSnapshots).where(eq(blockSnapshots.id, snapId!)).get()!;
    expect(row).toMatchObject({
      blockId: id,
      kind: "manual",
      label: "before refactor",
      name: "Smelting",
      iconKind: "item",
      iconName: "plate",
      enabled: true,
    });
    expect(row.data).toEqual(DOC(2));
  });

  it("auto capture dedups against the newest snapshot (the restore point exists)", async () => {
    const id = seedBlock();
    expect(await captureSnapshot(id, { kind: "auto", label: "before delete" })).not.toBeNull();
    expect(await captureSnapshot(id, { kind: "auto", label: "before delete" })).toBeNull();
    expect(listSnapshots(id)).toHaveLength(1);
    // content changed → a new auto snapshot is taken again
    rerate(id, 5);
    expect(await captureSnapshot(id, { kind: "auto", label: "before delete" })).not.toBeNull();
    expect(listSnapshots(id)).toHaveLength(2);
  });

  it("manual capture always inserts, even when identical", async () => {
    const id = seedBlock();
    await captureSnapshot(id, { kind: "manual" });
    await captureSnapshot(id, { kind: "manual", label: "again" });
    expect(listSnapshots(id)).toHaveLength(2);
  });

  it("throttled capture skips inside the gap and resumes after it", async () => {
    const id = seedBlock();
    const first = await captureSnapshot(id, { kind: "auto", label: "before edit", throttle: true });
    expect(first).not.toBeNull();
    rerate(id, 2);
    // newest snapshot is fresh → throttled capture skips even though content changed
    expect(
      await captureSnapshot(id, { kind: "auto", label: "before edit", throttle: true }),
    ).toBeNull();
    // …but an unthrottled structural capture still goes through
    expect(await captureSnapshot(id, { kind: "auto", label: "before delete" })).not.toBeNull();
    rerate(id, 3);
    for (const s of listSnapshots(id)) age(s.id, 3600);
    expect(
      await captureSnapshot(id, { kind: "auto", label: "before edit", throttle: true }),
    ).not.toBeNull();
  });

  it("returns null for a block that doesn't exist", async () => {
    expect(await captureSnapshot(9999, { kind: "auto" })).toBeNull();
  });

  it("snapshot bookkeeping never lands on the undo stack", async () => {
    const id = seedBlock();
    await captureSnapshot(id, { kind: "manual" });
    expect(undoStatus().depth).toBe(0);
    // …even when captured inside a tracked action (the delete path)
    await withUndoAction("Delete block", async () => {
      await captureSnapshot(id, { kind: "auto", label: "inside" });
      deleteBlock(id);
    });
    expect(undoStatus()).toMatchObject({ depth: 1, top: { name: "Delete block" } });
  });
});

describe("retention", () => {
  it(`keeps the newest ${AUTO_RETAIN} auto snapshots; manual ones survive`, async () => {
    const id = seedBlock();
    const manualId = await captureSnapshot(id, { kind: "manual", label: "keep me" });
    for (let i = 0; i < AUTO_RETAIN + 5; i++) {
      rerate(id, i + 2);
      await captureSnapshot(id, { kind: "auto", label: "before edit" });
    }
    const all = listSnapshots(id);
    expect(all.filter((s) => s.kind === "auto")).toHaveLength(AUTO_RETAIN);
    expect(all.some((s) => s.id === manualId)).toBe(true);
    // the survivors are the NEWEST autos
    const autoIds = all.filter((s) => s.kind === "auto").map((s) => s.id);
    expect(Math.min(...autoIds)).toBeGreaterThan(manualId!);
  });

  it("pruning one block leaves another block's snapshots alone", async () => {
    const a = seedBlock(1, "A");
    const b = seedBlock(1, "B");
    await captureSnapshot(a, { kind: "auto" });
    await captureSnapshot(b, { kind: "auto" });
    pruneAutoSnapshots(a);
    expect(listSnapshots(b)).toHaveLength(1);
  });
});

describe("listSnapshots", () => {
  it("returns newest-first metadata with doc summaries", async () => {
    const id = seedBlock(1);
    await captureSnapshot(id, { kind: "manual", label: "one" });
    rerate(id, 2);
    await captureSnapshot(id, { kind: "manual", label: "two" });
    const list = listSnapshots(id);
    expect(list.map((s) => s.label)).toEqual(["two", "one"]);
    expect(list[0]).toMatchObject({ name: "Smelting", goalCount: 1, recipeCount: 1 });
    expect(list[0].createdAt).toBeGreaterThan(0);
  });
});

describe("restoreSnapshot", () => {
  it("replaces the definition, auto-snapshots the pre-restore state, and is undoable", async () => {
    const id = seedBlock(1);
    const snapId = (await captureSnapshot(id, { kind: "manual", label: "good state" }))!;
    rerate(id, 9);
    setBlockEnabled(id, false);

    const res = await restoreSnapshot(id, snapId);
    expect(res).toMatchObject({ ok: true, name: "Smelting", enabled: true });
    const row = getBlock(id)!;
    expect(row.data).toEqual(DOC(1));
    expect(row.enabled).toBe(true);

    // the pre-restore state was frozen first (rate 9, disabled)
    const before = listSnapshots(id).find((s) => s.label === "before restore");
    expect(before).toBeTruthy();
    const beforeRow = db
      .select()
      .from(blockSnapshots)
      .where(eq(blockSnapshots.id, before!.id))
      .get()!;
    expect(beforeRow.data).toEqual(DOC(9));
    expect(beforeRow.enabled).toBe(false);

    // the restore is ONE tracked undo step; undoing it brings the edits back
    expect(undoStatus().top?.name).toBe('Restore snapshot of "Smelting"');
    await undoLast();
    const back = getBlock(id)!;
    expect(back.data).toEqual(DOC(9));
    expect(back.enabled).toBe(false);
  });

  it("rejects a snapshot of a different block or a missing block", async () => {
    const a = seedBlock(1, "A");
    const b = seedBlock(1, "B");
    const snapA = (await captureSnapshot(a, { kind: "manual" }))!;
    expect(await restoreSnapshot(b, snapA)).toMatchObject({ ok: false });
    expect(await restoreSnapshot(a, 9999)).toMatchObject({ ok: false });
    deleteBlock(a);
    expect(await restoreSnapshot(a, snapA)).toMatchObject({ ok: false });
  });

  it("snapshots survive block deletion (recycle bin)", async () => {
    const id = seedBlock();
    await captureSnapshot(id, { kind: "manual", label: "keep" });
    db.delete(blocks).where(eq(blocks.id, id)).run();
    expect(listSnapshots(id)).toHaveLength(1);
  });
});
