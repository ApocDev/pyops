/**
 * Factory-level what-if solver: treat the whole factory as one block whose
 * sub-units are *blocks* instead of recipes. Each block is a fixed-ratio
 * "super-recipe" (its cached boundary flows at the current rate); the unknown is
 * the block's scale factor. We solve a small LP for the scales that satisfy every
 * demand/consumption — the required per-block rate changes for the factory.
 *
 * Why an LP and not the exact block solver: real Py factories can't balance every
 * good exactly (multi-product blocks force off-ratio surplus), so exact equality
 * is infeasible. The LP uses production >= demand (surplus allowed) and minimizes
 * total scaling, which is always feasible and matches "scale up/down to meet it".
 *
 * Report-only: it never writes; you adjust each block by hand (or ignore).
 */
import highsLoader from "highs";

export type BlockWithFlows = {
  id: number;
  name: string;
  rate: number;
  priority?: number;
  /** Full goal set. Secondary consume goals can be adjusted independently of
   * the primary rate when they absorb a surplus from another block. */
  goals?: { name: string; rate: number; stock?: boolean }[];
  /** Actual persisted flows when `flows` is a normalized probe model for an
   * idle zero-rate producer. Current totals come from these; LP coefficients
   * come from `flows`. */
  currentFlows?: { item: string; kind: string; role: string; rate: number; priority?: number }[];
  /** Current multiplier of the model row. Normal rows are at 1; a probed idle
   * row is at 0 and can be activated by the factory solve. */
  currentScale?: number;
  /** The zero-rate goal used to build a normalized model row. */
  probe?: { goal: string; rate: number };
  flows: { item: string; kind: string; role: string; rate: number; priority?: number }[];
};

type GoodClass = "raw" | "demand" | "surplus" | "intermediate";
type SupplyOffer = {
  bi: number;
  good: string;
  rate: number;
  priority: number;
  incidental: boolean;
  variable: string;
};

// Energy pseudo-goods that stay free boundaries: electricity is grid-distributed
// (balancing it would create a power feedback loop) and heat is block-local by
// game rule (it can't travel between blocks). pyops-fluid-fuel is NOT free (#115):
// a designated supplier block (one with a burn-fluid-* conversion exporting MJ)
// matches generic MJ imports block-to-block like any other good — an MJ import
// with no supplier classifies as "raw", the signal to designate one.
const FREE_GOODS = new Set(["pyops-electricity", "pyops-heat"]);

function addTo<K, V>(map: Map<K, Set<V>>, key: K, val: V) {
  let s = map.get(key);
  if (!s) map.set(key, (s = new Set<V>()));
  s.add(val);
}
function bump(map: Map<string, number>, key: string, amt: number) {
  map.set(key, (map.get(key) ?? 0) + amt);
}
const round = (n: number) => +n.toFixed(4);
/** Match Scenario's actionable/UI floor. Sub-1% goal changes are rounding
 * linearization noise, not buildable work, and repeatedly applying them can
 * destabilize an otherwise solved factory model. */
const GOAL_SCALE_EPS = 0.01;

