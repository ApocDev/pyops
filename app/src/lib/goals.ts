/**
 * Block goals: a block declares one or more output goals, each with a target rate
 * (#36). Every goal is a solver target — the block is sized so that good comes out
 * at exactly its rate. If a set of goals can't be jointly satisfied (e.g. two goods
 * locked to a fixed ratio by one recipe), the block is simply infeasible and the
 * solver says so; the fix is the user's (add a recipe, or change a rate). A good you
 * don't target isn't a goal — it falls out as a byproduct (export) or import.
 *
 * `goals[0]` names the block + picks its default icon, and the rate-scaling tools
 * (revise / scale-to-demand) resize the block by it.
 *
 * Pure module — no db, no Factorio API — so it's unit-testable and usable from both
 * the server and the React editor. `normalizeBlockData` migrates the old
 * `{ target, rate, extraGoals }` shape on read so existing saved blocks keep working
 * without a destructive rewrite (a save persists the new shape going forward).
 */
import type { BlockData, Goal } from "../db/schema.ts";

/** A block doc as it may exist on disk: the current `goals` shape, the legacy
 * single-`target` shape, or an interim `goals` with nullable rates (older co-product
 * goals, now dropped to byproducts). */
export type RawBlockData = Partial<Omit<BlockData, "goals">> & {
  target?: string;
  rate?: number;
  extraGoals?: string[];
  goals?: Array<{ name: string; rate: number | null }>;
};

/** Migrate a possibly-legacy block doc to the `goals` shape. Idempotent: a doc that
 * already has well-formed `goals` is returned with the legacy fields stripped. */
export function normalizeBlockData<T extends RawBlockData>(d: T): BlockData {
  // extraGoals is intentionally dropped (legacy unpinned co-products → byproducts).
  const { target, rate, extraGoals: _extraGoals, goals, ...rest } = d;
  if (Array.isArray(goals)) {
    // Drop any rate-less goals (old "unpinned co-products") — they're byproducts now.
    const kept = goals.filter((g): g is Goal => !!g.name && g.rate != null);
    return { ...(rest as object), goals: kept } as BlockData;
  }
  const next: Goal[] = [];
  if (target) next.push({ name: target, rate: rate ?? 1 });
  // legacy `extraGoals` carried no rate, so they were never solver constraints —
  // they become plain byproducts (dropped from the goal list).
  return { ...(rest as object), goals: next } as BlockData;
}

/** The first goal (names the block + sizing anchor), or undefined for an empty block. */
export const primaryGoal = (d: { goals?: Goal[] }): Goal | undefined => d.goals?.[0];

/** Every goal's good name, in order, de-duplicated and non-empty. */
export const goalNames = (d: { goals?: Goal[] }): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of d.goals ?? []) {
    if (g.name && !seen.has(g.name)) {
      seen.add(g.name);
      out.push(g.name);
    }
  }
  return out;
};

/** The first goal's rate (1 if absent) — the figure the rate-scaling tools treat as
 * "the block's rate". */
export const primaryRate = (d: { goals?: Goal[] }): number => primaryGoal(d)?.rate ?? 1;

/** Return a copy of the doc with the first goal re-rated (used by the
 * scale-to-demand / revise-rate paths, which resize a block by its anchor goal). */
export function withPrimaryRate<T extends { goals?: Goal[] }>(d: T, rate: number): T {
  const goals = (d.goals ?? []).map((g, i) => (i === 0 ? { ...g, rate } : g));
  return { ...d, goals };
}
