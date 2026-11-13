/**
 * Apply an assistant `reviseBlock` / plan-`updates` proposal to a saved block:
 * change any of its goals by name (or, as `rate`, its first goal — what a
 * proposal saved before named goal changes carries) and/or replace its recipe
 * set, re-solve, and
 * persist as ONE undoable action (with a snapshot restore point first). The
 * preview (`buildBlockUpdate` in agent-tools) uses the same `withGoalChanges`
 * and `withRecipeSet`, so what the card shows is what gets saved.
 */
import * as q from "../db/queries.server.ts";
import { withRecipeSet } from "../lib/block-doc.ts";
import {
  type GoalChange,
  normalizeBlockData,
  requestedGoalChanges,
  withGoalChanges,
} from "../lib/goals.ts";
import { computeBlock, persistBlock, type SolveInput } from "./block-compute.server.ts";
import { captureSnapshot } from "./snapshots.server.ts";
import { withUndoAction } from "./undo-action.server.ts";

export type BlockUpdateRequest = {
  blockId: number;
  rate?: number;
  goals?: GoalChange[];
  recipes?: string[];
};

export async function applyBlockUpdate({
  blockId,
  rate,
  goals,
  recipes,
}: BlockUpdateRequest): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = q.getBlock(blockId);
  if (!row) return { ok: false, error: `block #${blockId} no longer exists` };
  let input = normalizeBlockData(row.data as SolveInput) as SolveInput;
  if (recipes) input = withRecipeSet(input, recipes);
  const changes = requestedGoalChanges(input, rate, goals);
  if (changes.length) {
    const changed = withGoalChanges(input, changes);
    if ("error" in changed) return { ok: false, error: changed.error };
    input = changed.data;
  }
  const r = await computeBlock(input);
  if (r.broken) return { ok: false, error: "the revised block failed to solve" };
  await captureSnapshot(blockId, {
    kind: "auto",
    label: recipes ? "before recipe change" : "before resize",
  });
  await withUndoAction(recipes ? `Change "${row.name}" recipes` : `Resize "${row.name}"`, () =>
    persistBlock(
      { id: row.id, name: row.name, iconKind: row.iconKind, iconName: row.iconName },
      input,
      r,
    ),
  );
  return { ok: true };
}
