/**
 * The undo mutation wrapper (#90) — server-only. Every mutating server-fn path
 * that touches the user-planning tables (blocks, block_groups, module_presets,
 * tasks, task_steps, task_links, notes) runs through `withUndoAction`, which
 * opens one undo action + the trigger marker, runs the mutation, and closes it.
 * The AFTER-triggers in drizzle/0004_undo_log.sql log the inverse of every row
 * change into `undo_log` while the marker is set — see undo.server.ts for the
 * undo execution side.
 *
 * Split from undo.server.ts so block-compute.server.ts can wrap its system
 * re-solves without an import cycle (undo.server.ts imports block-compute for
 * the post-undo cache re-solve).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { eq, sql } from "drizzle-orm";

import { db } from "../db/index.server.ts";
import { undoActions, undoCurrent, undoLog } from "../db/schema.ts";

/** How many undo steps (user actions) to keep, trimmed on write. */
export const UNDO_RETAIN = 50;

export type UndoOpts = {
  /** `false` = system write: run without the marker so nothing is logged. */
  undo?: boolean;
};

/** Request-local nesting state. The marker itself remains SQLite-owned; this
 * only distinguishes a genuinely nested call from a second async request. */
type Active = { kind: "action"; actionId: number } | { kind: "suppressed" };
const actionContext = new AsyncLocalStorage<Active>();

/** SQLite's undo_current marker is deliberately a single row, so root actions
 * must not overlap. Server handlers can interleave whenever `fn` awaits (solver,
 * bridge, snapshots), despite better-sqlite3 calls themselves being synchronous.
 * Serialize only mutation scopes; this queue carries no application data. */
let mutationTail: Promise<void> = Promise.resolve();
async function serializeMutation<T>(fn: () => Promise<T>): Promise<T> {
  const previous = mutationTail;
  let release!: () => void;
  mutationTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

function setMarker(actionId: number) {
  db.run(sql`DELETE FROM undo_current`);
  db.insert(undoCurrent).values({ id: 1, actionId }).run();
}

function clearMarker() {
  db.run(sql`DELETE FROM undo_current`);
}

/** Close an action: drop it if nothing was logged (a no-op action must not
 * become an undo step), else trim the stack to the retention window. */
function finalizeAction(actionId: number) {
  const logged =
    db
      .select({ n: sql<number>`count(*)` })
      .from(undoLog)
      .where(eq(undoLog.actionId, actionId))
      .get()?.n ?? 0;
  if (logged === 0) {
    db.delete(undoActions).where(eq(undoActions.id, actionId)).run();
    return;
  }
  db.run(
    sql`DELETE FROM undo_actions WHERE id NOT IN (SELECT id FROM undo_actions ORDER BY id DESC LIMIT ${UNDO_RETAIN})`,
  );
  db.run(sql`DELETE FROM undo_log WHERE action_id NOT IN (SELECT id FROM undo_actions)`);
}

/**
 * Run `fn` as one undoable user action named `name`: open an action + the
 * trigger marker, run, close. Every row change the triggers see lands in that
 * single action, so "apply this plan" (dozens of rows) pops as ONE undo.
 *
 * Tracking is opt-out: system writes (dump-import scaffolding, cache
 * re-solves, snapshot internals, undo execution itself) pass `{ undo: false }`
 * and run with the marker cleared — nothing is logged. A write that bypasses
 * the wrapper entirely is likewise simply untracked (fail-soft), because the
 * triggers only fire while the marker row exists.
 *
 * Nesting: an inner `withUndoAction` joins the enclosing action (it opens no
 * new step). The one exception is an explicit `{ undo: false }` inside a
 * tracked action — the marker is lifted around it so system writes (e.g. a
 * cache re-solve) never pollute the user's undo step, then restored.
 */
export async function withUndoAction<T>(
  name: string,
  fn: () => T | Promise<T>,
  opts: UndoOpts = {},
): Promise<T> {
  const active = actionContext.getStore();
  if (active) {
    if (opts.undo === false && active.kind === "action") {
      clearMarker();
      try {
        return await actionContext.run({ kind: "suppressed" }, fn);
      } finally {
        setMarker(active.actionId);
      }
    }
    return await fn(); // joins the enclosing action/suppression
  }
  return serializeMutation(async () => {
    if (opts.undo === false) {
      clearMarker(); // defensively drop a stale marker (crash mid-action)
      return actionContext.run({ kind: "suppressed" }, fn);
    }
    const actionId = db
      .insert(undoActions)
      .values({ name })
      .returning({ id: undoActions.id })
      .get().id;
    setMarker(actionId);
    try {
      return await actionContext.run({ kind: "action", actionId }, fn);
    } finally {
      clearMarker();
      finalizeAction(actionId);
    }
  });
}
