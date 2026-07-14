import highsLoader from "highs";
import * as q from "../db/queries.server.ts";
import { goalConsumes, normalizeBlockData } from "../lib/goals.ts";
import {
  boundaryFlows,
  computeBlock,
  goalFlows,
  persistBlock,
  type SolveInput,
} from "./block-compute.server.ts";
import {
  startFactorySolverTrace,
  type FactorySolverTraceRecorder,
} from "./factory-debug.server.ts";
import { withUndoAction } from "./undo-action.server.ts";

const PINS_META_KEY = "factory_pins_v1";
const EPS = 1e-7;
const VALIDATION_TOL = 0.005;
const RATE_CHANGE_ABS_TOL = 1e-4;
const RATE_CHANGE_REL_TOL = 0.01;
const MAX_LINEARIZATION_PASSES = 8;
const FREE_GOODS = new Set(["pyops-electricity", "pyops-heat"]);
const round = (value: number) => +value.toFixed(4);

export type FactoryPin = {
  good: string;
  kind: string;
  rate: number;
  source?: "explicit" | "terminal" | "stock";
};

type Flow = { item: string; kind: string; role: string; rate: number; priority?: number };
type Column = {
  blockId: number;
  blockName: string;
  good: string;
  kind: string;
  sign: 1 | -1;
  priority: number;
  flows: Flow[];
};
type FixedFlow = { item: string; kind: string; net: number };
type BlockResponse = { columns: Column[]; fixed: FixedFlow[] };

type FactoryGoalChange = {
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

export type PinnedFactoryResult = {
  status: string;
  passes: number;
  residual: number;
  pins: FactoryPin[];
  demands: { good: string; kind: string; current: number; target: number }[];
  goalChanges: FactoryGoalChange[];
  /** Precise targets retained for validation/apply; Scenario shows only
   * changes outside the balanced-rate tolerance. */
  allGoalChanges: FactoryGoalChange[];
  raws: { good: string; kind: string; current: number; projected: number }[];
  overproduced: {
    good: string;
    kind: string;
    cls: "surplus";
    projected: number;
    absorb: null;
  }[];
  supplyAllocations: {
    blockId: number;
    blockName: string;
    good: string;
    kind: string;
    priority: number;
    incidental: boolean;
    rate: number;
  }[];
  blocks: {
    id: number;
    name: string;
    good: string;
    currentRate: number;
    requiredRate: number;
    scale: number;
    delta: number;
  }[];
  projection: { good: string; net: number; gross: number }[];
};

const responseCache = new Map<string, Promise<BlockResponse>>();

function parsePins(): FactoryPin[] | null {
  const raw = q.metaAll()[PINS_META_KEY];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FactoryPin[];
    return parsed.filter(
      (pin) =>
        typeof pin.good === "string" &&
        typeof pin.kind === "string" &&
        Number.isFinite(pin.rate) &&
        Math.abs(pin.rate) > EPS,
    );
  } catch {
    return null;
  }
}

function inferredPins(): FactoryPin[] {
  const blocks = q.blocksWithFlows();
  const consumed = new Set(
    blocks.flatMap((block) =>
      block.flows.filter((flow) => flow.role === "import").map((flow) => flow.item),
    ),
  );
  const kindOf = new Map(
    blocks.flatMap((block) => block.flows.map((flow) => [flow.item, flow.kind] as const)),
  );
  const pins = new Map<string, FactoryPin>();
  for (const block of blocks) {
    const row = q.getBlock(block.id);
    if (!row) continue;
    const doc = normalizeBlockData(row.data as SolveInput);
    for (const goal of doc.goals) {
      if (goal.rate <= EPS) continue;
      const source = goal.stock != null ? "stock" : !consumed.has(goal.name) ? "terminal" : null;
      if (!source) continue;
      const existing = pins.get(goal.name);
      pins.set(goal.name, {
        good: goal.name,
        kind: kindOf.get(goal.name) ?? "item",
        rate:
          source === "stock"
            ? (existing?.rate ?? 0) + goal.stock! / (goal.window ?? 600)
            : goal.rate,
        source,
      });
    }
  }
  return [...pins.values()];
}

export function saveFactoryPins(pins: FactoryPin[]): void {
  const stockGoods = new Set(
    inferredPins()
      .filter((pin) => pin.source === "stock")
      .map((pin) => pin.good),
  );
  const clean = pins
    .filter(
      (pin) => !stockGoods.has(pin.good) && Number.isFinite(pin.rate) && Math.abs(pin.rate) > EPS,
    )
    .map((pin) => ({
      good: pin.good,
      kind: pin.kind,
      rate: pin.rate,
      source: "explicit" as const,
    }));
  q.metaSet(PINS_META_KEY, JSON.stringify(clean));
}

