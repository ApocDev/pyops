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
import { campaignGoalRate, normalizeCampaign } from "./campaign.ts";

/** A block doc as it may exist on disk: the current `goals` shape, the legacy
 * single-`target` shape, or an interim `goals` with nullable rates (older co-product
 * goals, now dropped to byproducts). */
export type RawBlockData = Partial<Omit<BlockData, "goals">> & {
  target?: string;
  rate?: number;
  extraGoals?: string[];
  goals?: Array<Omit<Goal, "rate"> & { rate: number | null }>;
};

/** Migrate a possibly-legacy block doc to the `goals` shape. Idempotent: a doc that
 * already has well-formed `goals` is returned with the legacy fields stripped. */
export function normalizeBlockData<T extends RawBlockData>(d: T): BlockData {
  // extraGoals is intentionally dropped (legacy unpinned co-products → byproducts).
  const { target, rate, extraGoals: _extraGoals, goals, campaign: rawCampaign, ...rest } = d;
  if (Array.isArray(goals)) {
    // Drop any rate-less goals (old "unpinned co-products") — they're byproducts now.
    const kept = goals.filter((g): g is Goal => !!g.name && g.rate != null);
    const campaign = normalizeCampaign(rawCampaign, kept);
    if (campaign) {
      const campaignGoals = kept.map((goal) => {
        const {
          stock: _stock,
          window: _window,
          factoryRate: _factoryRate,
          unit: _unit,
          ...plainGoal
        } = goal;
        return { ...plainGoal, rate: campaignGoalRate(campaign, goal) };
      });
      return { ...(rest as object), campaign, goals: campaignGoals } as BlockData;
    }
    const stockGoals = kept.map((g) => {
      if (g.stock == null) return g;
      const window = g.window ?? STOCK_WINDOW_DEFAULT;
      return { ...g, window, rate: Math.max(g.stock / window, g.factoryRate ?? 0) };
    });
    return { ...(rest as object), goals: stockGoals } as BlockData;
  }
  const next: Goal[] = [];
  if (target) next.push({ name: target, rate: rate ?? 1 });
  const campaign = normalizeCampaign(rawCampaign, next);
  const campaignGoals = campaign
    ? next.map((goal) => ({ ...goal, rate: campaignGoalRate(campaign, goal) }))
    : next;
  // legacy `extraGoals` carried no rate, so they were never solver constraints —
  // they become plain byproducts (dropped from the goal list).
  return {
    ...(rest as object),
    ...(campaign ? { campaign } : {}),
    goals: campaignGoals,
  } as BlockData;
}

/** Default stock-goal refill window (#38), seconds: rebuild the buffer in 10 min. */
export const STOCK_WINDOW_DEFAULT = 600;

/** The first goal (names the block + sizing anchor), or undefined for an empty block. */
export const primaryGoal = (d: { goals?: Goal[] }): Goal | undefined => d.goals?.[0];

/** A zero rate has no sign, so retain the last explicit goal intent separately. */
export const goalDirection = (goal: Pick<Goal, "rate" | "direction">) =>
  goal.rate < 0 ? "consume" : goal.rate > 0 ? "produce" : (goal.direction ?? "produce");

export const goalConsumes = (goal: Pick<Goal, "rate" | "direction">): boolean =>
  goalDirection(goal) === "consume";

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
 * scale-to-demand / revise-rate paths, which resize a block by its anchor goal).
 * A stock goal's `stock` is kept consistent with its derived rate (#38), so
 * external re-rating scales the buffer rather than silently detaching it. */
export function withPrimaryRate<T extends { goals?: Goal[] }>(d: T, rate: number): T {
  const goals = (d.goals ?? []).map((g, i) =>
    i === 0
      ? {
          ...g,
          rate,
          ...(rate === 0 ? { direction: goalDirection(g) } : { direction: undefined }),
          ...(g.stock != null
            ? { stock: rate * (g.window ?? STOCK_WINDOW_DEFAULT), factoryRate: undefined }
            : {}),
        }
      : g,
  );
  return { ...d, goals };
}
