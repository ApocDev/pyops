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
import type { FactorySolveProgressReporter } from "./factory-progress.server.ts";
import {
  acceptsTemperature,
  baseGoodName,
  exactTemperature,
  qualifiedGoodKey,
  qualifierFromKey,
  type TemperatureQualifier,
} from "../solver/temperature-flow.ts";
import { withUndoAction } from "./undo-action.server.ts";

const PINS_META_KEY = "factory_pins_v1";
const EPS = 1e-7;
const VALIDATION_TOL = 0.005;
const RATE_CHANGE_ABS_TOL = 1e-4;
const RATE_CHANGE_REL_TOL = 0.01;
const MAX_LINEARIZATION_PASSES = 8;
const FREE_GOODS = new Set(["pyops-heat"]);
const round = (value: number) => +value.toFixed(4);

export type FactoryPin = {
  good: string;
  kind: string;
  rate: number;
  source?: "explicit" | "terminal" | "stock";
};

type Flow = {
  item: string;
  kind: string;
  role: string;
  rate: number;
  priority?: number;
} & TemperatureQualifier;
type Column = {
  blockId: number;
  blockName: string;
  good: string;
  kind: string;
  sign: 1 | -1;
  priority: number;
  /** Whether this marginal basis is active at the reference goal vector. */
  activeAtReference: boolean;
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
  dedicatedRate: number;
  factoryNeed: number;
  projectedOutput: number;
  factorySurplus: number;
  recoveredRate: number;
  scale: number;
  delta: number;
  goal: true;
  /** Exact produced temperature selected on this fluid goal. */
  temperature?: number;
  activation?: true;
};

export type FactoryValidation = {
  materialConflicts: {
    good: string;
    kind: string;
    direction: "shortage" | "excess";
    amount: number;
    required: number;
    available: number;
    blocks: {
      id: number;
      name: string;
      supplied: number;
      consumed: number;
      configuredProducer: boolean;
      scalableProducer: boolean;
    }[];
  }[];
  blocks: {
    id: number;
    name: string;
    status: string;
    message?: string;
    goals: { good: string; rate: number; direction?: "produce" | "consume" }[];
    unmade: string[];
  }[];
  discrepancies: { good: string; expected: number; actual: number; relative: number }[];
  unstableGoals: {
    blockId: number;
    blockName: string;
    good: string;
    reference: number;
    rate: number;
    delta: number;
  }[];
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
  /** Actionable evidence from the final full-block validation pass. */
  validation: FactoryValidation | null;
};

const RESPONSE_CACHE_MAX_ENTRIES = 512;
const responseCache = new Map<string, Promise<BlockResponse>>();

function cachedBlockResponse(key: string): Promise<BlockResponse> | undefined {
  const pending = responseCache.get(key);
  if (!pending) return undefined;
  // Refresh insertion order so frequently reused response models survive the
  // bounded cache while old re-linearization passes are discarded.
  responseCache.delete(key);
  responseCache.set(key, pending);
  return pending;
}

function cacheBlockResponse(key: string, pending: Promise<BlockResponse>) {
  responseCache.set(key, pending);
  while (responseCache.size > RESPONSE_CACHE_MAX_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest == null) break;
    responseCache.delete(oldest);
  }
  void pending.catch(() => {
    if (responseCache.get(key) === pending) responseCache.delete(key);
  });
}

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
    const key = qualifiedGoodKey(flow);
    const current = net.get(key);
    net.set(key, {
      kind: flow.kind,
      net: (current?.net ?? 0) + (flow.role === "import" ? -flow.rate : flow.rate),
    });
  }
  return net;
}

/** The temperature selector recipes are ordinary HiGHS columns, and highs-js's
 * pretty-solution transport exposes their primals at limited precision. For a
 * fluid goal sitting on a coproduct plateau, the configured goal row and the
 * rounded selector row can therefore fail to cancel by a few ten-thousandths.
 * Use the physical selector rate only to decide whether the local basis is
 * active; keep the configured goal rate in signedBoundary for the actual
 * response coefficients, persisted projection, and validation contract. */
function physicalSignedBoundary(
  doc: SolveInput,
  result: Awaited<ReturnType<typeof computeBlock>>,
): Map<string, { kind: string; net: number }> {
  const flows = boundaryFlows(goalFlows(doc), result);
  const net = signedBoundary(doc, result);
  for (const goal of doc.goals) {
    const actual = result.qualifiedGoals?.[goal.name];
    if (!actual?.length) continue;
    for (const flow of flows.filter(
      (candidate) =>
        candidate.item === goal.name &&
        (candidate.role === "primary" || candidate.role === "stock"),
    )) {
      const key = qualifiedGoodKey(flow);
      const current = net.get(key);
      net.set(key, { kind: flow.kind, net: (current?.net ?? 0) - flow.rate });
    }
    for (const flow of actual) {
      const key = qualifiedGoodKey({ ...flow, item: goal.name });
      const current = net.get(key);
      net.set(key, { kind: flow.kind, net: (current?.net ?? 0) + flow.rate });
    }
  }
  return net;
}