/** Initial migration mirrors YAFC desired products: current terminal positive
 * goals and stock targets become proposed pins. Negative block goals are not
 * inferred, because they may be stale output from the old surplus feedback loop. */
export function getFactoryPins(): FactoryPin[] {
  const saved = parsePins();
  const inferred = inferredPins();
  const stock = inferred.filter((pin) => pin.source === "stock");
  const editable = saved
    ? saved.map((pin) => ({ ...pin, source: "explicit" as const }))
    : inferred.filter((pin) => pin.source === "terminal");
  return [...editable, ...stock].sort((a, b) => a.good.localeCompare(b.good));
}

function responseReferenceDoc(doc: SolveInput): SolveInput {
  return {
    ...doc,
    goals: doc.goals.map((goal) => {
      const rate = Math.abs(goal.rate) > EPS ? goal.rate : goalConsumes(goal) ? -1 : 1;
      const reference = { ...goal, rate };
      delete reference.stock;
      delete reference.window;
      delete reference.factoryRate;
      return reference;
    }),
  };
}

function signedBoundary(
  doc: SolveInput,
  result: Awaited<ReturnType<typeof computeBlock>>,
): Map<string, { kind: string; net: number }> {
  const net = new Map<string, { kind: string; net: number }>();
  for (const flow of boundaryFlows(goalFlows(doc), result)) {
    const current = net.get(flow.item);
    net.set(flow.item, {
      kind: flow.kind,
      net: (current?.net ?? 0) + (flow.role === "import" ? -flow.rate : flow.rate),
    });
  }
  return net;
}

/** Build a local affine response around the block's full current goal vector.
 * A multi-goal block is one coupled LP: probing each goal with every sibling at
 * zero can combine mutually incompatible recipe bases. Finite differences at
 * the solved full vector recover the active LP basis, including negative
 * marginal flows when increasing one goal reduces another recipe. A separate
 * zero-activity solve captures operational estimates such as incidental
 * spoilage without mistaking a non-smooth recipe-basis change for fixed flow.
 * Final apply validation catches a target that crosses into another basis. */
async function responseColumns(
  row: NonNullable<ReturnType<typeof q.getBlock>>,
  doc: SolveInput,
): Promise<BlockResponse> {
  const key = `${row.id}\u0000${String(row.updatedAt)}\u0000${JSON.stringify(doc)}`;
  let pending = responseCache.get(key);
  if (!pending) {
    pending = (async () => {
      const reference = responseReferenceDoc(doc);
      const baseResult = await computeBlock(reference);
      if (baseResult.broken || baseResult.status !== "solved") return { columns: [], fixed: [] };
      const base = signedBoundary(reference, baseResult);
      const idle: SolveInput = {
        ...reference,
        goals: reference.goals.map((goal) => ({
          ...goal,
          rate: 0,
          direction: goalConsumes(goal) ? "consume" : "produce",
        })),
      };
      const idleResult = await computeBlock(idle);
      const columns = await Promise.all(
        reference.goals.map(async (goal, goalIndex): Promise<Column | null> => {
          const sign: 1 | -1 = goalConsumes(goal) ? -1 : 1;
          const delta = Math.max(1e-3, Math.abs(goal.rate) * 1e-3);
          const perturbed: SolveInput = {
            ...reference,
            goals: reference.goals.map((candidate, index) =>
              index === goalIndex
                ? { ...candidate, rate: candidate.rate + sign * delta }
                : candidate,
            ),
          };
          const result = await computeBlock(perturbed);
          if (result.broken || result.status !== "solved" || result.unmade?.includes(goal.name))
            return null;
          const next = signedBoundary(perturbed, result);
          const priority = doc.supplyPriorities?.[goal.name] ?? doc.supplyPriority ?? 0;
          const goods = new Set([...base.keys(), ...next.keys()]);
          const flows: Flow[] = [...goods].flatMap((good) => {
            const marginal = ((next.get(good)?.net ?? 0) - (base.get(good)?.net ?? 0)) / delta;
            if (Math.abs(marginal) <= EPS) return [];
            return [
              {
                item: good,
                kind: next.get(good)?.kind ?? base.get(good)?.kind ?? "item",
                role:
                  marginal < 0
                    ? "import"
                    : sign > 0 && good === goal.name
                      ? "primary"
                      : "byproduct",
                rate: Math.abs(marginal),
                priority: doc.supplyPriorities?.[good] ?? priority,
              },
            ];
          });
          const kind = flows.find((flow) => flow.item === goal.name)?.kind ?? "item";
          return {
            blockId: row.id,
            blockName: row.name,
            good: goal.name,
            kind,
            sign,
            priority,
            flows,
          };
        }),
      );
      const solvedColumns = columns.filter(
        (column): column is Column => column != null && !FREE_GOODS.has(column.good),
      );
      const fixedBoundary =
        idleResult.broken || idleResult.status !== "solved"
          ? new Map<string, { kind: string; net: number }>()
          : signedBoundary(idle, idleResult);
      if (reference.goals.some((goal) => FREE_GOODS.has(goal.name))) {
        const withoutFree: SolveInput = {
          ...reference,
          goals: reference.goals.map((goal) =>
            FREE_GOODS.has(goal.name)
              ? {
                  ...goal,
                  rate: 0,
                  direction: goalConsumes(goal) ? "consume" : "produce",
                }
              : goal,
          ),
        };
        const withoutFreeResult = await computeBlock(withoutFree);
        if (!withoutFreeResult.broken && withoutFreeResult.status === "solved") {
          const withoutFreeBoundary = signedBoundary(withoutFree, withoutFreeResult);
          for (const item of new Set([...base.keys(), ...withoutFreeBoundary.keys()])) {
            const frozen = (base.get(item)?.net ?? 0) - (withoutFreeBoundary.get(item)?.net ?? 0);
            if (Math.abs(frozen) <= EPS) continue;
            const current = fixedBoundary.get(item);
            fixedBoundary.set(item, {
              kind:
                base.get(item)?.kind ??
                withoutFreeBoundary.get(item)?.kind ??
                current?.kind ??
                "item",
              net: (current?.net ?? 0) + frozen,
            });
          }
        }
      }
      const fixed = [...fixedBoundary].flatMap(([item, flow]) =>
        Math.abs(flow.net) > EPS ? [{ item, kind: flow.kind, net: flow.net }] : [],
      );
      return { columns: solvedColumns, fixed };
    })();
    responseCache.set(key, pending);
  }
  return pending;
}

