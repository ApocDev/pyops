import * as q from "../db/queries.server.ts";
import { normalizeBlockData, primaryRate } from "../lib/goals.ts";
import { boundaryFlows, computeBlock, goalFlows, type SolveInput } from "./block-compute.server.ts";
import type { BlockWithFlows } from "./factory-solve.server.ts";
import { factoryBalanceStep } from "./factory-balance-step.server.ts";

type PersistedBlock = ReturnType<typeof q.blocksWithFlows>[number];

/** Build the factory balance row for one block. An idle block with a zero primary
 * goal has no useful persisted coefficients, so solve it at 1/s without saving
 * and use that normalized projection as an available row at current scale 0. */
export async function withFactoryModel(
  block: PersistedBlock,
  doc: SolveInput,
): Promise<BlockWithFlows> {
  const goal = doc.goals[0];
  if (
    !goal ||
    Math.abs(primaryRate(doc)) > 1e-9 ||
    goal.stock != null ||
    (doc.recipes?.length ?? 0) === 0
  )
    return block;

  const probeDoc: SolveInput = {
    ...doc,
    goals: doc.goals.map((candidate, index) =>
      index === 0 ? { ...candidate, rate: 1 } : candidate,
    ),
  };
  const result = await computeBlock(probeDoc);
  if (result.broken || result.status !== "solved" || result.unmade?.includes(goal.name))
    return block;

  const blockPriority = doc.supplyPriority ?? 0;
  const flows = boundaryFlows(goalFlows(probeDoc), result).map((flow) => ({
    ...flow,
    priority: doc.supplyPriorities?.[flow.item] ?? blockPriority,
  }));
  return {
    ...block,
    currentFlows: block.flows,
    currentScale: 0,
    probe: { goal: goal.name, rate: 1 },
    flows,
  };
}

/** Run the YAFC-style goal-adjust/re-solve loop entirely in memory for Scenario.
 * The returned work list compares persisted starting goals with the settled
 * preview, so the confirmation matches what Balance factory will actually do. */
export async function previewFactoryBalance(demandOverrides: Record<string, number> = {}) {
  const base = q
    .blocksWithFlows()
    .map((block) => {
      const row = q.getBlock(block.id);
      if (!row) return null;
      const doc = structuredClone(normalizeBlockData(row.data as SolveInput)) as SolveInput;
      return {
        block,
        doc,
        flows: block.flows,
        startGoals: new Map(doc.goals.map((goal) => [goal.name, goal.rate])),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const models = () =>
    Promise.all(
      base.map((entry) =>
        withFactoryModel(
          {
            ...entry.block,
            rate: primaryRate(entry.doc),
            goals: entry.doc.goals.map((goal) => ({
              name: goal.name,
              rate: goal.rate,
              ...(goal.stock != null ? { stock: true } : {}),
            })),
            flows: entry.flows,
          },
          entry.doc,
        ),
      ),
    );

  const initialModels = await models();
  const initial = factoryBalanceStep(initialModels, demandOverrides);
  let currentModels = initialModels;
  let settled = initial;
  let failed = false;
  let passes = 0;
  for (; passes < 15 && settled.goalChanges.length > 0; passes++) {
    const changedIds = new Set<number>();
    const previous = new Map(
      base.map((entry) => [
        entry.block.id,
        { doc: structuredClone(entry.doc), flows: entry.flows },
      ]),
    );
    for (const change of settled.goalChanges) {
      const entry = base.find((candidate) => candidate.block.id === change.id);
      if (!entry) continue;
      entry.doc = {
        ...entry.doc,
        goals: entry.doc.goals.map((goal) =>
          goal.name === change.good ? { ...goal, rate: change.requiredRate } : goal,
        ),
      };
      changedIds.add(change.id);
    }
    for (const id of changedIds) {
      const entry = base.find((candidate) => candidate.block.id === id)!;
      const result = await computeBlock(entry.doc);
      if (!result.broken && result.status === "solved") {
        const priority = entry.doc.supplyPriority ?? 0;
        entry.flows = boundaryFlows(goalFlows(entry.doc), result).map((flow) => ({
          ...flow,
          priority: entry.doc.supplyPriorities?.[flow.item] ?? priority,
        }));
      } else {
        failed = true;
        break;
      }
    }
    if (failed) {
      for (const entry of base) {
        const prior = previous.get(entry.block.id)!;
        entry.doc = prior.doc;
        entry.flows = prior.flows;
      }
      currentModels = await models();
      break;
    }
    currentModels = await models();
    settled = factoryBalanceStep(currentModels, demandOverrides);
  }
  const hitPassLimit = passes >= 15 && settled.goalChanges.length > 0;

  const kindOf = new Map(
    currentModels.flatMap((block) => block.flows.map((flow) => [flow.item, flow.kind] as const)),
  );
  const goalChanges = base.flatMap((entry) =>
    entry.doc.goals.flatMap((goal) => {
      if (goal.stock != null) return [];
      const currentRate = entry.startGoals.get(goal.name) ?? goal.rate;
      const delta = goal.rate - currentRate;
      if (Math.abs(delta) <= 1e-6) return [];
      const activation = Math.abs(currentRate) <= 1e-9 && Math.abs(goal.rate) > 1e-9;
      return [
        {
          id: entry.block.id,
          name: entry.block.name,
          good: goal.name,
          kind: kindOf.get(goal.name) ?? "item",
          currentRate: +currentRate.toFixed(4),
          requiredRate: +goal.rate.toFixed(4),
          scale: +(Math.abs(currentRate) > 1e-9 ? goal.rate / currentRate : goal.rate).toFixed(4),
          delta: +delta.toFixed(4),
          goal: true as const,
          ...(activation ? { activation: true as const } : {}),
        },
      ];
    }),
  );
  goalChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const initialRaw = new Map(initial.raws.map((flow) => [flow.good, flow]));
  const finalRaw = new Map(settled.raws.map((flow) => [flow.good, flow]));
  const raws = [...new Set([...initialRaw.keys(), ...finalRaw.keys()])]
    .map((good) => ({
      good,
      kind: finalRaw.get(good)?.kind ?? initialRaw.get(good)?.kind ?? "item",
      current: initialRaw.get(good)?.current ?? 0,
      projected: finalRaw.get(good)?.current ?? finalRaw.get(good)?.projected ?? 0,
    }))
    .filter((flow) => flow.current > 1e-6 || flow.projected > 1e-6)
    .sort((a, b) => b.projected - a.projected);
  const changesByBlock = new Map<number, typeof goalChanges>();
  for (const change of goalChanges) {
    const list = changesByBlock.get(change.id) ?? [];
    list.push(change);
    changesByBlock.set(change.id, list);
  }

  return {
    ...settled,
    status: failed ? "Infeasible" : hitPassLimit ? "IterationLimit" : settled.status,
    demands: initial.demands,
    raws,
    goalChanges,
    blocks: currentModels.map((block) => {
      const primary = block.goals?.[0];
      const change = changesByBlock
        .get(block.id)
        ?.find((candidate) => candidate.good === primary?.name);
      return {
        id: block.id,
        name: block.name,
        good: primary?.name ?? null,
        currentRate: entryStartRate(base, block.id),
        requiredRate: change?.requiredRate ?? entryStartRate(base, block.id),
        scale: change?.scale ?? 1,
        delta: change?.delta ?? 0,
      };
    }),
  };
}

function entryStartRate(entries: { block: { id: number; rate: number } }[], id: number): number {
  return entries.find((entry) => entry.block.id === id)?.block.rate ?? 0;
}
