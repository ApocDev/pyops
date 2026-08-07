/**
 * Graph layout state: hand-placed block positions on the factory board
 * (Connections → Board) and hand-placed node positions inside one block's Flow
 * view. Cosmetic only — deliberately OUTSIDE the undo system (no
 * `withUndoAction`, so the inverse-log triggers never see these writes) and
 * leaves `updated_at` alone: dragging a node is not a planning edit.
 */
import { eq } from "drizzle-orm";

import { db } from "../db/index.server.ts";
import { blocks } from "../db/schema.ts";

export type BoardPosition = { id: number; x: number | null; y: number | null };

/** Persist board positions for a set of blocks. `x`/`y` null clears a block
 * back to auto-layout (used by "auto-arrange"). */
export function setBlockBoardPositions(positions: BoardPosition[]): void {
  if (positions.length === 0) return;
  db.transaction((tx) => {
    for (const p of positions) {
      tx.update(blocks).set({ boardX: p.x, boardY: p.y }).where(eq(blocks.id, p.id)).run();
    }
  });
}

export type FlowNodePositions = Record<string, { x: number; y: number }>;

/** Merge hand-placed Flow-view node positions for one block. `positions` are
 * the nodes that moved; `liveIds` is every node id in the current solve, used
 * to prune entries for recipes/goods the block no longer contains. Passing an
 * empty `positions` with `reset: true` clears the block back to auto-layout. */
export function setBlockFlowPositions(
  blockId: number,
  positions: FlowNodePositions,
  opts: { liveIds?: string[]; reset?: boolean } = {},
): void {
  if (opts.reset) {
    db.update(blocks).set({ flowPositions: null }).where(eq(blocks.id, blockId)).run();
    return;
  }
  const row = db
    .select({ flowPositions: blocks.flowPositions })
    .from(blocks)
    .where(eq(blocks.id, blockId))
    .get();
  const merged: FlowNodePositions = { ...row?.flowPositions, ...positions };
  if (opts.liveIds) {
    const live = new Set(opts.liveIds);
    for (const id of Object.keys(merged)) if (!live.has(id)) delete merged[id];
  }
  db.update(blocks)
    .set({ flowPositions: Object.keys(merged).length ? merged : null })
    .where(eq(blocks.id, blockId))
    .run();
}