export async function factoryWhatIf(
  blocks: BlockWithFlows[],
  demandOverrides: Record<string, number> = {},
) {
  const kindOf = new Map<string, string>();
  const producedTotal = new Map<string, number>();
  const consumedTotal = new Map<string, number>();
  const primaryProducers = new Map<string, Set<number>>();
  const anyProducers = new Map<string, Set<number>>();
  const consumers = new Map<string, Set<number>>();
  const offers: SupplyOffer[] = [];
  blocks.forEach((b, bi) => {
    for (const f of b.flows) {
      kindOf.set(f.item, f.kind);
      if (f.role === "import") {
        addTo(consumers, f.item, b.id);
        bump(consumedTotal, f.item, f.rate);
      } else {
        addTo(anyProducers, f.item, b.id);
        if (f.role === "primary" || f.role === "stock") addTo(primaryProducers, f.item, b.id);
        bump(producedTotal, f.item, f.rate);
        offers.push({
          bi,
          good: f.item,
          rate: f.rate,
          priority: f.priority ?? b.priority ?? 0,
          incidental: f.role !== "primary" && f.role !== "stock",
          variable: "",
        });
      }
    }
  });

  const goods = [...kindOf.keys()];
  // Balance the dependency chain through block PRIMARY outputs only. Byproducts are
  // free surplus at the good level — forcing them to balance blows up Py's fuel/
  // recycle loops (a byproduct consumed by a productive block, scaled to absorb,
  // overproduces that block's primary).
  const classify = (g: string): GoodClass => {
    if (FREE_GOODS.has(g)) return "raw"; // grid utility — free boundary
    const anyProd = (anyProducers.get(g)?.size ?? 0) > 0;
    if (!anyProd) return "raw"; // never produced → external input
    const isPrimary = (primaryProducers.get(g)?.size ?? 0) > 0;
    const consumed = (consumers.get(g)?.size ?? 0) > 0;
    if (isPrimary && !consumed) return "demand"; // final product → pin
    if (isPrimary && consumed) return "intermediate"; // chain link → balance
    return "surplus"; // byproduct → free at the good level
  };

  // A block is "productive" if a primary output is on the demand chain; a "sink" is a
  // dedicated consumer — off-chain AND it consumes a byproduct. We scale productive
  // blocks for demands, and sinks to soak up byproduct surplus, but never scale a
  // productive block just to consume a byproduct (that's what caused the blow-ups).
  const idToIdx = new Map(blocks.map((b, bi) => [b.id, bi]));
  const productive = blocks.map((b) =>
    b.flows.some(
      (f) =>
        (f.role === "primary" || f.role === "stock") &&
        (classify(f.item) === "demand" || classify(f.item) === "intermediate"),
    ),
  );
  const sink = blocks.map(
    (b, bi) =>
      !productive[bi] && b.flows.some((f) => f.role === "import" && classify(f.item) === "surplus"),
  );

  const demandRate = (g: string) => demandOverrides[g] ?? producedTotal.get(g) ?? 0;
  const constraints: string[] = [];
  const allocOffers = offers
    .filter((offer) => {
      const cls = classify(offer.good);
      return cls === "demand" || cls === "intermediate";
    })
    .map((offer, oi) => ({ ...offer, variable: `a${oi}` }));

  // Supply is allocated separately from block scaling. This is the critical
  // distinction for priority: an incidental output can be consumed up to the
  // amount its block naturally makes, but its allocation never makes that block
  // productive/free-to-scale on its own.
  for (const offer of allocOffers) {
    constraints.push(
      offer.incidental
        ? `r${constraints.length}: + 1 ${offer.variable} <= ${offer.rate}`
        : `r${constraints.length}: + 1 ${offer.variable} - ${offer.rate} s${offer.bi} <= 0`,
    );
  }

  // chain constraints: allocated supply covers final demand or scaled consumers
  for (const g of goods) {
    const cls = classify(g);
    if (cls !== "demand" && cls !== "intermediate") continue;
    const parts = allocOffers
      .filter((offer) => offer.good === g)
      .map((offer) => `+ 1 ${offer.variable}`);
    blocks.forEach((_, bi) => {
      const consumed = blocks[bi].flows
        .filter((flow) => flow.item === g && flow.role === "import")
        .reduce((sum, flow) => sum + flow.rate, 0);
      if (consumed > 1e-9) parts.push(`- ${consumed} s${bi}`);
    });
    if (parts.length)
      constraints.push(
        `r${constraints.length}: ${parts.join(" ")} >= ${cls === "demand" ? demandRate(g) : 0}`,
      );
  }
  // Only productive blocks (a demand/intermediate primary) are free to scale; sinks
  // and pure off-chain (power/utility) blocks are pinned at current.
  const bounds = blocks
    .map((_, bi) => (productive[bi] ? `0 <= s${bi} <= 1e7` : `1 <= s${bi} <= 1`))
    .join("\n ");
  const highs = await highsLoader();
  const allocationBounds = allocOffers.map((offer) => `0 <= ${offer.variable} <= 1e12`).join("\n ");
  const fixedTierConstraints: string[] = [];
  const solveWithObjective = (objective: string) => {
    const allConstraints = [...constraints, ...fixedTierConstraints];
    return highs.solve(
      `Minimize\n obj: ${objective}\nSubject To\n ${allConstraints.join("\n ")}\nBounds\n ${bounds}\n ${allocationBounds}\nEnd`,
    );
  };

  // Strict lexicographic tiers: minimize use of the lowest priority first, lock
  // that optimum, then continue upward. The numeric distance between tiers is
  // intentionally irrelevant; only ordering matters.
  const priorities = [...new Set(allocOffers.map((offer) => offer.priority))].sort((a, b) => a - b);
  let sol: ReturnType<typeof highs.solve> | null = null;
  for (const priority of priorities) {
    const tier = allocOffers.filter((offer) => offer.priority === priority);
    const objective = tier.map((offer) => `+ 1 ${offer.variable}`).join(" ") || "+ 0 s0";
    sol = solveWithObjective(objective);
    if (sol.Status !== "Optimal") break;
    const optimum = tier.reduce(
      (sum, offer) =>
        sum + ((sol!.Columns[offer.variable] as { Primal?: number } | undefined)?.Primal ?? 0),
      0,
    );
    // HiGHS may report an optimum a few ulps below the next model's feasible
    // boundary. Leave a tiny scale-aware allowance so repeated/re-linearized
    // What-if solves don't turn numerically infeasible.
    const tolerance = Math.max(1e-5, Math.abs(optimum) * 1e-6);
    fixedTierConstraints.push(
      `r${constraints.length + fixedTierConstraints.length}: ${objective} <= ${+(optimum + tolerance).toPrecision(12)}`,
    );
  }
  if (!sol || sol.Status === "Optimal") {
    const scaleObjective = blocks.map((_, bi) => `+ 1 s${bi}`).join(" ");
    sol = solveWithObjective(scaleObjective);
  }
  const scaleById = new Map<number, number>();
  blocks.forEach((b, bi) =>
    scaleById.set(b.id, (sol!.Columns[`s${bi}`] as { Primal?: number } | undefined)?.Primal ?? 0),
  );

  const offersPerGood = new Map<string, number>();
  for (const offer of allocOffers) bump(offersPerGood, offer.good, 1);
  const supplyAllocations = allocOffers
    .map((offer) => ({
      blockId: blocks[offer.bi].id,
      blockName: blocks[offer.bi].name,
      good: offer.good,
      kind: kindOf.get(offer.good) ?? "item",
      priority: offer.priority,
      incidental: offer.incidental,
      rate: round((sol!.Columns[offer.variable] as { Primal?: number } | undefined)?.Primal ?? 0),
    }))
    .filter(
      (allocation) =>
        allocation.rate > 1e-6 &&
        ((offersPerGood.get(allocation.good) ?? 0) > 1 ||
          allocation.priority !== 0 ||
          allocation.incidental),
    )
    .sort((a, b) => b.priority - a.priority || b.rate - a.rate);

  // projected good flows at the solved scales
  const projProduced = new Map<string, number>();
  const projConsumed = new Map<string, number>();
  for (const b of blocks) {
    const s = scaleById.get(b.id) ?? 0;
    for (const f of b.flows) {
      if (f.role === "import") bump(projConsumed, f.item, s * f.rate);
      else bump(projProduced, f.item, s * f.rate);
    }
  }

  const good = (g: string) => ({ good: g, kind: kindOf.get(g) ?? "item" });
  const blockReport = blocks
    .map((b) => {
      const scale = scaleById.get(b.id) ?? 0;
      return {
        id: b.id,
        name: b.name,
        // the block's primary good, so the UI can render energy rates as power
        good: b.flows.find((f) => f.role === "primary" || f.role === "stock")?.item ?? null,
        currentRate: round(b.rate),
        requiredRate: round(b.rate * scale),
        scale: round(scale),
        delta: round(b.rate * scale - b.rate),
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // surplus to handle = anything overproduced (no-consumer byproducts + intermediates
  // produced beyond what's consumed) — the cue to grow/route a consumer block. When a
  // dedicated sink already consumes it, suggest how far to scale that sink to absorb
  // the surplus (computed from the fixed solve, so it never feeds back into it).
  const absorbHint = (g: string) => {
    const sinkId = [...(consumers.get(g) ?? [])].find((id) => sink[idToIdx.get(id)!]);
    if (sinkId == null) return null;
    const sb = blocks[idToIdx.get(sinkId)!];
    const intake = sb.flows.find((f) => f.item === g && f.role === "import")?.rate ?? 0;
    if (intake <= 1e-9) return null;
    const surplus = (projProduced.get(g) ?? 0) - (projConsumed.get(g) ?? 0);
    return { id: sb.id, name: sb.name, scale: round(1 + surplus / intake) };
  };
  // The LP uses one scale per block internally, but the persisted/actionable
  // controls are GOALS. Translate a block scale into an explicit change for
  // every throughput goal so a multi-goal block never collapses back to its
  // first goal when the result is applied. Stock goals have their own amount +
  // window control and are not rewritten as rates here.
  const goalChangeMap = new Map<
    string,
    {
      id: number;
      name: string;
      good: string;
      kind: string;
      currentRate: number;
      requiredRate: number;
      scale: number;
      delta: number;
      goal: true;
    }
  >();
  const changeKey = (id: number, goal: string) => `${id}\u0000${goal}`;
  for (const b of blocks) {
    const scale = scaleById.get(b.id) ?? 1;
    for (const goal of b.goals ?? []) {
      if (goal.stock || Math.abs(goal.rate) <= 1e-9 || Math.abs(scale - 1) <= GOAL_SCALE_EPS)
        continue;
      const requiredRate = round(goal.rate * scale);
      goalChangeMap.set(changeKey(b.id, goal.name), {
        id: b.id,
        name: b.name,
        good: goal.name,
        kind: kindOf.get(goal.name) ?? "item",
        currentRate: round(goal.rate),
        requiredRate,
        scale: round(scale),
        delta: round(requiredRate - goal.rate),
        goal: true,
      });
    }
  }

  // A later negative goal is also an independently adjustable intake target.
  // If it already absorbs an overproduced good, add the remaining surplus to
  // that goal after accounting for any whole-block scaling above.
  const secondarySinkChange = (g: string) => {
    const surplus = (projProduced.get(g) ?? 0) - (projConsumed.get(g) ?? 0);
    if (surplus <= 1e-3) return null;
    for (const b of blocks) {
      const goal = b.goals
        ?.slice(1)
        .find((candidate) => candidate.name === g && candidate.rate < 0);
      if (!goal || !b.flows.some((f) => f.item === g && f.role === "import")) continue;
      const scaledRate = goal.rate * (scaleById.get(b.id) ?? 1);
      const requiredRate = round(scaledRate - surplus);
      return {
        id: b.id,
        name: b.name,
        good: g,
        kind: kindOf.get(g) ?? "item",
        currentRate: round(goal.rate),
        requiredRate,
        scale: round(requiredRate / goal.rate),
        delta: round(requiredRate - goal.rate),
        goal: true as const,
      };
    }
    return null;
  };
  for (const g of goods) {
    const change = secondarySinkChange(g);
    if (change) goalChangeMap.set(changeKey(change.id, change.good), change);
  }
  const goalChanges = [...goalChangeMap.values()].sort(
    (a, b) => Math.abs(b.delta) - Math.abs(a.delta),
  );
  const goalChangeByGood = new Map(goalChanges.map((change) => [change.good, change]));
  const overproduced = goods
    .map((g) => ({
      ...good(g),
      cls: classify(g),
      projected: round((projProduced.get(g) ?? 0) - (projConsumed.get(g) ?? 0)),
      absorb:
        classify(g) === "surplus"
          ? goalChangeByGood.get(g)
            ? {
                id: goalChangeByGood.get(g)!.id,
                name: goalChangeByGood.get(g)!.name,
                goalRate: goalChangeByGood.get(g)!.requiredRate,
              }
            : absorbHint(g)
          : null,
    }))
    .filter((x) => (x.cls === "surplus" || x.cls === "intermediate") && x.projected > 1e-3)
    .sort((a, b) => b.projected - a.projected);

  return {
    status: sol!.Status,
    blocks: blockReport,
    demands: goods
      .filter((g) => classify(g) === "demand")
      .map((g) => ({
        ...good(g),
        current: round(producedTotal.get(g) ?? 0),
        target: round(demandRate(g)),
      }))
      .sort((a, b) => b.target - a.target),
    raws: goods
      .filter((g) => classify(g) === "raw")
      .map((g) => ({
        ...good(g),
        current: round(consumedTotal.get(g) ?? 0),
        projected: round(projConsumed.get(g) ?? 0),
      }))
      .sort((a, b) => b.projected - a.projected),
    overproduced,
    goalChanges,
    supplyAllocations,
  };
}