function add(map: Map<string, number>, good: string, amount: number) {
  map.set(good, (map.get(good) ?? 0) + amount);
}

const lpTerm = (coefficient: number, variable: string) =>
  `${coefficient < 0 ? "-" : "+"} ${Math.abs(coefficient)} ${variable}`;

const columnNet = (column: Column, good: string) =>
  column.flows
    .filter((flow) => flow.item === good)
    .reduce((sum, flow) => sum + (flow.role === "import" ? -flow.rate : flow.rate), 0);

function meaningfulRateChange(current: number, required: number): boolean {
  const delta = Math.abs(required - current);
  if (delta <= RATE_CHANGE_ABS_TOL) return false;
  if (Math.abs(current) <= EPS || Math.abs(required) <= EPS) return true;
  return delta / Math.max(Math.abs(current), Math.abs(required)) > RATE_CHANGE_REL_TOL;
}

export async function solvePinnedFactory(
  demandOverrides: Record<string, number> = {},
  traceSource: "scenario-preview" | "balance-apply" = "scenario-preview",
  parentTrace?: FactorySolverTraceRecorder | null,
  linearization?: ReadonlyMap<string, number>,
  pass = 1,
): Promise<PinnedFactoryResult> {
  const trace = parentTrace === undefined ? startFactorySolverTrace(traceSource) : parentTrace;
  const ownsTrace = parentTrace === undefined;
  try {
    const rows = q.blocksWithFlows().flatMap((block) => {
      const row = q.getBlock(block.id);
      if (!row) return [];
      const originalDoc = normalizeBlockData(row.data as SolveInput) as SolveInput;
      const doc: SolveInput = linearization
        ? {
            ...originalDoc,
            goals: originalDoc.goals.map((goal) => ({
              ...goal,
              rate: linearization.get(`${row.id}\u0000${goal.name}`) ?? goal.rate,
            })),
          }
        : originalDoc;
      return [{ block, row, originalDoc, doc }];
    });
    const pins = getFactoryPins().map((pin) => ({
      ...pin,
      rate: demandOverrides[pin.good] ?? pin.rate,
    }));
    const pinByGood = new Map(pins.map((pin) => [pin.good, pin]));

    const responses = await Promise.all(rows.map(({ row, doc }) => responseColumns(row, doc)));
    const candidates = responses.flatMap((response) => response.columns);
    const fixedNet = new Map<string, number>();
    const fixedGross = new Map<string, number>();
    for (const response of responses) {
      for (const flow of response.fixed) {
        add(fixedNet, flow.item, flow.net);
        add(fixedGross, flow.item, Math.abs(flow.net));
      }
    }
    const kindOf = new Map<string, string>();
    for (const { block } of rows) for (const flow of block.flows) kindOf.set(flow.item, flow.kind);
    for (const column of candidates) {
      kindOf.set(column.good, column.kind);
      for (const flow of column.flows) kindOf.set(flow.item, flow.kind);
    }
    for (const response of responses)
      for (const flow of response.fixed) kindOf.set(flow.item, flow.kind);
    for (const pin of pins) kindOf.set(pin.good, pin.kind);
    const positiveByGood = new Map<string, Column[]>();
    const negativeByGood = new Map<string, Column[]>();
    for (const column of candidates) {
      const map = column.sign > 0 ? positiveByGood : negativeByGood;
      const list = map.get(column.good) ?? [];
      list.push(column);
      map.set(column.good, list);
    }

    // Positive producers are reached only through pins and their ingredients.
    // A reached column's natural byproducts may activate a configured consume
    // goal, but never another positive goal. Producer caps below prevent that
    // sink chain from pulling extra source production merely for its outputs.
    const required = new Set(pins.filter((pin) => pin.rate > 0).map((pin) => pin.good));
    const selected = new Map<string, Column>();
    const queue = [...required];
    const explicitSinkGoods = new Set(pins.filter((pin) => pin.rate < 0).map((pin) => pin.good));
    const autoSinkGoods = new Set<string>();
    for (const pin of pins.filter((candidate) => candidate.rate < 0)) {
      const offers = negativeByGood.get(pin.good) ?? [];
      const top = Math.max(...offers.map((offer) => offer.priority));
      for (const offer of offers.filter((candidate) => candidate.priority === top)) {
        selected.set(`${offer.blockId}\u0000${offer.good}`, offer);
        // The consumed pin itself is the factory boundary contract, but any
        // other ingredients of that configured sink can use factory producers.
        for (const flow of offer.flows) {
          if (
            flow.role !== "import" ||
            flow.item === pin.good ||
            FREE_GOODS.has(flow.item) ||
            required.has(flow.item)
          )
            continue;
          required.add(flow.item);
          queue.push(flow.item);
        }
      }
    }
    const consideredByproducts = new Set<string>();
    let addedSink = true;
    while (queue.length > 0 || addedSink) {
      while (queue.length > 0) {
        const good = queue.shift()!;
        const offers = positiveByGood.get(good) ?? [];
        if (offers.length === 0) continue;
        const top = Math.max(...offers.map((offer) => offer.priority));
        for (const offer of offers.filter((candidate) => candidate.priority === top)) {
          const key = `${offer.blockId}\u0000${offer.good}`;
          if (selected.has(key)) continue;
          selected.set(key, offer);
          for (const flow of offer.flows) {
            if (flow.role !== "import" || FREE_GOODS.has(flow.item) || required.has(flow.item))
              continue;
            required.add(flow.item);
            queue.push(flow.item);
          }
        }
      }
      addedSink = false;
      for (const flow of [...selected.values()].flatMap((column) => column.flows)) {
        if (
          flow.role !== "byproduct" ||
          explicitSinkGoods.has(flow.item) ||
          consideredByproducts.has(flow.item)
        )
          continue;
        consideredByproducts.add(flow.item);
        const offers = negativeByGood.get(flow.item) ?? [];
        if (offers.length === 0) continue;
        const top = Math.max(...offers.map((offer) => offer.priority));
        for (const offer of offers.filter((candidate) => candidate.priority === top)) {
          const key = `${offer.blockId}\u0000${offer.good}`;
          if (selected.has(key)) continue;
          selected.set(key, offer);
          autoSinkGoods.add(flow.item);
          addedSink = true;
          for (const ingredient of offer.flows) {
            if (
              ingredient.role !== "import" ||
              ingredient.item === offer.good ||
              FREE_GOODS.has(ingredient.item) ||
              required.has(ingredient.item)
            )
              continue;
            required.add(ingredient.item);
            queue.push(ingredient.item);
          }
        }
      }
    }
    const columns = [...selected.values()];
    const goods = new Set(pins.map((pin) => pin.good));
    for (const good of fixedNet.keys()) goods.add(good);
    for (const column of columns) for (const flow of column.flows) goods.add(flow.item);
    const surplusGoods = new Set(
      [...goods].filter((good) => !autoSinkGoods.has(good) || (fixedNet.get(good) ?? 0) > EPS),
    );

    const constraints: string[] = [];
    const importVarByGood = new Map<string, number>();
    const producers = new Set(
      columns
        .filter((column) => column.sign > 0 && !FREE_GOODS.has(column.good))
        .map((column) => column.good),
    );
    for (const good of goods) {
      const parts: string[] = [];
      columns.forEach((column, index) => {
        const net = columnNet(column, good);
        if (Math.abs(net) > EPS) parts.push(lpTerm(net, `x${index}`));
      });
      if ((!producers.has(good) && !autoSinkGoods.has(good)) || FREE_GOODS.has(good)) {
        importVarByGood.set(good, constraints.length);
        parts.push(`+ 1 import_${constraints.length}`);
      }
      if (surplusGoods.has(good)) parts.push(`- 1 surplus_${constraints.length}`);
      constraints.push(
        `g${constraints.length}: ${parts.join(" ")} = ${(pinByGood.get(good)?.rate ?? 0) - (fixedNet.get(good) ?? 0)}`,
      );
    }

    // A declared producer may cover demand for its own goal, but may not run
    // beyond that demand just to obtain an incidental output. Incidental supply
    // can still reduce the declared producer's activity or remain surplus.
    for (const good of producers) {
      const parts: string[] = [];
      columns.forEach((column, index) => {
        const net = columnNet(column, good);
        if (column.sign > 0 && column.good === good && net > EPS)
          parts.push(lpTerm(net, `x${index}`));
        else if (net < -EPS) parts.push(lpTerm(net, `x${index}`));
      });
      constraints.push(
        `cap${constraints.length}: ${parts.join(" ")} <= ${Math.max(0, (pinByGood.get(good)?.rate ?? 0) - (fixedNet.get(good) ?? 0))}`,
      );
    }

    const objective =
      [
        ...[...importVarByGood.values()].map((index) => `+ 1000000 import_${index}`),
        ...[...goods].flatMap((good, index) =>
          autoSinkGoods.has(good) && surplusGoods.has(good) ? [`+ 1000 surplus_${index}`] : [],
        ),
        ...columns.map(
          (column, index) => `+ ${1 + Math.max(0, -column.priority) * 0.001} x${index}`,
        ),
      ].join(" ") || "+ 0 surplus_0";
    const bounds = [
      ...columns.map((_, index) => `0 <= x${index} <= 1e9`),
      ...[...goods].flatMap((good, index) => [
        ...(importVarByGood.has(good) ? [`0 <= import_${index} <= 1e12`] : []),
        ...(surplusGoods.has(good) ? [`0 <= surplus_${index} <= 1e12`] : []),
      ]),
    ];
    const model = `Minimize\n obj: ${objective}\nSubject To\n ${constraints.join("\n ")}\nBounds\n ${bounds.join("\n ")}\nEnd`;
    trace?.event("pinned-model", {
      pins,
      required: [...required],
      autoSinkGoods: [...autoSinkGoods],
      columns,
      model,
    });
    const highs = await highsLoader();
    const solution = highs.solve(model);
    const optimal = solution.Status === "Optimal";

    const targetByGoal = new Map<string, { rate: number; kind: string }>();
    for (const { row, originalDoc } of rows) {
      for (const goal of originalDoc.goals) {
        if (!FREE_GOODS.has(goal.name)) continue;
        targetByGoal.set(`${row.id}\u0000${goal.name}`, {
          rate: goal.rate,
          kind: kindOf.get(goal.name) ?? "fluid",
        });
      }
    }
    columns.forEach((column, index) => {
      const amount = optimal
        ? ((solution.Columns[`x${index}`] as { Primal?: number } | undefined)?.Primal ?? 0)
        : 0;
      targetByGoal.set(`${column.blockId}\u0000${column.good}`, {
        // Keep solver precision for apply/validation. Four-decimal goal
        // rounding can amplify into whole units on high-throughput recipes.
        rate: column.sign * amount,
        kind: column.kind,
      });
    });
    // Every non-stock goal is a factory decision variable. If it was reached
    // by neither demand nor a natural byproduct sink chain, its value is zero.
    const allGoalChanges: FactoryGoalChange[] = rows.flatMap(({ row, originalDoc }) =>
      originalDoc.goals.flatMap((goal) => {
        const target = targetByGoal.get(`${row.id}\u0000${goal.name}`);
        const requiredRate = target?.rate ?? 0;
        const current = goal.rate;
        if (Math.abs(requiredRate - current) <= 1e-4) return [];
        return [
          {
            id: row.id,
            name: row.name,
            good: goal.name,
            kind: target?.kind ?? kindOf.get(goal.name) ?? "item",
            currentRate: round(current),
            requiredRate,
            scale: round(Math.abs(current) > EPS ? requiredRate / current : requiredRate),
            delta: round(requiredRate - current),
            goal: true as const,
            ...(Math.abs(current) <= EPS && Math.abs(requiredRate) > EPS
              ? { activation: true as const }
              : {}),
          },
        ];
      }),
    );
    const goalChanges = allGoalChanges.filter((change) =>
      meaningfulRateChange(change.currentRate, change.requiredRate),
    );

    const currentProduced = new Map<string, number>();
    const currentConsumed = new Map<string, number>();
    for (const { block } of rows)
      for (const flow of block.flows)
        add(flow.role === "import" ? currentConsumed : currentProduced, flow.item, flow.rate);
    const rawImports = [...goods].flatMap((good, index) => {
      if (!importVarByGood.has(good)) return [];
      const projected = optimal
        ? ((solution.Columns[`import_${index}`] as { Primal?: number } | undefined)?.Primal ?? 0)
        : 0;
      if (projected <= EPS && (currentConsumed.get(good) ?? 0) <= EPS) return [];
      return [
        {
          good,
          kind: kindOf.get(good) ?? "item",
          current: round(
            Math.max(0, (currentConsumed.get(good) ?? 0) - (currentProduced.get(good) ?? 0)),
          ),
          projected: round(projected),
        },
      ];
    });
    const surplus = [...goods].flatMap((good, index) => {
      const projected = optimal
        ? ((solution.Columns[`surplus_${index}`] as { Primal?: number } | undefined)?.Primal ?? 0)
        : 0;
      if (projected <= 1e-4) return [];
      return [
        {
          good,
          kind: kindOf.get(good) ?? "item",
          cls: "surplus" as const,
          projected: round(projected),
          absorb: null,
        },
      ];
    });
    const demands = pins
      .filter((pin) => pin.rate > 0)
      .map((pin) => ({
        good: pin.good,
        kind: pin.kind,
        current: round(
          getFactoryPins().find((candidate) => candidate.good === pin.good)?.rate ?? 0,
        ),
        target: round(pin.rate),
      }));
    const projectedNet = new Map(fixedNet);
    const projectedGross = new Map(fixedGross);
    columns.forEach((column, index) => {
      const amount = optimal
        ? ((solution.Columns[`x${index}`] as { Primal?: number } | undefined)?.Primal ?? 0)
        : 0;
      for (const flow of column.flows) {
        add(projectedNet, flow.item, amount * (flow.role === "import" ? -flow.rate : flow.rate));
        add(projectedGross, flow.item, amount * flow.rate);
      }
    });
    const result: PinnedFactoryResult = {
      status: optimal ? ("Optimal" as const) : solution.Status,
      passes: pass,
      residual: 0,
      pins,
      demands,
      goalChanges: goalChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
      allGoalChanges: allGoalChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
      raws: rawImports.sort((a, b) => b.projected - a.projected),
      overproduced: surplus.sort((a, b) => b.projected - a.projected),
      supplyAllocations: [] as {
        blockId: number;
        blockName: string;
        good: string;
        kind: string;
        priority: number;
        incidental: boolean;
        rate: number;
      }[],
      blocks: goalChanges.map((change) => ({
        id: change.id,
        name: change.name,
        good: change.good,
        currentRate: change.currentRate,
        requiredRate: change.requiredRate,
        scale: change.scale,
        delta: change.delta,
      })),
      // Apply validation consumes this projection, so retain solver precision.
      // Display-facing rates are rounded separately above.
      projection: [...projectedNet].map(([good, net]) => ({
        good,
        net,
        gross: projectedGross.get(good) ?? Math.abs(net),
      })),
    };

    if (optimal) {
      const proposedRates = new Map<string, number>();
      const referenceRates = new Map<string, number>(
        rows.flatMap(({ row, doc }) =>
          doc.goals.map((goal) => [`${row.id}\u0000${goal.name}`, goal.rate] as const),
        ),
      );
      const solved = await Promise.all(
        rows.map(async ({ row, originalDoc }) => {
          const finalDoc: SolveInput = {
            ...originalDoc,
            goals: originalDoc.goals.map((goal) => {
              const rate = targetByGoal.get(`${row.id}\u0000${goal.name}`)?.rate ?? 0;
              proposedRates.set(`${row.id}\u0000${goal.name}`, rate);
              return {
                ...goal,
                rate,
                ...(rate === 0
                  ? { direction: goalConsumes(goal) ? "consume" : "produce" }
                  : { direction: undefined }),
                ...(goal.stock != null ? { factoryRate: rate } : {}),
              };
            }),
          };
          const blockResult = await computeBlock(finalDoc);
          return { row, doc: finalDoc, result: blockResult };
        }),
      );
      trace?.event("linearization-blocks", {
        pass,
        blocks: solved.map(({ row, doc, result: blockResult }) => ({
          blockId: row.id,
          blockName: row.name,
          goals: doc.goals,
          status: blockResult.status,
          broken: blockResult.broken,
          unmade: blockResult.unmade ?? [],
        })),
      });
      const broken = solved.filter(
        (entry) => entry.result.broken || entry.result.status !== "solved",
      );
      if (broken.length > 0) {
        result.status = "ValidationFailed";
        result.residual = 1;
        trace?.event("linearization-validation", {
          pass,
          residual: 1,
          broken: broken.map(({ row }) => ({ id: row.id, name: row.name })),
        });
      } else {
        const actualNet = new Map<string, number>();
        const actualGross = new Map<string, number>();
        for (const entry of solved) {
          for (const flow of boundaryFlows(goalFlows(entry.doc), entry.result)) {
            add(actualNet, flow.item, flow.rate * (flow.role === "import" ? -1 : 1));
            add(actualGross, flow.item, flow.rate);
          }
        }
        for (const good of FREE_GOODS) {
          const actual = actualNet.get(good) ?? 0;
          projectedNet.set(good, actual);
          projectedGross.set(good, actualGross.get(good) ?? Math.abs(actual));
          const current = Math.max(
            0,
            (currentConsumed.get(good) ?? 0) - (currentProduced.get(good) ?? 0),
          );
          const needed = Math.max(0, -actual);
          result.raws = result.raws.filter((flow) => flow.good !== good);
          if (needed > EPS || current > EPS)
            result.raws.push({
              good,
              kind: kindOf.get(good) ?? "fluid",
              current: round(current),
              projected: round(needed),
            });
          result.overproduced = result.overproduced.filter((flow) => flow.good !== good);
          if (actual > 1e-4)
            result.overproduced.push({
              good,
              kind: kindOf.get(good) ?? "fluid",
              cls: "surplus",
              projected: round(actual),
              absorb: null,
            });
        }
        result.raws.sort((a, b) => b.projected - a.projected);
        result.overproduced.sort((a, b) => b.projected - a.projected);
        result.projection = [...projectedNet].map(([good, net]) => ({
          good,
          net,
          gross: projectedGross.get(good) ?? Math.abs(net),
        }));
        const allGoods = new Set([...actualNet.keys(), ...projectedNet.keys()]);
        let residual = 0;
        const discrepancies: {
          good: string;
          expected: number;
          actual: number;
          relative: number;
        }[] = [];
        for (const good of allGoods) {
          if (FREE_GOODS.has(good)) continue;
          const actual = actualNet.get(good) ?? 0;
          const expected = projectedNet.get(good) ?? 0;
          const scale = Math.max(
            1,
            Math.abs(actual),
            Math.abs(expected),
            actualGross.get(good) ?? 0,
            projectedGross.get(good) ?? 0,
          );
          const relative = Math.abs(actual - expected) / scale;
          residual = Math.max(residual, relative);
          if (relative > VALIDATION_TOL)
            discrepancies.push({
              good,
              expected: round(expected),
              actual: round(actual),
              relative: round(relative),
            });
        }
        discrepancies.sort((a, b) => b.relative - a.relative);
        const goalDifferences = [...proposedRates].flatMap(([key, rate]) => {
          const reference = referenceRates.get(key) ?? 0;
          const delta = Math.abs(rate - reference);
          return meaningfulRateChange(reference, rate) ? [{ key, reference, rate, delta }] : [];
        });
        goalDifferences.sort((a, b) => b.delta - a.delta);
        const goalsStable = goalDifferences.length === 0;
        result.residual = round(residual);
        trace?.event("linearization-validation", {
          pass,
          residual: result.residual,
          goalsStable,
          goalDifferences: goalDifferences.slice(0, 20),
          actual: [...actualNet],
          actualGross: [...actualGross],
          expected: [...projectedNet],
          expectedGross: [...projectedGross],
          discrepancies: discrepancies.slice(0, 20),
        });
        if (residual > VALIDATION_TOL || !goalsStable) {
          if (pass < MAX_LINEARIZATION_PASSES) {
            trace?.event("relinearize", {
              pass,
              nextPass: pass + 1,
              residual: result.residual,
              goalsStable,
              goalDifferences: goalDifferences.slice(0, 20),
              discrepancies: discrepancies.slice(0, 20),
            });
            const refined = await solvePinnedFactory(
              demandOverrides,
              traceSource,
              trace,
              proposedRates,
              pass + 1,
            );
            if (ownsTrace) trace?.finish(refined);
            return refined;
          }
          result.status = "ValidationFailed";
        }
      }
    }
    if (ownsTrace) trace?.finish(result);
    return result;
  } catch (error) {
    if (ownsTrace) trace?.fail(error);
    throw error;
  }
}

