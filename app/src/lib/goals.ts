/**
 * Block goals: a block declares one or more output goals, each with a target rate
 * (#36). Every goal is a solver target — the block is sized so that good comes out
 * at exactly its rate. If a set of goals can't be jointly satisfied (e.g. two goods
 * locked to a fixed ratio by one recipe), the block is simply infeasible and the
 * solver says so; the fix is the user's (add a recipe, or change a rate). A good you
 * don't target isn't a goal — it falls out as a byproduct (export) or import.
 *
 * `goals[0]` names the block + picks its default icon, and scale-to-demand resizes
 * the block by it. The assistant's resize names the goals it changes
 * (`withGoalChanges`).
 *
 * Pure module — no db, no Factorio API — so it's unit-testable and usable from both
 * the server and the React editor. `normalizeBlockData` migrates the old
 * `{ target, rate, extraGoals }` shape on read so existing saved blocks keep working
 * without a destructive rewrite (a save persists the new shape going forward).
 */
import type { BlockData, Goal } from "../db/schema.ts";
import { campaignGoalRate, normalizeCampaign } from "./campaign.ts";
import { formatQty, formatRate } from "./format.ts";

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

/** Re-rate one goal. A stock goal's `stock` is kept consistent with its derived
 * rate (#38), so external re-rating scales the buffer rather than silently
 * detaching it. */
function rerateGoal(g: Goal, rate: number): Goal {
  return {
    ...g,
    rate,
    ...(rate === 0 ? { direction: goalDirection(g) } : { direction: undefined }),
    ...(g.stock != null
      ? { stock: rate * (g.window ?? STOCK_WINDOW_DEFAULT), factoryRate: undefined }
      : {}),
  };
}

/** Return a copy of the doc with the first goal re-rated (used by the
 * scale-to-demand path, which resizes a block by its anchor goal). */
export function withPrimaryRate<T extends { goals?: Goal[] }>(d: T, rate: number): T {
  const goals = (d.goals ?? []).map((g, i) => (i === 0 ? rerateGoal(g, rate) : g));
  return { ...d, goals };
}

/** A change to one EXISTING goal, matched by good name (plus `temperature` when
 * the block has the same fluid at several temperatures): a new throughput
 * `rate`, or a new keep-in-stock `stock` and/or refill `window` (seconds). */
export type GoalChange = {
  name: string;
  temperature?: number;
  /** Prefer the goal at this position while it still has this name and exactly
   * this temperature (absent = a goal with none): the top-level `rate`
   * shorthand's first goal, or the goal a proposal previewed. Otherwise the
   * change matches by name and temperature as usual. */
  index?: number;
  rate?: number;
  stock?: number;
  window?: number;
};

/** The changes a resize request means: a top-level `rate` re-rates the FIRST
 * goal by position (so it never depends on name matching), then the named
 * `goals`. */
export function requestedGoalChanges(
  d: { goals?: Goal[] },
  rate: number | undefined,
  goals: GoalChange[] = [],
): GoalChange[] {
  const first = primaryGoal(d);
  const byPosition = first && {
    name: first.name,
    ...(first.temperature != null ? { temperature: first.temperature } : {}),
    index: 0,
  };
  return [...(rate != null && byPosition ? [{ ...byPosition, rate }] : []), ...goals];
}

/** A goal as errors name it: "steam at 500°", or just "steam" with no temperature. */
const goalLabel = (g: Pick<Goal, "name" | "temperature">) =>
  g.temperature == null ? g.name : `${g.name} at ${g.temperature}°`;

/** A goal's values as a resize proposal shows them. */
export type GoalValue = Pick<Goal, "rate" | "stock" | "window">;

/** A goal's target as text: "2.5/s", or "keep 80 (refill 10m)" for a stock goal. */
export function formatGoalValue({ rate, stock, window }: GoalValue): string {
  if (stock == null) return formatRate(rate);
  const w = window ?? STOCK_WINDOW_DEFAULT;
  return `keep ${formatQty(stock)} (refill ${w >= 3600 ? `${w / 3600}h` : `${w / 60}m`})`;
}

