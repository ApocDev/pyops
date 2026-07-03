/**
 * Block snapshots (#85) — capture, list, restore, and retention. Server-only.
 *
 * A snapshot is a block's full definition (name/icon/enabled + the editor doc)
 * frozen as a row in `block_snapshots`, using the SAME doc serialization as the
 * export envelope (#82). Two kinds:
 *
 *  - "manual": the user's named restore points, kept until deleted.
 *  - "auto": taken silently before destructive/structural writes (block delete,
 *    restore, scale-to-demand/assistant resize, and — throttled — ordinary
 *    editor saves), capped at the newest `AUTO_RETAIN` per block.
 *
 * Snapshot bookkeeping is NOT a planning edit: `block_snapshots` carries no
 * undo triggers (#90), and every write here still runs under
 * `withUndoAction(…, { undo: false })` so a capture inside a tracked action can
 * never pollute the user's undo step. The one tracked write is `restoreSnapshot`
 * — it rewrites the block through the normal persist machinery as ONE undoable
 * action, so a restore itself can be undone.
 *
 * Rows survive block deletion on purpose (a recycle bin for deleted blocks).
 */
import { desc, eq, sql } from "drizzle-orm";

import { db } from "../db/index.server.ts";
import { blockSnapshots, type BlockData } from "../db/schema.ts";
import * as q from "../db/queries.server.ts";
import { goalNames, normalizeBlockData } from "../lib/goals";
import {
  blockUpdatedAt,
  computeBlock,
  persistBlock,
  type SolveInput,
} from "./block-compute.server.ts";
import { withUndoAction } from "./undo-action.server.ts";

/** How many automatic snapshots to keep per block (manual ones are kept). */
export const AUTO_RETAIN = 20;

/** Throttle window for capture-on-save (seconds): while the user is editing,
 * an automatic restore point is taken at most this often per block. */
export const AUTO_MIN_GAP_S = 600;

export type CaptureOpts = {
  kind: "manual" | "auto";
  /** the user's label (manual) or what triggered the capture (auto) */
  label?: string;
  /** editor-save path: skip when the block's newest snapshot is younger than
   * `AUTO_MIN_GAP_S` — one restore point per editing burst, not per keystroke */
  throttle?: boolean;
};

function latestSnapshot(blockId: number) {
  return (
    db
      .select()
      .from(blockSnapshots)
      .where(eq(blockSnapshots.blockId, blockId))
      .orderBy(desc(blockSnapshots.id))
      .limit(1)
      .get() ?? null
  );
}

/** The comparable content of a snapshot/block state (dedup key). */
const contentKey = (s: {
  name: string;
  iconKind: string | null;
  iconName: string | null;
  enabled: boolean;
  data: BlockData;
}) => JSON.stringify([s.name, s.iconKind, s.iconName, s.enabled, normalizeBlockData(s.data)]);

/**
 * Freeze the block's CURRENT stored state as a snapshot row. Returns the new
 * snapshot id, or null when nothing was captured: the block doesn't exist, an
 * automatic capture would duplicate the newest snapshot (the restore point
 * already exists), or the throttle window hasn't elapsed. Manual captures
 * always insert — a user asking for a named point gets one.
 */
export async function captureSnapshot(blockId: number, opts: CaptureOpts): Promise<number | null> {
  const row = q.getBlock(blockId);
  if (!row) return null;
  const latest = latestSnapshot(blockId);
  if (opts.kind === "auto" && latest) {
    if (opts.throttle && latest.createdAt) {
      const age = Date.now() / 1000 - latest.createdAt.getTime() / 1000;
      if (age < AUTO_MIN_GAP_S) return null;
    }
    if (contentKey(latest) === contentKey(row)) return null; // restore point already exists
  }
  // bookkeeping, not a planning edit — never on the undo stack (#90)
  return withUndoAction(
    "snapshot bookkeeping",
    () => {
      const id = db
        .insert(blockSnapshots)
        .values({
          blockId,
          kind: opts.kind,
          label: opts.label?.trim() || null,
          name: row.name,
          iconKind: row.iconKind,
          iconName: row.iconName,
          enabled: row.enabled,
          data: row.data,
        })
        .returning({ id: blockSnapshots.id })
        .get().id;
      pruneAutoSnapshots(blockId);
      return id;
    },
    { undo: false },
  );
}