/** Apply only after the normalized projection survives a full real block
 * re-solve. Nothing is written until every block solves and aggregate boundary
 * flow matches the factory LP within tolerance. */
export async function applyPinnedFactory(
  demandOverrides: Record<string, number> = {},
  persistChanges = true,
) {
  const trace = startFactorySolverTrace("balance-apply");
  const complete = <T>(result: T): T => {
    trace?.finish(result);
    return result;
  };
  try {
    const plan = await solvePinnedFactory(demandOverrides, "balance-apply", trace);
    if (plan.status !== "Optimal")
      return complete({
        status: plan.status,
        passes: plan.passes,
        residual: plan.residual,
        applied: [],
        broken: [],
      });

    const changesByBlock = new Map<number, typeof plan.allGoalChanges>();
    for (const change of plan.allGoalChanges) {
      const list = changesByBlock.get(change.id) ?? [];
      list.push(change);
      changesByBlock.set(change.id, list);
    }
    const changedBlockIds = new Set(plan.goalChanges.map((change) => change.id));
    const solved: {
      row: NonNullable<ReturnType<typeof q.getBlock>>;
      doc: SolveInput;
      result: Awaited<ReturnType<typeof computeBlock>>;
      changed: boolean;
    }[] = [];
    const broken: { id: number; name: string }[] = [];
    for (const block of q.blocksWithFlows()) {
      const row = q.getBlock(block.id);
      if (!row) continue;
      const changes = changesByBlock.get(block.id) ?? [];
      const doc = normalizeBlockData(row.data as SolveInput) as SolveInput;
      const finalDoc: SolveInput = {
        ...doc,
        goals: doc.goals.map((goal) => {
          const change = changes.find((candidate) => candidate.good === goal.name);
          return change
            ? {
                ...goal,
                rate: change.requiredRate,
                ...(change.requiredRate === 0
                  ? { direction: goalConsumes(goal) ? "consume" : "produce" }
                  : { direction: undefined }),
                ...(goal.stock != null ? { factoryRate: change.requiredRate } : {}),
              }
            : goal;
        }),
      };
      const result = await computeBlock(finalDoc);
      trace?.event("validation-block", {
        blockId: row.id,
        blockName: row.name,
        goals: finalDoc.goals,
        status: result.status,
        broken: result.broken,
        unmade: result.unmade ?? [],
      });
      if (result.broken || result.status !== "solved") broken.push({ id: row.id, name: row.name });
      solved.push({ row, doc: finalDoc, result, changed: changes.length > 0 });
    }
    if (broken.length > 0)
      return complete({
        status: "ValidationFailed",
        passes: plan.passes,
        residual: 1,
        applied: [],
        broken,
      });

    const actualNet = new Map<string, number>();
    const actualGross = new Map<string, number>();
    for (const entry of solved) {
      for (const flow of boundaryFlows(goalFlows(entry.doc), entry.result)) {
        add(actualNet, flow.item, flow.rate * (flow.role === "import" ? -1 : 1));
        add(actualGross, flow.item, flow.rate);
      }
    }
    const expectedNet = new Map(plan.projection.map((flow) => [flow.good, flow.net]));
    const expectedGross = new Map(plan.projection.map((flow) => [flow.good, flow.gross]));
    const allGoods = new Set([...actualNet.keys(), ...expectedNet.keys()]);
    let residual = 0;
    const discrepancies: { good: string; expected: number; actual: number; relative: number }[] =
      [];
    for (const good of allGoods) {
      if (FREE_GOODS.has(good)) continue;
      const actual = actualNet.get(good) ?? 0;
      const expected = expectedNet.get(good) ?? 0;
      const scale = Math.max(
        1,
        Math.abs(actual),
        Math.abs(expected),
        actualGross.get(good) ?? 0,
        expectedGross.get(good) ?? 0,
      );
      const relative = Math.abs(actual - expected) / scale;
      residual = Math.max(residual, relative);
      if (relative > VALIDATION_TOL)
        discrepancies.push({
          good,
          expected: round(expected),
          actual: round(actual),
          relative: round(relative),
        });
    }
    discrepancies.sort((a, b) => b.relative - a.relative);
    trace?.event("validation", {
      residual: round(residual),
      actual: [...actualNet],
      actualGross: [...actualGross],
      expected: [...expectedNet],
      expectedGross: [...expectedGross],
      discrepancies: discrepancies.slice(0, 20),
    });
    if (residual > VALIDATION_TOL)
      return complete({
        status: "ValidationFailed",
        passes: plan.passes,
        residual: round(residual),
        applied: [],
        broken: [],
        discrepancies: discrepancies.slice(0, 20),
      });

    if (!persistChanges)
      return complete({
        status: "Optimal",
        passes: plan.passes,
        residual: round(residual),
        applied: [],
        broken: [],
        validated: true,
        proposed: plan.goalChanges.length,
      });

    const applied: { id: number; name: string; from: number; to: number }[] = [];
    await withUndoAction("Balance pinned factory", async () => {
      for (const entry of solved) {
        if (!entry.changed) continue;
        await persistBlock(
          {
            id: entry.row.id,
            name: entry.row.name,
            iconKind: entry.row.iconKind,
            iconName: entry.row.iconName,
          },
          entry.doc,
          entry.result,
        );
        if (!changedBlockIds.has(entry.row.id)) continue;
        const change = changesByBlock.get(entry.row.id)![0]!;
        applied.push({
          id: entry.row.id,
          name: entry.row.name,
          from: change.currentRate,
          to: change.requiredRate,
        });
      }
    });
    return complete({
      status: "Optimal",
      passes: plan.passes,
      residual: round(residual),
      applied,
      broken: [],
    });
  } catch (error) {
    trace?.fail(error);
    throw error;
  }
}