/** One goal's before/after values in a resize proposal. */
export type GoalChangeDiff = {
  name: string;
  temperature?: number;
  /** The goal's position, so Apply hits the goal the preview changed even when
   * two goals share a name and temperature. Absent in older saved drafts. */
  index?: number;
  display: string;
  before: GoalValue;
  after: GoalValue;
};

/** The change that applies a proposal's final value for one goal. */
export const goalChangeRequest = ({
  name,
  temperature,
  index,
  after,
}: GoalChangeDiff): GoalChange => ({
  name,
  ...(temperature != null ? { temperature } : {}),
  ...(index != null ? { index } : {}),
  ...(after.stock != null ? { stock: after.stock, window: after.window } : { rate: after.rate }),
});

/** Apply several goal changes at once (the assistant's resize path). Goals that
 * aren't named keep their values. A `rate` on a stock goal scales its buffer
 * like `withPrimaryRate`; a `stock`/`window` change re-derives the rate as
 * stock/window. Returns an error naming the problem instead of guessing when a
 * change is unknown, ambiguous, repeated, or contradictory. A change without
 * `temperature` matches a unique name, or else the one same-name goal with no
 * temperature; it is ambiguous when several goals share the name and none or
 * several of them lack a temperature. `indexes` gives each
 * change's goal position, in order. */
export function withGoalChanges<T extends { goals?: Goal[] }>(
  d: T,
  changes: GoalChange[],
): { data: T; indexes: number[] } | { error: string } {
  const goals = [...(d.goals ?? [])];
  const indexes: number[] = [];
  const allGoals = goals.map(goalLabel).join(", ") || "none";
  for (const c of changes) {
    const named = goals.flatMap((g, i) => (g.name === c.name ? [i] : []));
    // no temperature: a unique name, else the one goal whose temperature is unset
    const unqualified = named.filter((i) => goals[i].temperature == null);
    // a position is a hint: used while that goal still has the same name and
    // temperature (no temperature counts as a value, not a wildcard)
    const atIndex = named.filter(
      (i) => i === c.index && (goals[i].temperature ?? null) === (c.temperature ?? null),
    );
    const matches =
      atIndex.length > 0
        ? atIndex
        : c.temperature != null
          ? named.filter((i) => goals[i].temperature === c.temperature)
          : named.length > 1 && unqualified.length === 1
            ? unqualified
            : named;
    if (matches.length === 0) {
      return { error: `"${goalLabel(c)}" is not a goal of this block (its goals: ${allGoals})` };
    }
    if (matches.length > 1) {
      return {
        error: `"${c.name}" matches several goals (${matches.map((i) => goalLabel(goals[i])).join(", ")}) — pass \`temperature\` to pick one`,
      };
    }
    const [i] = matches;
    if (indexes.includes(i)) {
      return { error: `goal "${goalLabel(goals[i])}" is changed twice — change it once` };
    }
    indexes.push(i);
    const g = goals[i];
    if (c.rate != null && (c.stock != null || c.window != null)) {
      return { error: `goal "${c.name}": give either \`rate\` or \`stock\`/\`window\`, not both` };
    }
    if (c.rate != null) {
      goals[i] = rerateGoal(g, c.rate);
    } else if (c.stock != null || c.window != null) {
      const stock = c.stock ?? g.stock;
      if (stock == null) {
        return {
          error: `goal "${c.name}" is a rate goal — \`window\` needs a \`stock\` amount too`,
        };
      }
      const window = c.window ?? g.window ?? STOCK_WINDOW_DEFAULT;
      goals[i] = {
        ...g,
        stock,
        window,
        rate: stock / window,
        direction: undefined,
        factoryRate: undefined,
      };
    } else {
      return { error: `goal "${c.name}": pass a new \`rate\`, \`stock\`, or \`window\`` };
    }
  }
  return { data: { ...d, goals }, indexes };
}
