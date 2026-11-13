/**
 * Recipe-explorer grouping + ranking (#97), pure so it unit-tests in node.
 *
 * The browse page shows a good's producing/consuming recipes as ranked lists,
 * grouped by research-horizon availability. Consumers are ordered inside each
 * group by estimated economy flow (the cost-analysis LP dual — how much a
 * sensible economy actually runs the recipe), with execution cost then name as
 * ties. Producers are ordered by estimated ¥ per unit of the selected good
 * (`unitCost`), cheapest first. Recycling and void recipes sit behind a toggle
 * (`isRecyclingOrVoid`).
 */

export type ExplorerGroupId = "now" | "turd" | "research" | "off";

export const EXPLORER_GROUPS: { id: ExplorerGroupId; label: string; hint: string }[] = [
  {
    id: "now",
    label: "Available now",
    hint: "start-enabled, or unlocked within your research horizon",
  },
  {
    id: "turd",
    label: "Needs a TURD pick",
    hint: "the unlocking TURD choice is researched but not picked yet",
  },
  {
    id: "research",
    label: "Needs research",
    hint: "the unlocking technology is beyond your research horizon",
  },
  {
    id: "off",
    label: "Not obtainable",
    hint: "replaced or blocked by a different TURD choice, or nothing unlocks it",
  },
];

/** The slice of a browse-detail recipe card the grouping/ranking reads. */
export type ExplorerCard = {
  name: string;
  display: string | null;
  enabled: boolean;
  unlocks: readonly unknown[];
  avail: {
    research: "enabled" | "available" | "needs-research";
    turd: { state: "active" | "pickable" | "blocked" } | null;
  };
  superseded: object | null;
  flow: number | null;
  cost: number | null;
  /** ¥ per unit of the selected good (see `unitCost`); producers sort on it */
  unitCost?: number | null;
};

export function explorerGroup(c: ExplorerCard): ExplorerGroupId {
  // a selected TURD choice replaced it — the recipe no longer exists in-game
  if (c.superseded) return "off";
  // a DIFFERENT choice on its TURD master is locked in (needs a respec)
  if (c.avail.turd?.state === "blocked") return "off";
  // disabled and nothing unlocks it (creative/editor leftovers)
  if (!c.enabled && c.unlocks.length === 0) return "off";
  if (c.avail.research === "needs-research") return "research";
  if (c.avail.turd?.state === "pickable") return "turd";
  return "now";
}

/** Group + rank: availability tiers in fixed order. Inside each, `"flow"`
 * ranks flow-desc (recipes the cost analysis never priced sort below a
 * zero-flow one) with cost and display name as tiebreaks; `"unit-cost"` ranks
 * ¥ per unit ascending (unpriced last), then flow, then name. Empty groups are
 * dropped. */
export function groupExplorerCards<T extends ExplorerCard>(
  cards: readonly T[],
  order: "flow" | "unit-cost" = "flow",
): { id: ExplorerGroupId; label: string; hint: string; cards: T[] }[] {
  const byGroup = new Map<ExplorerGroupId, T[]>();
  for (const c of cards) {
    const g = explorerGroup(c);
    const bucket = byGroup.get(g);
    if (bucket) bucket.push(c);
    else byGroup.set(g, [c]);
  }
  const rank = (c: T) => c.flow ?? -1;
  const unit = (c: T) => c.unitCost ?? Infinity;
  for (const bucket of byGroup.values()) {
    bucket.sort(
      (a, b) =>
        (order === "unit-cost" ? unit(a) - unit(b) || rank(b) - rank(a) : rank(b) - rank(a)) ||
        (a.cost ?? Infinity) - (b.cost ?? Infinity) ||
        (a.display ?? a.name).localeCompare(b.display ?? b.name),
    );
  }
  return EXPLORER_GROUPS.flatMap((g) => {
    const bucket = byGroup.get(g.id);
    return bucket ? [{ ...g, cards: bucket }] : [];
  });
}

/** A recipe ingredient/product as the browse cards carry it. */
type Component = { name: string; amount: number; probability?: number | null };

const expected = (c: Component) => c.amount * (c.probability ?? 1);

/**
 * Estimated ¥ per unit of `good` made by one recipe, from the recipe's
 * per-craft cost (cost analysis: inputs + machine time + power).
 *
 * A recipe with several outputs splits its cost by each output's share of the
 * output value (expected amount × cost-analysis price), so the main product
 * carries most of the cost and a cheap byproduct little. With that split,
 * unitCost ÷ price(good) = 1 ÷ (1 − waste), so the part of a unit's cost above
 * the good's price is exactly the recipe's waste share. When no output has a
 * positive price the cost splits evenly across the distinct outputs.
 *
 * Null when the recipe is unpriced, the good is unpriced, or the recipe
 * doesn't make the good.
 */
export function unitCost(
  recipeCost: number | null,
  products: readonly Component[],
  good: string,
  priceOf: (name: string) => number | null | undefined,
): number | null {
  const goodPrice = priceOf(good);
  if (recipeCost == null || goodPrice == null) return null;
  const made = products.filter((p) => p.name === good).reduce((s, p) => s + expected(p), 0);
  if (made <= 0) return null;
  const value = (p: Component) => expected(p) * Math.max(0, priceOf(p.name) ?? 0);
  const total = products.reduce((s, p) => s + value(p), 0);
  const share =
    total > 0
      ? (made * Math.max(0, goodPrice)) / total
      : 1 / new Set(products.map((p) => p.name)).size;
  return (recipeCost * share) / made;
}

/** True for recipes that are noise when picking how to make or use a good:
 * recycler recipes (the `recycling` category) and voids. A void consumes a
 * single good and returns at most part of that same good, which matches Py's
 * venting, sinkholes, and incineration without naming them. */
export function isRecyclingOrVoid(c: {
  category: string | null;
  ingredients: readonly Component[];
  products: readonly Component[];
}): boolean {
  if (c.category === "recycling") return true;
  const good = c.ingredients[0]?.name;
  if (good === undefined || c.ingredients.some((i) => i.name !== good)) return false;
  if (c.products.some((p) => p.name !== good)) return false;
  const out = c.products.reduce((s, p) => s + expected(p), 0);
  return out < c.ingredients.reduce((s, i) => s + i.amount, 0);
}
