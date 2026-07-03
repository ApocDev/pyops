/**
 * Server functions for block snapshots (#85). The db-touching logic lives in
 * snapshots.server.ts and is referenced only inside `.handler()` bodies, so the
 * Start compiler prunes it from the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";

import * as q from "../db/queries.server.ts";
import { diffBlockDocs, diffRefNames } from "../lib/block-diff";
import { normalizeBlockData } from "../lib/goals";
import type { SolveInput } from "./block-compute.server.ts";
import * as snap from "./snapshots.server.ts";

export type { SnapshotMeta } from "./snapshots.server.ts";

/** A block's snapshots, newest first (auto + manual, with doc summaries). */
export const listSnapshotsFn = createServerFn({ method: "GET" })
  .validator((blockId: number) => blockId)
  .handler(async ({ data }) => snap.listSnapshots(data));

/** Freeze the block's current SAVED state as a manual snapshot (kept until
 * deleted). Callers flush any pending editor save first, so the row matches
 * what's on screen. */
export const createSnapshotFn = createServerFn({ method: "POST" })
  .validator((d: { blockId: number; label?: string }) => d)
  .handler(async ({ data }) => ({
    id: await snap.captureSnapshot(data.blockId, { kind: "manual", label: data.label }),
  }));

export const deleteSnapshotFn = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .handler(async ({ data }) => {
    await snap.deleteSnapshot(data);
    return { ok: true };
  });

/** Replace the block's definition with a snapshot's (auto-snapshotting the
 * current state first; the write is one undoable action). Returns the restored
 * doc + face so the open editor can rehydrate. */
export const restoreSnapshotFn = createServerFn({ method: "POST" })
  .validator((d: { blockId: number; snapshotId: number }) => d)
  .handler(async ({ data }) => snap.restoreSnapshot(data.blockId, data.snapshotId));

/** Diff a snapshot against the CURRENT editor doc (passed by the client, so
 * unsaved edits count): what changed since the snapshot, plus display names +
 * kinds for every internal name the diff mentions. */
export const snapshotDiffFn = createServerFn({ method: "POST" })
  .validator((d: { snapshotId: number; current: SolveInput }) => d)
  .handler(async ({ data }) => {
    const s = snap.getSnapshot(data.snapshotId);
    if (!s) return null;
    const diff = diffBlockDocs(normalizeBlockData(s.data), normalizeBlockData(data.current));
    // Recipes and goods resolve through separate namespaces (#113): a recipe
    // named after its product (recipe `coal-gas` vs fluid `coal-gas`) must show
    // its OWN display string, so recipe refs classify recipe-first.
    const names = diffRefNames(diff);
    const refs: Record<string, { kind: "item" | "fluid" | "recipe"; display: string }> = {};
    for (const name of names.goods) {
      const c = q.classifyRef(name);
      if (c) refs[name] = c;
    }
    const recipeRefs: Record<string, { kind: "item" | "fluid" | "recipe"; display: string }> = {};
    for (const name of names.recipes) {
      const c = q.classifyRef(name, "recipe");
      if (c) recipeRefs[name] = c;
    }
    return { snapshotName: s.name, diff, refs, recipeRefs };
  });
