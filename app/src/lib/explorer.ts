/**
 * Recipe-explorer grouping + ranking (#97), pure so it unit-tests in node.
 *
 * The browse page shows a good's producing/consuming recipes as ranked lists:
 * grouped by research-horizon availability, and ordered inside each group by
 * estimated economy flow (the cost-analysis LP dual — how much a sensible
 * economy actually runs the recipe), with execution cost then name as ties.
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

/** Group + rank: availability tiers in fixed order, flow-desc inside each
 * (recipes the cost analysis never priced sort below a zero-flow one), cost
 * and display name as tiebreaks. Empty groups are dropped. */
export function groupExplorerCards<T extends ExplorerCard>(
  cards: readonly T[],
): { id: ExplorerGroupId; label: string; hint: string; cards: T[] }[] {
  const byGroup = new Map<ExplorerGroupId, T[]>();
  for (const c of cards) {
    const g = explorerGroup(c);
    const bucket = byGroup.get(g);
    if (bucket) bucket.push(c);
    else byGroup.set(g, [c]);
  }
  const rank = (c: T) => c.flow ?? -1;
  for (const bucket of byGroup.values()) {
    bucket.sort(
      (a, b) =>
        rank(b) - rank(a) ||
        (a.cost ?? Infinity) - (b.cost ?? Infinity) ||
        (a.display ?? a.name).localeCompare(b.display ?? b.name),
    );
  }
  return EXPLORER_GROUPS.flatMap((g) => {
    const bucket = byGroup.get(g.id);
    return bucket ? [{ ...g, cards: bucket }] : [];
  });
}
