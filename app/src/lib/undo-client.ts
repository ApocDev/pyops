/**
 * Client-side undo runner (#90) — the ONE path every undo trigger goes
 * through: Ctrl+Z (undo-hotkey), the nav affordance (undo-button), and the
 * command palette all call `runUndo`. It pops the server's undo stack, toasts
 * what happened, refreshes every query family the planning tables feed, and
 * pushes the reverted doc into any OPEN block editor so its auto-save can't
 * write the pre-undo state right back.
 */
import type { QueryClient } from "@tanstack/react-query";

import { openBlockEditor } from "./block-editors";
import { toast } from "./toast-store";
import { undoToastMessage } from "./undo-names";
import { loadBlockFn } from "../server/factorio";
import { undoLastFn } from "../server/undo";

/** Query families invalidated after an undo — everything the triggered
 * planning tables (blocks, groups, presets, tasks/steps/links, notes) feed. */
const UNDO_QUERY_KEYS = [
  ["blocks"],
  ["block"],
  ["blocksForGood"],
  ["factory"],
  ["factoryTotals"],
  ["coherence"],
  ["groups"],
  ["modulePresets"],
  ["tasks"],
  ["task"],
  ["notes"],
  ["undoStatus"],
] as const;

/** A block row's `updatedAt` as epoch seconds, however the wire delivered it. */
export function epochSeconds(at: Date | string | null | undefined): number | null {
  if (at == null) return null;
  const ms = at instanceof Date ? at.getTime() : new Date(at).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

let inFlight = false;

/**
 * Revert the last action. Serialized: a held-down Ctrl+Z (key repeat) or a
 * double-click can't fire overlapping undos — extra triggers while one is in
 * flight are dropped, and the next keypress pops the next action.
 */
export async function runUndo(qc: QueryClient): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await undoLastFn();
    toast({ message: undoToastMessage(res.undone) });
    if (!res.undone) return;
    // Open editors first, so a stale doc is replaced before anything else
    // (e.g. a refetch-triggered render) can interact with it.
    for (const id of res.changedBlockIds) {
      const editor = openBlockEditor(id);
      if (!editor) continue;
      const row = await loadBlockFn({ data: id });
      if (row) editor.hydrate(row.data, row.name, epochSeconds(row.updatedAt));
      else editor.onDeleted(); // the undo reverted this block's creation
    }
    await Promise.all(
      UNDO_QUERY_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey: [...queryKey] })),
    );
  } catch {
    toast({ message: "Undo failed — nothing was changed.", tone: "destructive" });
  } finally {
    inFlight = false;
  }
}
