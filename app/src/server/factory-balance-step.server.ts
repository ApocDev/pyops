import type { BlockWithFlows } from "./factory-solve.server.ts";

const EPS = 1e-6;
const CHANGE_EPS = 0.01;
const FREE_GOODS = new Set(["pyops-electricity", "pyops-heat"]);
const round = (value: number) => +value.toFixed(4);

type GoalChange = {
  id: number;
  name: string;
  good: string;
  kind: string;
  currentRate: number;
  requiredRate: number;
  scale: number;
  delta: number;
  goal: true;
  activation?: true;
};

/** One YAFC-style factory balancing pass. Terminal positive goals stay fixed;
 * intermediate producer goals move to current downstream demand, and negative
 * goals move to absorb incidental surplus. The caller re-solves changed blocks
 * and invokes another pass until these direct mismatches settle. */
export function factoryBalanceStep(
  blocks: BlockWithFlows[],
  demandOverrides: Record<string, number> = {},
) {
  const kindOf = new Map<string, string>();
  const produced = new Map<string, number>();
  const consumed = new Map<string, number>();
  const incidental = new Map<string, number>();
  const producers = new Map<string, { block: BlockWithFlows; priority: number }[]>();
  const sinks = new Map<string, { block: BlockWithFlows; rate: number }[]>();

  const bump = (map: Map<string, number>, good: string, amount: number) =>
    map.set(good, (map.get(good) ?? 0) + amount);
  const actualFlows = (block: BlockWithFlows) => block.currentFlows ?? block.flows;

  for (const block of blocks) {
    for (const flow of actualFlows(block)) {
      kindOf.set(flow.item, flow.kind);
      if (flow.role === "import") bump(consumed, flow.item, flow.rate);
      else {
        bump(produced, flow.item, flow.rate);
        if (flow.role !== "primary" && flow.role !== "stock")
          bump(incidental, flow.item, flow.rate);
      }
    }
    for (const goal of block.goals ?? []) {
      kindOf.set(goal.name, block.flows.find((flow) => flow.item === goal.name)?.kind ?? "item");
      const availableProducer =
        goal.rate > EPS ||
        (block.probe?.goal === goal.name && block.flows.some((flow) => flow.item === goal.name));
      if (availableProducer && !goal.stock && !FREE_GOODS.has(goal.name)) {
        const priority =
          block.flows.find(
            (flow) => flow.item === goal.name && (flow.role === "primary" || flow.role === "stock"),
          )?.priority ??
          block.priority ??
          0;
        const list = producers.get(goal.name) ?? [];
        list.push({ block, priority });
        producers.set(goal.name, list);
      } else if (goal.rate < 0) {
        const list = sinks.get(goal.name) ?? [];
        list.push({ block, rate: -goal.rate });
        sinks.set(goal.name, list);
      }
    }
  }

  const terminalGoods = new Set(
    [...producers.keys()].filter((good) => (consumed.get(good) ?? 0) <= EPS),
  );
  const requiredByGood = new Map<string, number>();
  for (const good of producers.keys()) {
    requiredByGood.set(
      good,
      terminalGoods.has(good)
        ? (demandOverrides[good] ?? produced.get(good) ?? 0)
        : Math.max(0, (consumed.get(good) ?? 0) - (incidental.get(good) ?? 0)),
    );
  }

  const goalChanges: GoalChange[] = [];
  const supplyAllocations: {
    blockId: number;
    blockName: string;
    good: string;
    kind: string;
    priority: number;
    incidental: boolean;
    rate: number;
  }[] = [];
  const addChange = (block: BlockWithFlows, good: string, requiredRate: number) => {
    const goal = block.goals?.find((candidate) => candidate.name === good);
    if (!goal) return;
    const delta = requiredRate - goal.rate;
    const relative = Math.abs(goal.rate) > EPS ? Math.abs(delta / goal.rate) : Math.abs(delta);
    if (Math.abs(delta) <= EPS || relative <= CHANGE_EPS) return;
    const activation = Math.abs(goal.rate) <= EPS && Math.abs(requiredRate) > EPS;
    goalChanges.push({
      id: block.id,
      name: block.name,
      good,
      kind: kindOf.get(good) ?? "item",
      currentRate: round(goal.rate),
      requiredRate: round(requiredRate),
      scale: round(Math.abs(goal.rate) > EPS ? requiredRate / goal.rate : requiredRate),
      delta: round(delta),
      goal: true,
      ...(activation ? { activation: true as const } : {}),
    });
  };

  // Allocate each required produced good to the highest-priority tier. Within
  // one tier preserve the user's current split; if every provider is idle, the
  // first configured provider becomes the starter row.
  for (const [good, offers] of producers) {
    const required = requiredByGood.get(good) ?? 0;
    const pinnedTerminal = terminalGoods.has(good) && demandOverrides[good] == null;
    const topPriority = Math.max(...offers.map((offer) => offer.priority));
    const activeTier = offers.filter((offer) => offer.priority === topPriority);
    const tierCurrent = activeTier.reduce(
      (sum, offer) =>
        sum + Math.max(0, offer.block.goals?.find((goal) => goal.name === good)?.rate ?? 0),
      0,
    );
    for (const offer of offers) {
      const current = Math.max(0, offer.block.goals?.find((goal) => goal.name === good)?.rate ?? 0);
      const allocation = pinnedTerminal
        ? current
        : offer.priority !== topPriority
          ? 0
          : tierCurrent > EPS
            ? required * (current / tierCurrent)
            : offer === activeTier[0]
              ? required
              : 0;
      addChange(offer.block, good, allocation);
      if (allocation > EPS && (offers.length > 1 || offer.priority !== 0))
        supplyAllocations.push({
          blockId: offer.block.id,
          blockName: offer.block.name,
          good,
          kind: kindOf.get(good) ?? "item",
          priority: offer.priority,
          incidental: false,
          rate: round(allocation),
        });
    }
  }

  // A byproduct-only good has no production goal to resize. Its explicit
  // consume goal is the adjustable boundary, distributed across existing sinks.
  for (const [good, entries] of sinks) {
    if (producers.has(good)) continue;
    const available = incidental.get(good) ?? 0;
    if (available <= EPS) continue;
    const current = entries.reduce((sum, entry) => sum + entry.rate, 0);
    entries.forEach((entry, index) => {
      const allocation =
        current > EPS ? available * (entry.rate / current) : index === 0 ? available : 0;
      addChange(entry.block, good, -allocation);
    });
  }

  const projectedScale = new Map<number, number>();
  for (const block of blocks) {
    const primary = block.goals?.[0];
    const change =
      primary &&
      goalChanges.find((candidate) => candidate.id === block.id && candidate.good === primary.name);
    projectedScale.set(
      block.id,
      change
        ? Math.abs(primary!.rate) > EPS
          ? change.requiredRate / primary!.rate
          : change.requiredRate
        : 1,
    );
  }
  const projectedProduced = new Map<string, number>();
  const projectedConsumed = new Map<string, number>();
  for (const block of blocks) {
    const scale = projectedScale.get(block.id) ?? 1;
    for (const flow of actualFlows(block))
      bump(
        flow.role === "import" ? projectedConsumed : projectedProduced,
        flow.item,
        flow.rate * scale,
      );
  }

  const goods = new Set([...kindOf.keys(), ...produced.keys(), ...consumed.keys()]);
  const raws = [...goods]
    .filter((good) => FREE_GOODS.has(good) || !producers.has(good))
    .map((good) => ({
      good,
      kind: kindOf.get(good) ?? "item",
      current: round(
        FREE_GOODS.has(good)
          ? (consumed.get(good) ?? 0)
          : Math.max(0, (consumed.get(good) ?? 0) - (produced.get(good) ?? 0)),
      ),
      projected: round(
        FREE_GOODS.has(good)
          ? (projectedConsumed.get(good) ?? 0)
          : Math.max(0, (projectedConsumed.get(good) ?? 0) - (projectedProduced.get(good) ?? 0)),
      ),
    }))
    .filter((good) => good.current > EPS || good.projected > EPS)
    .sort((a, b) => b.projected - a.projected);
  const sinkChangeByGood = new Map(
    goalChanges.filter((change) => change.requiredRate < 0).map((change) => [change.good, change]),
  );
  const overproduced = [...goods]
    .map((good) => ({
      good,
      kind: kindOf.get(good) ?? "item",
      cls: producers.has(good) ? ("intermediate" as const) : ("surplus" as const),
      projected: round((projectedProduced.get(good) ?? 0) - (projectedConsumed.get(good) ?? 0)),
      absorb: sinkChangeByGood.has(good)
        ? {
            id: sinkChangeByGood.get(good)!.id,
            name: sinkChangeByGood.get(good)!.name,
            goalRate: sinkChangeByGood.get(good)!.requiredRate,
          }
        : null,
    }))
    .filter((flow) => flow.projected > 1e-3 && (incidental.get(flow.good) ?? 0) > EPS)
    .sort((a, b) => b.projected - a.projected);

  return {
    status: "Optimal" as const,
    blocks: blocks.map((block) => {
      const primary = block.goals?.[0];
      const change = primary
        ? goalChanges.find(
            (candidate) => candidate.id === block.id && candidate.good === primary.name,
          )
        : undefined;
      return {
        id: block.id,
        name: block.name,
        good: primary?.name ?? null,
        currentRate: round(block.rate),
        requiredRate: change?.requiredRate ?? round(block.rate),
        scale: change?.scale ?? 1,
        delta: change?.delta ?? 0,
      };
    }),
    demands: [...terminalGoods]
      .map((good) => ({
        good,
        kind: kindOf.get(good) ?? "item",
        current: round(produced.get(good) ?? 0),
        target: round(requiredByGood.get(good) ?? 0),
      }))
      .sort((a, b) => b.target - a.target),
    raws,
    overproduced,
    goalChanges: goalChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
    supplyAllocations: supplyAllocations.sort((a, b) => b.priority - a.priority || b.rate - a.rate),
  };
}
