/**
 * Undo execution (#90) — server-only. Multi-level undo for planning edits,
 * built on the sqlite.org/undoredo.html trigger pattern: the AFTER triggers in
 * drizzle/0004_undo_log.sql write the INVERSE statement of every row change
 * into `undo_log` while the current-action marker is set (see
 * undo-action.server.ts for the `withUndoAction` wrapper that sets it).
 *
 * - `undoLast()` executes the top action's inverse statements in one
 *   transaction WITHOUT re-logging (it runs under `{ undo: false }`), then
 *   re-solves the affected blocks through the existing computeBlock/
 *   persistBlock machinery so the untracked caches (block_flows/
 *   block_machines, power/status columns) stay consistent.
 * - Linear undo only: strictly top-of-stack. Redo can come later.
 * - The log is per project db like everything else.
 */
import { desc, eq, sql } from "drizzle-orm";

import { db } from "../db/index.server.ts";
import { blockFlows, blockMachines, undoActions, undoLog } from "../db/schema.ts";
import * as q from "../db/queries.server.ts";
import { computeBlock, persistBlock, type SolveInput } from "./block-compute.server.ts";
import { withUndoAction } from "./undo-action.server.ts";

export { UNDO_RETAIN, withUndoAction, type UndoOpts } from "./undo-action.server.ts";

export type UndoStatus = {
  /** How many undo steps are on the stack. */
  depth: number;
  /** The action the next undo will revert (top of the stack), if any. */
  top: { id: number; name: string; at: number | null } | null;
};

/** Top-of-stack description + stack depth, for the undo affordance. */
export function undoStatus(): UndoStatus {
  const depth =
    db
      .select({ n: sql<number>`count(*)` })
      .from(undoActions)
      .get()?.n ?? 0;
  const top = db.select().from(undoActions).orderBy(desc(undoActions.id)).limit(1).get() ?? null;
  return {
    depth,
    top: top
      ? {
          id: top.id,
          name: top.name,
          at: top.createdAt ? Math.floor(top.createdAt.getTime() / 1000) : null,
        }
      : null,
  };
}

export type UndoResult = {
  /** Name of the reverted action, or null when the stack was empty. */
  undone: string | null;
  /** Blocks whose rows the undo touched — the client refetches these and
   * rehydrates any open editor showing one of them. */
  changedBlockIds: number[];
};

/**
 * Revert the top undo action: execute its inverse statements (newest change
 * first) in one transaction, remove the action from the stack, then bring the
 * untracked solve caches back in line — a restored/changed block is re-solved
 * and re-persisted; a block the undo removed gets its cached flows/machines
 * deleted. Runs entirely under `{ undo: false }`, so nothing re-logs.
 */
export async function undoLast(): Promise<UndoResult> {
  return withUndoAction(
    "undo",
    async () => {
      const top = db.select().from(undoActions).orderBy(desc(undoActions.id)).limit(1).get();
      if (!top) return { undone: null, changedBlockIds: [] };
      const entries = db
        .select()
        .from(undoLog)
        .where(eq(undoLog.actionId, top.id))
        .orderBy(desc(undoLog.id))
        .all();
      const changedBlockIds = [
        ...new Set(entries.filter((e) => e.tbl === "blocks").map((e) => e.rowId)),
      ];
      db.transaction((tx) => {
        for (const e of entries) tx.run(sql.raw(e.stmt));
        tx.delete(undoLog).where(eq(undoLog.actionId, top.id)).run();
        tx.delete(undoActions).where(eq(undoActions.id, top.id)).run();
      });
      // Cache consistency: block_flows/block_machines and the solved columns
      // carry no triggers, so the undo left them stale for the touched blocks.
      for (const id of changedBlockIds) {
        const row = q.getBlock(id);
        if (row) {
          const data = row.data as SolveInput;
          const r = await computeBlock(data);
          await persistBlock(
            { id: row.id, name: row.name, iconKind: row.iconKind, iconName: row.iconName },
            data,
            r,
          );
        } else {
          // the undo deleted this block (inverse of a create) — drop its caches
          db.delete(blockFlows).where(eq(blockFlows.blockId, id)).run();
          db.delete(blockMachines).where(eq(blockMachines.blockId, id)).run();
        }
      }
      return { undone: top.name, changedBlockIds };
    },
    { undo: false },
  );
}