/** Build a local affine response around the block's full current goal vector.
 * A multi-goal block is one coupled LP: probing each goal with every sibling at
 * zero can combine mutually incompatible recipe bases. Finite differences at
 * the solved full vector recover the active LP basis, including negative
 * marginal flows when increasing one goal reduces another recipe. The affine
 * intercept makes the response pass through that full solved reference point,
 * retaining operational and activation flows that have zero local derivative.
 * Final apply validation catches a target that crosses into another basis. */
async function responseColumns(
  row: NonNullable<ReturnType<typeof q.getBlock>>,
  doc: SolveInput,
): Promise<BlockResponse> {
  const key = `${row.id}\u0000${String(row.updatedAt)}\u0000${JSON.stringify(doc)}`;
  let pending = cachedBlockResponse(key);
  if (!pending) {
    pending = (async () => {
      const reference = responseReferenceDoc(doc);
      const baseResult = await computeBlock(reference);
      if (baseResult.broken || baseResult.status !== "solved") return { columns: [], fixed: [] };
      const base = signedBoundary(reference, baseResult);
      const physicalBase = physicalSignedBoundary(reference, baseResult);
      const anchorResult = reference.goals.some(
        (goal, index) => goal.rate !== doc.goals[index]?.rate,
      )
        ? await computeBlock(doc)
        : baseResult;
      const anchor =
        anchorResult.broken || anchorResult.status !== "solved"
          ? new Map<string, { kind: string; net: number }>()
          : signedBoundary(doc, anchorResult);
      const columns = await Promise.all(
        reference.goals.map(async (goal, goalIndex): Promise<Column | null> => {
          const sign: 1 | -1 = goalConsumes(goal) ? -1 : 1;
          const solveBoundaryAt = async (rate: number) => {
            const perturbed: SolveInput = {
              ...reference,
              goals: reference.goals.map((candidate, index) =>
                index === goalIndex ? { ...candidate, rate } : candidate,
              ),
            };
            const result = await computeBlock(perturbed);
            if (result.broken || result.status !== "solved" || result.unmade?.includes(goal.name))
              return null;
            return {
              boundary: signedBoundary(perturbed, result),
              physical: physicalSignedBoundary(perturbed, result),
            };
          };
          let delta = Math.max(1e-3, Math.abs(goal.rate) * 1e-3);
          let previous = base;
          const localNext = await solveBoundaryAt(goal.rate + sign * delta);
          if (!localNext) return null;
          let next = localNext.boundary;

          // A sibling goal can already make more of this good than its own
          // minimum asks for. A tiny perturbation then consumes only that
          // existing surplus: total block output stays flat and the local
          // derivative is zero even though the goal becomes scalable after the
          // surplus is exhausted. Coupled goals can create the same plateau by
          // substituting one recipe basis for another. Search outward for the
          // next segment where the goal changes its own boundary flow, then
          // measure that segment locally so the plateau does not dilute its
          // true marginal response.
          const localOwnNet =
            (mapBaseNet(localNext.physical, goal.name) - mapBaseNet(physicalBase, goal.name)) /
            delta;
          const activeAtReference = sign * localOwnNet > EPS;
          const coveredRate = sign * mapBaseNet(base, goal.name);
          if (sign * localOwnNet <= EPS) {
            let segmentMagnitude =
              Math.max(Math.abs(goal.rate), coveredRate, RATE_CHANGE_ABS_TOL) * 1.001;
            for (let attempt = 0; attempt < 6; attempt += 1) {
              const segmentDelta = Math.max(1e-3, segmentMagnitude * 1e-3);
              const segmentStart = sign * segmentMagnitude;
              const segmentBase = await solveBoundaryAt(segmentStart);
              const segmentNext = await solveBoundaryAt(segmentStart + sign * segmentDelta);
              const segmentOwnNet =
                segmentBase && segmentNext
                  ? (mapBaseNet(segmentNext.physical, goal.name) -
                      mapBaseNet(segmentBase.physical, goal.name)) /
                    segmentDelta
                  : 0;
              if (segmentBase && segmentNext && sign * segmentOwnNet > EPS) {
                previous = segmentBase.boundary;
                next = segmentNext.boundary;
                delta = segmentDelta;
                break;
              }
              segmentMagnitude *= 2;
            }
          }

          const priority = doc.supplyPriorities?.[goal.name] ?? doc.supplyPriority ?? 0;
          const goods = new Set([...previous.keys(), ...next.keys()]);
          const flows: Flow[] = [...goods].flatMap((good) => {
            const marginal = ((next.get(good)?.net ?? 0) - (previous.get(good)?.net ?? 0)) / delta;
            if (Math.abs(marginal) <= EPS) return [];
            return [
              {
                item: good,
                kind: next.get(good)?.kind ?? previous.get(good)?.kind ?? "item",
                role:
                  marginal < 0
                    ? "import"
                    : sign > 0 && baseGoodName(good) === goal.name
                      ? "primary"
                      : "byproduct",
                rate: Math.abs(marginal),
                priority: doc.supplyPriorities?.[good] ?? priority,
              },
            ];
          });
          const kind = flows.find((flow) => baseGoodName(flow.item) === goal.name)?.kind ?? "item";
          return {
            blockId: row.id,
            blockName: row.name,
            good: goal.name,
            kind,
            sign,
            priority,
            activeAtReference,
            flows,
          };
        }),
      );
      const solvedColumns = columns.filter(
        (column): column is Column => column != null && !FREE_GOODS.has(column.good),
      );
      // fixed = anchor - J * anchor goals. This local affine intercept retains
      // flows that switch on with an active recipe but stay flat under tiny
      // perturbations; an idle-only intercept silently dropped them on every
      // re-linearization pass. A marginal basis found beyond a coproduct
      // plateau is excluded because that segment is not active at the current
      // reference point.
      const fixedBoundary = new Map(
        [...anchor].map(([item, flow]) => [item, { ...flow }] as const),
      );
      for (const column of solvedColumns) {
        if (!column.activeAtReference) continue;
        const anchorGoal = doc.goals.find((goal) => goal.name === column.good);
        const magnitude = Math.abs(anchorGoal?.rate ?? 0);
        for (const flow of column.flows) {
          const current = fixedBoundary.get(flow.item);
          fixedBoundary.set(flow.item, {
            kind: current?.kind ?? flow.kind,
            net: (current?.net ?? 0) - magnitude * flow.rate * (flow.role === "import" ? -1 : 1),
          });
        }
      }
      const fixed = [...fixedBoundary].flatMap(([item, flow]) =>
        Math.abs(flow.net) > EPS ? [{ item, kind: flow.kind, net: flow.net }] : [],
      );
      return { columns: solvedColumns, fixed };
    })();
    cacheBlockResponse(key, pending);
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

const mapBaseNet = (flows: ReadonlyMap<string, { net: number }>, good: string) =>
  [...flows].reduce((sum, [key, flow]) => (baseGoodName(key) === good ? sum + flow.net : sum), 0);

const columnBaseNet = (column: Column, good: string) =>
  column.flows
    .filter((flow) => baseGoodName(flow.item) === good)
    .reduce((sum, flow) => sum + (flow.role === "import" ? -flow.rate : flow.rate), 0);

const materialPinKey = (pin: Pick<FactoryPin, "good" | "kind">) =>
  pin.kind === "fluid" && !pin.good.startsWith("pyops-")
    ? qualifiedGoodKey({
        item: pin.good,
        kind: pin.kind,
        temperatureMode: "range",
        minTemp: null,
        maxTemp: null,
      })
    : pin.good;

const compatibleFlow = (flowKey: string, requestedKey: string): boolean => {
  if (baseGoodName(flowKey) !== baseGoodName(requestedKey)) return false;
  const temperature = exactTemperature(flowKey);
  return temperature == null || acceptsTemperature(requestedKey, temperature);
};

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
  progress?: FactorySolveProgressReporter | null,
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
    const pinByMaterialGood = new Map(pins.map((pin) => [materialPinKey(pin), pin]));

    let completedResponses = 0;
    progress?.update({
      phase: "responses",
      message: `Building block response models · ${rows.length} blocks`,
      pass,
      maxPasses: MAX_LINEARIZATION_PASSES,
      current: 0,
      total: rows.length,
    });
    const responses = await Promise.all(
      rows.map(async ({ row, doc }) => {
        const response = await responseColumns(row, doc);
        completedResponses += 1;
        progress?.update({
          phase: "responses",
          message: `Building block response models · ${completedResponses}/${rows.length}`,
          pass,
          maxPasses: MAX_LINEARIZATION_PASSES,
          current: completedResponses,
          total: rows.length,
        });
        return response;
      }),
    );
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
    const required = new Set(pins.filter((pin) => pin.rate > 0).map(materialPinKey));
    const selected = new Map<string, Column>();
    const queue = [...required];
    const explicitSinkGoods = new Set(pins.filter((pin) => pin.rate < 0).map(materialPinKey));
    const autoSinkGoods = new Set<string>();
    for (const pin of pins.filter((candidate) => candidate.rate < 0)) {
      const requested = materialPinKey(pin);
      const offers = (negativeByGood.get(pin.good) ?? []).filter((offer) =>
        offer.flows.some(
          (flow) =>
            flow.role === "import" &&
            baseGoodName(flow.item) === pin.good &&
            compatibleFlow(requested, flow.item),
        ),
      );
      const top = Math.max(...offers.map((offer) => offer.priority));
      for (const offer of offers.filter((candidate) => candidate.priority === top)) {
        selected.set(`${offer.blockId}\u0000${offer.good}`, offer);
        // The consumed pin itself is the factory boundary contract, but any
        // other ingredients of that configured sink can use factory producers.
        for (const flow of offer.flows) {
          if (
            flow.role !== "import" ||
            baseGoodName(flow.item) === pin.good ||
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
        const offers = (positiveByGood.get(baseGoodName(good)) ?? []).filter((offer) =>
          qualifierFromKey(good) == null &&
          !offer.flows.some((flow) => baseGoodName(flow.item) === baseGoodName(good))
            ? true
            : offer.flows.some(
                (flow) =>
                  flow.role !== "import" &&
                  columnNet(offer, flow.item) > EPS &&
                  compatibleFlow(flow.item, good),
              ),
        );
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
        const offers = (negativeByGood.get(baseGoodName(flow.item)) ?? []).filter((offer) =>
          offer.flows.some(
            (candidate) =>
              candidate.role === "import" &&
              baseGoodName(candidate.item) === baseGoodName(flow.item) &&
              compatibleFlow(flow.item, candidate.item),
          ),
        );
        if (offers.length === 0) continue;
        const top = Math.max(...offers.map((offer) => offer.priority));
        for (const offer of offers.filter((candidate) => candidate.priority === top)) {
          const key = `${offer.blockId}\u0000${offer.good}`;
          if (selected.has(key)) continue;
          selected.set(key, offer);
          autoSinkGoods.add(flow.item);
          for (const consumed of offer.flows)
            if (
              consumed.role === "import" &&
              baseGoodName(consumed.item) === baseGoodName(flow.item)
            )
              autoSinkGoods.add(consumed.item);
          addedSink = true;
          for (const ingredient of offer.flows) {
            if (
              ingredient.role !== "import" ||
              baseGoodName(ingredient.item) === offer.good ||
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
    const goods = new Set(pins.map(materialPinKey));
    for (const good of fixedNet.keys()) goods.add(good);
    for (const column of columns) for (const flow of column.flows) goods.add(flow.item);
    // Reaching a configured byproduct consumer closes that material balance.
    // Fixed boundary output belongs to the same balance as scalable output: it
    // must feed the consumer too, even when operating that sink needs imports.
    // Otherwise the objective can prefer discarding the byproduct and zeroing a
    // deliberate waste block merely because its supporting inputs are costly.
    const surplusGoods = new Set([...goods].filter((good) => !autoSinkGoods.has(good)));
    const materialGoods = [...goods];

    const constraints: string[] = [];
    const importVarByGood = new Map<string, number>();
    const producerGoals = new Set(
      columns
        .filter((column) => column.sign > 0 && !FREE_GOODS.has(column.good))
        .map((column) => column.good),
    );
    const producerGoods = new Set<string>();
    for (const column of columns.filter((candidate) => candidate.sign > 0))
      for (const flow of column.flows)
        if (
          baseGoodName(flow.item) === column.good &&
          flow.role !== "import" &&
          columnNet(column, flow.item) > EPS
        )
          producerGoods.add(flow.item);
    const transferPairs = [...goods].flatMap((target) => {
      if (qualifierFromKey(target)?.temperatureMode !== "range") return [];
      return [...goods].flatMap((source) => {
        const temperature = exactTemperature(source);
        return temperature != null && compatibleFlow(source, target) ? [{ source, target }] : [];
      });
    });
    const hasProducer = (good: string) => {
      if (!producerGoals.has(baseGoodName(good))) return false;
      const qualifier = qualifierFromKey(good);
      if (!qualifier) return true;
      return (
        producerGoods.has(good) ||
        (qualifier.temperatureMode === "range" &&
          [...producerGoods].some((source) => compatibleFlow(source, good)))
      );
    };
    for (const good of materialGoods) {
      const parts: string[] = [];
      columns.forEach((column, index) => {
        const net = columnNet(column, good);
        if (Math.abs(net) > EPS) parts.push(lpTerm(net, `x${index}`));
      });
      transferPairs.forEach((pair, index) => {
        if (pair.source === good) parts.push(`- 1 transfer_${index}`);
        if (pair.target === good) parts.push(`+ 1 transfer_${index}`);
      });
      if ((!hasProducer(good) && !autoSinkGoods.has(good)) || FREE_GOODS.has(good)) {
        importVarByGood.set(good, constraints.length);
        parts.push(`+ 1 import_${constraints.length}`);
      }
      if (surplusGoods.has(good)) parts.push(`- 1 surplus_${constraints.length}`);
      constraints.push(
        `g${constraints.length}: ${parts.join(" ")} = ${(pinByMaterialGood.get(good)?.rate ?? 0) - (fixedNet.get(good) ?? 0)}`,
      );
    }

    // A declared producer may cover demand for its own goal, but may not run
    // beyond that demand just to obtain an incidental output. Incidental supply
    // can still reduce the declared producer's activity or remain surplus.
    for (const good of producerGoals) {
      const parts: string[] = [];
      columns.forEach((column, index) => {
        const net = columnBaseNet(column, good);
        if (column.sign > 0 && column.good === good && net > EPS)
          parts.push(lpTerm(net, `x${index}`));
        else if (net < -EPS) parts.push(lpTerm(net, `x${index}`));
      });
      const cap = Math.max(
        0,
        (pinByGood.get(good)?.rate ?? 0) -
          mapBaseNet(new Map([...fixedNet].map(([key, net]) => [key, { net }])), good),
      );
      constraints.push(`cap${constraints.length}: ${parts.join(" ")} <= ${cap + 1e-6}`);
    }

    const objective =
      [
        ...[...importVarByGood.values()].map((index) => `+ 1000000 import_${index}`),
        ...columns.map(
          (column, index) => `+ ${1 + Math.max(0, -column.priority) * 0.001} x${index}`,
        ),
        ...transferPairs.map((_, index) => `+ 0.000001 transfer_${index}`),
      ].join(" ") || "+ 0 surplus_0";
    const bounds = [
      ...columns.map((_, index) => `0 <= x${index} <= 1e9`),
      ...transferPairs.map((_, index) => `0 <= transfer_${index} <= 1e12`),
      ...materialGoods.flatMap((good, index) => [
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
    progress?.update({
      phase: "solving",
      message: `Solving factory model · ${columns.length} activities`,
      pass,
      maxPasses: MAX_LINEARIZATION_PASSES,
      current: undefined,
      total: undefined,
    });
    const highs = await highsLoader();
    const solution = highs.solve(model);
    const optimal = solution.Status === "Optimal";
    const materialConflicts: FactoryValidation["materialConflicts"] = [];
    if (!optimal) {
      // Relax one material balance at a time while keeping every pin, producer
      // cap, and other material balance intact. A relaxation that repairs the
      // model identifies a concrete conflict without letting a smaller-unit
      // upstream good hide the actual missing downstream material.
      materialGoods.forEach((good, goodIndex) => {
        const relaxedConstraints = constraints.map((constraint, index) =>
          index === goodIndex
            ? constraint.replace(" =", ` + 1 shortage_${goodIndex} - 1 excess_${goodIndex} =`)
            : constraint,
        );
        const relaxedModel = `Minimize\n obj: + 1000000000 shortage_${goodIndex} + 1000000000 excess_${goodIndex} ${objective}\nSubject To\n ${relaxedConstraints.join("\n ")}\nBounds\n ${bounds.join("\n ")}\n 0 <= shortage_${goodIndex} <= 1e12\n 0 <= excess_${goodIndex} <= 1e12\nEnd`;
        const relaxed = highs.solve(relaxedModel);
        if (relaxed.Status !== "Optimal") return;
        const shortage =
          (relaxed.Columns[`shortage_${goodIndex}`] as { Primal?: number } | undefined)?.Primal ??
          0;
        const excess =
          (relaxed.Columns[`excess_${goodIndex}`] as { Primal?: number } | undefined)?.Primal ?? 0;
        if (shortage <= 1e-4 && excess <= 1e-4) return;

        const blockDetails = new Map<
          number,
          FactoryValidation["materialConflicts"][number]["blocks"][number]
        >();
        const detail = (id: number, name: string) => {
          const existing = blockDetails.get(id);
          if (existing) return existing;
          const created = {
            id,
            name,
            supplied: 0,
            consumed: 0,
            configuredProducer: false,
            scalableProducer: false,
          };
          blockDetails.set(id, created);
          return created;
        };
        let requiredRate = Math.max(0, pinByGood.get(good)?.rate ?? 0);
        let availableRate = 0;
        responses.forEach((response, responseIndex) => {
          const row = rows[responseIndex]?.row;
          if (!row) return;
          for (const flow of response.fixed.filter((candidate) => candidate.item === good)) {
            const block = detail(row.id, row.name);
            if (flow.net > 0) {
              availableRate += flow.net;
              block.supplied += flow.net;
            } else {
              requiredRate -= flow.net;
              block.consumed -= flow.net;
            }
          }
        });
        columns.forEach((column, columnIndex) => {
          const amount =
            (relaxed.Columns[`x${columnIndex}`] as { Primal?: number } | undefined)?.Primal ?? 0;
          const net = columnNet(column, good) * amount;
          if (Math.abs(net) <= EPS) return;
          const block = detail(column.blockId, column.blockName);
          if (net > 0) {
            availableRate += net;
            block.supplied += net;
          } else {
            requiredRate -= net;
            block.consumed -= net;
          }
        });
        for (const producer of positiveByGood.get(baseGoodName(good)) ?? []) {
          const block = detail(producer.blockId, producer.blockName);
          block.configuredProducer = true;
          block.scalableProducer ||= columnNet(producer, good) > EPS;
        }
        const direction = shortage >= excess ? "shortage" : "excess";
        materialConflicts.push({
          good: baseGoodName(good),
          kind: kindOf.get(good) ?? "item",
          direction,
          amount: round(direction === "shortage" ? shortage : excess),
          required: round(requiredRate),
          available: round(availableRate),
          blocks: [...blockDetails.values()]
            .map((block) => ({
              ...block,
              supplied: round(block.supplied),
              consumed: round(block.consumed),
            }))
            .filter(
              (block) => block.supplied > 1e-4 || block.consumed > 1e-4 || block.configuredProducer,
            )
            .sort((a, b) => b.consumed + b.supplied - (a.consumed + a.supplied) || a.id - b.id),
        });
      });
      materialConflicts.sort((a, b) => b.amount - a.amount);
    }
    const columnAmounts = columns.map((_, index) =>
      optimal
        ? ((solution.Columns[`x${index}`] as { Primal?: number } | undefined)?.Primal ?? 0)
        : 0,
    );

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
      const amount = columnAmounts[index] ?? 0;
      targetByGoal.set(`${column.blockId}\u0000${column.good}`, {
        // Keep solver precision for apply/validation. Four-decimal goal
        // rounding can amplify into whole units on high-throughput recipes.
        rate: column.sign * amount,
        kind: column.kind,
      });
    });

    // An x value is the extra dedicated production needed after coproducts are
    // credited. It is not necessarily the useful block goal. Keep the portion
    // of factory demand already covered by another recipe in the same block as
    // that block's goal, then let the full block solve below prove that raising
    // the minimum goal does not activate additional recipes.
    const factoryNeedByGood = new Map<string, number>();
    const outputByBlockGood = new Map<string, number>();
    for (const pin of pins)
      if (pin.rate > EPS) add(factoryNeedByGood, materialPinKey(pin), pin.rate);
    responses.forEach((response, responseIndex) => {
      const blockId = rows[responseIndex]?.row.id;
      if (blockId == null) return;
      for (const flow of response.fixed) {
        if (flow.net < -EPS) add(factoryNeedByGood, flow.item, -flow.net);
        if (flow.net > EPS) add(outputByBlockGood, `${blockId}\u0000${flow.item}`, flow.net);
      }
    });
    columns.forEach((column, index) => {
      const amount = columnAmounts[index] ?? 0;
      for (const flow of column.flows) {
        if (flow.role === "import") add(factoryNeedByGood, flow.item, amount * flow.rate);
        else add(outputByBlockGood, `${column.blockId}\u0000${flow.item}`, amount * flow.rate);
      }
    });
    const dedicatedRateByGoal = new Map(
      [...targetByGoal].map(([key, target]) => [key, target.rate] as const),
    );
    const recoveredRateByGoal = new Map<string, number>();
    const recoveredAllocations: PinnedFactoryResult["supplyAllocations"] = [];

    // Consumer ranges and exact producer outputs are separate factory rows.
    // Recover goal rate on the SOURCE identity selected by the solved transfer,
    // not by collapsing every temperature to the base fluid (which could let a
    // 2000 C producer claim demand that only accepts 250 C).
    const recoveryNeedByGood = new Map<string, number>();
    for (const [good, rate] of factoryNeedByGood)
      if (qualifierFromKey(good)?.temperatureMode !== "range") add(recoveryNeedByGood, good, rate);
    transferPairs.forEach((pair, index) => {
      const rate = optimal
        ? ((solution.Columns[`transfer_${index}`] as { Primal?: number } | undefined)?.Primal ?? 0)
        : 0;
      if (rate > EPS) add(recoveryNeedByGood, pair.source, rate);
    });

    const suppliedByGoal = new Map<string, number>();
    const allocationByGoal = new Map<
      string,
      { blockId: number; blockName: string; good: string; kind: string; priority: number }
    >();
    for (const [good, factoryNeed] of recoveryNeedByGood) {
      const base = baseGoodName(good);
      const goalBlocks = rows.flatMap(({ row, originalDoc }) => {
        const goal = originalDoc.goals.find(
          (candidate) => candidate.name === base && !goalConsumes(candidate),
        );
        if (!goal) return [];
        const key = `${row.id}\u0000${base}`;
        const output = outputByBlockGood.get(`${row.id}\u0000${good}`) ?? 0;
        const dedicated = Math.max(0, dedicatedRateByGoal.get(key) ?? 0);
        const priority = originalDoc.supplyPriorities?.[base] ?? originalDoc.supplyPriority ?? 0;
        return [{ key, row, output, dedicated, priority }];
      });
      const goalBlockIds = new Set(goalBlocks.map(({ row }) => row.id));
      const unownedOutput = [...outputByBlockGood].reduce((total, [key, output]) => {
        const separator = key.indexOf("\u0000");
        const blockId = Number(key.slice(0, separator));
        const outputGood = key.slice(separator + 1);
        return outputGood === good && !goalBlockIds.has(blockId) ? total + output : total;
      }, 0);
      let remaining = Math.max(0, factoryNeed - unownedOutput);
      goalBlocks.sort(
        (a, b) =>
          Math.max(0, b.output - b.dedicated) - Math.max(0, a.output - a.dedicated) ||
          b.priority - a.priority ||
          a.row.id - b.row.id,
      );
      for (const allocation of goalBlocks) {
        const supplied = Math.min(allocation.output, remaining);
        remaining = Math.max(0, remaining - supplied);
        add(suppliedByGoal, allocation.key, supplied);
        allocationByGoal.set(allocation.key, {
          blockId: allocation.row.id,
          blockName: allocation.row.name,
          good: base,
          kind: kindOf.get(good) ?? kindOf.get(base) ?? "item",
          priority: allocation.priority,
        });
      }
    }

    // A single block goal may distribute across more than one exact-temperature
    // output. Recombine compatible allocations before setting its one saved rate.
    for (const [key, supplied] of suppliedByGoal) {
      const dedicated = Math.max(0, dedicatedRateByGoal.get(key) ?? 0);
      const retainedGoal = Math.max(dedicated, supplied);
      const target = targetByGoal.get(key);
      if (target && retainedGoal > target.rate + EPS)
        targetByGoal.set(key, { ...target, rate: retainedGoal });

      const separator = key.indexOf("\u0000");
      const blockId = Number(key.slice(0, separator));
      const base = key.slice(separator + 1);
      const output = [...outputByBlockGood].reduce((sum, [outputKey, rate]) => {
        const outputSeparator = outputKey.indexOf("\u0000");
        return Number(outputKey.slice(0, outputSeparator)) === blockId &&
          baseGoodName(outputKey.slice(outputSeparator + 1)) === base
          ? sum + rate
          : sum;
      }, 0);
      const recovered = Math.max(0, Math.min(supplied, output - dedicated));
      if (recovered <= EPS) continue;
      recoveredRateByGoal.set(key, recovered);
      const allocation = allocationByGoal.get(key);
      if (allocation)
        recoveredAllocations.push({
          blockId: allocation.blockId,
          blockName: allocation.blockName,
          good: allocation.good,
          kind: allocation.kind,
          priority: allocation.priority,
          incidental: true,
          rate: round(recovered),
        });
    }
    const factorySurplusByGood = new Map(
      [...goods].map((good, index) => [
        good,
        optimal
          ? ((solution.Columns[`surplus_${index}`] as { Primal?: number } | undefined)?.Primal ?? 0)
          : 0,
      ]),
    );
    // Every non-stock goal is a factory decision variable. If it was reached
    // by neither demand nor a natural byproduct sink chain, its value is zero.
    const allGoalChanges: FactoryGoalChange[] = rows.flatMap(({ row, originalDoc }) =>
      originalDoc.goals.flatMap((goal) => {
        const key = `${row.id}\u0000${goal.name}`;
        const target = targetByGoal.get(key);
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
            dedicatedRate: dedicatedRateByGoal.get(key) ?? 0,
            factoryNeed: round(
              [...factoryNeedByGood].reduce(
                (sum, [good, rate]) => (baseGoodName(good) === goal.name ? sum + rate : sum),
                0,
              ),
            ),
            projectedOutput: round(
              [...outputByBlockGood].reduce((sum, [outputKey, rate]) => {
                const separator = outputKey.indexOf("\u0000");
                return Number(outputKey.slice(0, separator)) === row.id &&
                  baseGoodName(outputKey.slice(separator + 1)) === goal.name
                  ? sum + rate
                  : sum;
              }, 0),
            ),
            factorySurplus: round(
              [...factorySurplusByGood].reduce(
                (sum, [good, rate]) => (baseGoodName(good) === goal.name ? sum + rate : sum),
                0,
              ),
            ),
            recoveredRate: round(recoveredRateByGoal.get(key) ?? 0),
            scale: round(Math.abs(current) > EPS ? requiredRate / current : requiredRate),
            delta: round(requiredRate - current),
            goal: true as const,
            ...(goal.temperature != null ? { temperature: goal.temperature } : {}),
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
    const rawByGood = new Map<string, { kind: string; projected: number }>();
    [...goods].forEach((good, index) => {
      if (!importVarByGood.has(good)) return [];
      const projected = optimal
        ? ((solution.Columns[`import_${index}`] as { Primal?: number } | undefined)?.Primal ?? 0)
        : 0;
      const base = baseGoodName(good);
      if (projected <= EPS && (currentConsumed.get(base) ?? 0) <= EPS) return;
      const current = rawByGood.get(base) ?? {
        kind: kindOf.get(good) ?? kindOf.get(base) ?? "item",
        projected: 0,
      };
      current.projected += projected;
      rawByGood.set(base, current);
    });
    const rawImports = [...rawByGood].map(([good, flow]) => ({
      good,
      kind: flow.kind,
      current: round(
        Math.max(0, (currentConsumed.get(good) ?? 0) - (currentProduced.get(good) ?? 0)),
      ),
      projected: round(flow.projected),
    }));
    const surplusByGood = new Map<string, { kind: string; projected: number }>();
    [...goods].forEach((good, index) => {
      const projected = optimal
        ? ((solution.Columns[`surplus_${index}`] as { Primal?: number } | undefined)?.Primal ?? 0)
        : 0;
      if (projected <= 1e-4) return;
      const base = baseGoodName(good);
      const current = surplusByGood.get(base) ?? {
        kind: kindOf.get(good) ?? kindOf.get(base) ?? "item",
        projected: 0,
      };
      current.projected += projected;
      surplusByGood.set(base, current);
    });
    const surplus = [...surplusByGood].map(([good, flow]) => ({
      good,
      kind: flow.kind,
      cls: "surplus" as const,
      projected: round(flow.projected),
      absorb: null,
    }));
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
      const amount = columnAmounts[index] ?? 0;
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
      supplyAllocations: recoveredAllocations.sort((a, b) => b.rate - a.rate),
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
      validation: null,
    };
    if (!optimal)
      result.validation = {
        materialConflicts,
        blocks: [],
        discrepancies: [],
        unstableGoals: [],
      };

    if (optimal) {
      const proposedRates = new Map<string, number>();
      const referenceRates = new Map<string, number>(
        rows.flatMap(({ row, doc }) =>
          doc.goals.map((goal) => [`${row.id}\u0000${goal.name}`, goal.rate] as const),
        ),
      );
      let validatedBlocks = 0;
      progress?.update({
        phase: "validating",
        message: `Validating blocks · pass ${pass}/${MAX_LINEARIZATION_PASSES} · 0/${rows.length}`,
        pass,
        maxPasses: MAX_LINEARIZATION_PASSES,
        current: 0,
        total: rows.length,
      });
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
          validatedBlocks += 1;
          progress?.update({
            phase: "validating",
            message: `Validating blocks · pass ${pass}/${MAX_LINEARIZATION_PASSES} · ${validatedBlocks}/${rows.length}`,
            pass,
            maxPasses: MAX_LINEARIZATION_PASSES,
            current: validatedBlocks,
            total: rows.length,
          });
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
          message: blockResult.message,
          unmade: blockResult.unmade ?? [],
        })),
      });
      const broken = solved.filter(
        (entry) => entry.result.broken || entry.result.status !== "solved",
      );
      if (broken.length > 0) {
        result.status = "ValidationFailed";
        result.residual = 1;
        result.validation = {
          materialConflicts: [],
          blocks: broken.map(({ row, doc, result: blockResult }) => ({
            id: row.id,
            name: row.name,
            status: blockResult.status,
            ...(blockResult.message ? { message: blockResult.message } : {}),
            goals: doc.goals.map((goal) => ({
              good: goal.name,
              rate: goal.rate,
              ...(goal.direction ? { direction: goal.direction } : {}),
            })),
            unmade: blockResult.unmade ?? [],
          })),
          discrepancies: [],
          unstableGoals: [],
        };
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
            const key = qualifiedGoodKey(flow);
            add(actualNet, key, flow.rate * (flow.role === "import" ? -1 : 1));
            add(actualGross, key, flow.rate);
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
              good: baseGoodName(good),
              expected: round(expected),
              actual: round(actual),
              relative: round(relative),
            });
        }
        discrepancies.sort((a, b) => b.relative - a.relative);
        const goalDifferences = [...proposedRates].flatMap(([key, rate]) => {
          const reference = referenceRates.get(key) ?? 0;
          const delta = Math.abs(rate - reference);
          if (!meaningfulRateChange(reference, rate)) return [];
          const separator = key.indexOf("\u0000");
          const blockId = Number(key.slice(0, separator));
          const good = key.slice(separator + 1);
          return [
            {
              blockId,
              blockName: rows.find(({ row }) => row.id === blockId)?.row.name ?? `Block ${blockId}`,
              good,
              reference,
              rate,
              delta,
            },
          ];
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
            progress?.update({
              phase: "refining",
              message: `Refining scenario · starting pass ${pass + 1}/${MAX_LINEARIZATION_PASSES}`,
              pass: pass + 1,
              maxPasses: MAX_LINEARIZATION_PASSES,
              current: undefined,
              total: undefined,
            });
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
              progress,
            );
            if (ownsTrace) trace?.finish(refined);
            return refined;
          }
          result.status = "ValidationFailed";
          result.validation = {
            materialConflicts: [],
            blocks: [],
            discrepancies: discrepancies.slice(0, 20),
            unstableGoals: goalDifferences.slice(0, 20),
          };
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
  progress?: FactorySolveProgressReporter | null,
) {
  const trace = startFactorySolverTrace("balance-apply");
  const complete = <T>(result: T): T => {
    trace?.finish(result);
    return result;
  };
  try {
    const plan = await solvePinnedFactory(
      demandOverrides,
      "balance-apply",
      trace,
      undefined,
      1,
      progress,
    );
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
    const enabledBlocks = q.blocksWithFlows();
    let validatedBlocks = 0;
    progress?.update({
      phase: "validating",
      message: `Final safety validation · 0/${enabledBlocks.length}`,
      current: 0,
      total: enabledBlocks.length,
    });
    for (const block of enabledBlocks) {
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
      validatedBlocks += 1;
      progress?.update({
        phase: "validating",
        message: `Final safety validation · ${validatedBlocks}/${enabledBlocks.length}`,
        current: validatedBlocks,
        total: enabledBlocks.length,
      });
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
        const key = qualifiedGoodKey(flow);
        add(actualNet, key, flow.rate * (flow.role === "import" ? -1 : 1));
        add(actualGross, key, flow.rate);
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
    const changedEntries = solved.filter((entry) => entry.changed);
    let appliedBlocks = 0;
    progress?.update({
      phase: "applying",
      message: `Applying scenario · 0/${changedEntries.length}`,
      current: 0,
      total: changedEntries.length,
    });
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
        appliedBlocks += 1;
        progress?.update({
          phase: "applying",
          message: `Applying scenario · ${appliedBlocks}/${changedEntries.length}`,
          current: appliedBlocks,
          total: changedEntries.length,
        });
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