/** Keep only the newest `AUTO_RETAIN` automatic snapshots of a block; manual
 * snapshots are never pruned. */
export function pruneAutoSnapshots(blockId: number) {
  db.run(sql`
    DELETE FROM block_snapshots
    WHERE block_id = ${blockId} AND kind = 'auto' AND id NOT IN (
      SELECT id FROM block_snapshots
      WHERE block_id = ${blockId} AND kind = 'auto'
      ORDER BY id DESC LIMIT ${AUTO_RETAIN}
    )
  `);
}

export type SnapshotMeta = {
  id: number;
  kind: "manual" | "auto";
  label: string | null;
  name: string;
  createdAt: number | null; // epoch seconds
  goalCount: number;
  recipeCount: number;
};

/** A block's snapshots, newest first, with cheap doc summaries for the list. */
export function listSnapshots(blockId: number): SnapshotMeta[] {
  return db
    .select()
    .from(blockSnapshots)
    .where(eq(blockSnapshots.blockId, blockId))
    .orderBy(desc(blockSnapshots.id))
    .all()
    .map((s) => {
      const doc = normalizeBlockData(s.data);
      return {
        id: s.id,
        kind: s.kind as "manual" | "auto",
        label: s.label,
        name: s.name,
        createdAt: s.createdAt ? Math.floor(s.createdAt.getTime() / 1000) : null,
        goalCount: goalNames(doc).length,
        recipeCount: doc.recipes?.length ?? 0,
      };
    });
}

export function getSnapshot(id: number) {
  return db.select().from(blockSnapshots).where(eq(blockSnapshots.id, id)).get() ?? null;
}

export async function deleteSnapshot(id: number) {
  await withUndoAction(
    "snapshot bookkeeping",
    () => db.delete(blockSnapshots).where(eq(blockSnapshots.id, id)).run(),
    { undo: false },
  );
}

export type RestoreResult =
  | {
      ok: true;
      name: string;
      enabled: boolean;
      doc: BlockData;
      updatedAt: number | null;
    }
  | { ok: false; error: string };

/**
 * Replace a block's definition with a snapshot's. The current state is
 * auto-snapshotted first ("before restore"), so a restore is itself restorable;
 * the write runs through the normal solve+persist machinery as ONE tracked
 * undo action, so it's also undoable (#90). Identity (id, folder, sort order)
 * is preserved — only the definition (name/icon/enabled/doc) changes.
 */
export async function restoreSnapshot(blockId: number, snapshotId: number): Promise<RestoreResult> {
  const snap = getSnapshot(snapshotId);
  if (!snap || snap.blockId !== blockId) return { ok: false, error: "snapshot not found" };
  const row = q.getBlock(blockId);
  if (!row) return { ok: false, error: "the block no longer exists" };

  await captureSnapshot(blockId, { kind: "auto", label: "before restore" });

  const doc = normalizeBlockData(snap.data) as SolveInput;
  const r = await computeBlock(doc); // a broken doc persists with its cache kept — same degrade path as saves
  await withUndoAction(`Restore snapshot of "${snap.name}"`, async () => {
    await persistBlock(
      { id: blockId, name: snap.name, iconKind: snap.iconKind, iconName: snap.iconName },
      doc,
      r,
    );
    if (row.enabled !== snap.enabled) q.setBlockEnabled(blockId, snap.enabled);
  });
  return {
    ok: true,
    name: snap.name,
    enabled: snap.enabled,
    doc,
    updatedAt: blockUpdatedAt(blockId),
  };
}
