/**
 * Factory-board layout state (Connections → Board): hand-placed block positions.
 * Cosmetic only — deliberately OUTSIDE the undo system (no `withUndoAction`, so
 * the inverse-log triggers never see these writes) and leaves `updated_at`
 * alone: dragging a node around the board is not a planning edit.
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
