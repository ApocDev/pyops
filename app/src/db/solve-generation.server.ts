/**
 * SQLite-owned validity generation for materialized block solve projections.
 *
 * `block_flows`, `block_machines`, and the solved columns on `blocks` are
 * projections of user input plus global solver context (research/TURDs/reference
 * data). A monotonically increasing value in `meta` lets readers tell whether a
 * persisted projection belongs to the current context without maintaining an
 * application cache or an invalidation registry.
 */
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "./index.server.ts";
import { meta } from "./schema.ts";

const KEY = "solve_projection_generation";
const RESOLVED_KEY = "solve_projection_resolved_generation";
const VERSION_KEY = "solve_projection_version";
const CURRENT_VERSION = "sv4";
const INITIAL_GENERATION = 1;

function parseGeneration(value: string | null | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= INITIAL_GENERATION ? parsed : INITIAL_GENERATION;
}

function parseResolvedGeneration(value: string | null | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= INITIAL_GENERATION ? parsed : 0;
}

/** Current project generation. Missing values deliberately read as 1 so old
 * databases need no eager migration; their unstamped block fingerprints are
 * detected as stale on first read. */
export function currentSolveGeneration(): number {
  const value = db.select({ value: meta.value }).from(meta).where(eq(meta.key, KEY)).get()?.value;
  return parseGeneration(value);
}

/** Advance the generation atomically in SQLite and return the new value. */
export function bumpSolveGeneration(): number {
  const row = db
    .insert(meta)
    // A missing row conceptually reads as generation 1, so its first bump is 2.
    .values({ key: KEY, value: String(INITIAL_GENERATION + 1) })
    .onConflictDoUpdate({
      target: meta.key,
      set: { value: sql`CAST(${meta.value} AS INTEGER) + 1` },
    })
    .returning({ value: meta.value })
    .get();
  return parseGeneration(row.value);
}

/** Whether the current generation has not yet completed its refresh pass. A
 * separate SQLite marker makes crash recovery cheap without repeatedly trying
 * known-broken blocks whose last-good projections intentionally stay stale. */
export function solveGenerationNeedsRefresh(): boolean {
  const values = new Map(
    db
      .select({ key: meta.key, value: meta.value })
      .from(meta)
      .where(inArray(meta.key, [KEY, RESOLVED_KEY, VERSION_KEY]))
      .all()
      .map((row) => [row.key, row.value]),
  );
  return (
    parseResolvedGeneration(values.get(RESOLVED_KEY)) !== parseGeneration(values.get(KEY)) ||
    values.get(VERSION_KEY) !== CURRENT_VERSION
  );
}

/** Whether a software upgrade changed how materialized block projections are
 * computed. Unlike a context generation bump, this invalidates every solvable
 * block even when its generation stamp is otherwise current. */
export function solveProjectionVersionNeedsRefresh(): boolean {
  return (
    db.select({ value: meta.value }).from(meta).where(eq(meta.key, VERSION_KEY)).get()?.value !==
    CURRENT_VERSION
  );
}

/** Record that all solvable blocks for `generation` were refreshed. */
export function markSolveGenerationResolved(generation = currentSolveGeneration()): void {
  db.transaction((tx) => {
    tx.insert(meta)
      .values({ key: RESOLVED_KEY, value: String(generation) })
      .onConflictDoUpdate({ target: meta.key, set: { value: String(generation) } })
      .run();
    tx.insert(meta)
      .values({ key: VERSION_KEY, value: CURRENT_VERSION })
      .onConflictDoUpdate({ target: meta.key, set: { value: CURRENT_VERSION } })
      .run();
  });
}

/** Prefix a content fingerprint with the generation it was solved under. */
export function stampSolveFingerprint(contentFingerprint: string): string {
  return `g${currentSolveGeneration()}:${contentFingerprint}`;
}

/** Cheap projection-validity check. Legacy fingerprints have no generation
 * prefix and therefore correctly read stale once this mechanism is installed. */
export function isCurrentSolveFingerprint(fingerprint: string | null | undefined): boolean {
  return isSolveFingerprintForGeneration(fingerprint, currentSolveGeneration());
}

/** Batch-read form: callers that check many blocks load the generation once. */
export function isSolveFingerprintForGeneration(
  fingerprint: string | null | undefined,
  generation: number,
): boolean {
  return fingerprint?.startsWith(`g${generation}:`) ?? false;
}
