/**
 * Server functions for the undo system (#90). Thin wrappers over
 * undo.server.ts — server-only modules are referenced only inside `.handler()`
 * bodies, so they never reach the client bundle. The hotkey/UI layer consumes
 * these: `undoStatusFn` drives the "Undo: <action>" affordance, `undoLastFn`
 * performs the undo and returns which blocks changed so open editors can
 * rehydrate.
 */
import { createServerFn } from "@tanstack/react-start";

import { undoLast, undoStatus } from "./undo.server.ts";

export type { UndoResult, UndoStatus } from "./undo.server.ts";

/** Top-of-stack action (what the next undo reverts) + stack depth. */
export const undoStatusFn = createServerFn({ method: "GET" }).handler(async () => undoStatus());

/** Revert the most recent user action. Returns `{ undone, changedBlockIds }`;
 * `undone` is null when there was nothing to undo. */
export const undoLastFn = createServerFn({ method: "POST" }).handler(async () => undoLast());
