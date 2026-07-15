import { createHash } from "node:crypto";

import * as q from "../db/queries.server.ts";
import {
  currentSolveGeneration,
  solveGenerationNeedsRefresh,
} from "../db/solve-generation.server.ts";
import { ensureSolvedProjections } from "./block-compute.server.ts";
import {
  applyPinnedFactory,
  getFactoryPins,
  saveFactoryPins,
  solvePinnedFactory,
  type PinnedFactoryResult,
} from "./factory-plan.server.ts";
import {
  getFactorySolveProgress,
  startFactorySolveProgress,
  type FactorySolveProgress,
} from "./factory-progress.server.ts";

const CACHE_META_KEY = "factory_scenario_cache_v1";
const CACHE_VERSION = 1;
// Bump when the Scenario model changes in a way that leaves block projection
// fingerprints untouched. Block/reference changes are covered by stateKey.
const SCENARIO_MODEL_VERSION = "scenario-v1";

type ScenarioCacheRecord = {
  version: 1;
  stateKey: string;
  demandKey: string;
  calculatedAt: string;
  durationMs: number;
  result: PinnedFactoryResult;
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function scenarioStateKey(): string {
  const meta = q.metaAll();
  return hash({
    model: SCENARIO_MODEL_VERSION,
    solveGeneration: currentSolveGeneration(),
    projectionsNeedRefresh: solveGenerationNeedsRefresh(),
    dataFingerprint: meta.data_fingerprint ?? null,
    blocks: q.factoryScenarioCacheBlocks(),
  });
}

/** Effective pins, not raw overrides: once an edited target is persisted, the
 * same calculated result remains reusable on the next visit with no overrides. */
function scenarioDemandKey(overrides: Record<string, number>): string {
  return hash(
    getFactoryPins()
      .map((pin) => ({
        good: pin.good,
        kind: pin.kind,
        rate: overrides[pin.good] ?? pin.rate,
        source: pin.source ?? null,
      }))
      .sort((a, b) => a.good.localeCompare(b.good)),
  );
}

function factoryScenarioCacheIdentity(overrides: Record<string, number> = {}) {
  return { stateKey: scenarioStateKey(), demandKey: scenarioDemandKey(overrides) };
}

function readCache(): ScenarioCacheRecord | null {
  const raw = q.metaAll()[CACHE_META_KEY];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ScenarioCacheRecord>;
    return parsed.version === CACHE_VERSION && parsed.result && parsed.stateKey && parsed.demandKey
      ? (parsed as ScenarioCacheRecord)
      : null;
  } catch {
    return null;
  }
}

function pseudoDisplay(name: string) {
  if (name === "pyops-heat") return "Heat";
  if (name === "pyops-electricity") return "Electricity";
  if (name === "pyops-fluid-fuel") return "Fluid fuel";
  return null;
}

function presentResult(result: PinnedFactoryResult) {
  const { allGoalChanges: _allGoalChanges, ...visibleResult } = result;
  const display = (name: string) => pseudoDisplay(name) ?? q.classifyRef(name)?.display ?? name;
  return {
    ...visibleResult,
    demands: result.demands.map((good) => ({ ...good, display: display(good.good) })),
    raws: result.raws.map((good) => ({ ...good, display: display(good.good) })),
    overproduced: result.overproduced.map((good) => ({
      ...good,
      display: display(good.good),
    })),
    validation: result.validation && {
      ...result.validation,
      materialConflicts: result.validation.materialConflicts.map((conflict) => ({
        ...conflict,
        display: display(conflict.good),
      })),
      blocks: result.validation.blocks.map((block) => ({
        ...block,
        goals: block.goals.map((goal) => ({ ...goal, display: display(goal.good) })),
        unmade: block.unmade.map((good) => ({ good, display: display(good) })),
      })),
      discrepancies: result.validation.discrepancies.map((flow) => ({
        ...flow,
        display: display(flow.good),
      })),
      unstableGoals: result.validation.unstableGoals.map((goal) => ({
        ...goal,
        display: display(goal.good),
      })),
    },
    goalChanges: result.goalChanges.map((change) => ({
      ...change,
      display: display(change.good),
    })),
    supplyAllocations: result.supplyAllocations.map((allocation) => ({
      ...allocation,
      display: display(allocation.good),
    })),
  };
}

export type FactoryScenarioSnapshot = {
  state: "current" | "stale" | "empty";
  result: ReturnType<typeof presentResult> | null;
  calculatedAt: string | null;
  durationMs: number | null;
};

function snapshotFor(overrides: Record<string, number> = {}): FactoryScenarioSnapshot {
  const cached = readCache();
  if (!cached) return { state: "empty", result: null, calculatedAt: null, durationMs: null };
  const identity = factoryScenarioCacheIdentity(overrides);
  const current = cached.stateKey === identity.stateKey && cached.demandKey === identity.demandKey;
  return {
    state: current ? "current" : "stale",
    result: presentResult(cached.result),
    calculatedAt: cached.calculatedAt,
    durationMs: cached.durationMs,
  };
}

export function getFactoryScenarioSnapshot(): FactoryScenarioSnapshot {
  return snapshotFor();
}

export async function calculateFactoryScenario({
  demands = {},
  requestId,
}: {
  demands?: Record<string, number>;
  requestId?: string;
}): Promise<FactoryScenarioSnapshot> {
  const progress = startFactorySolveProgress(requestId, "scenario-preview");
  const started = performance.now();
  try {
    progress?.update({ phase: "preparing", message: "Checking saved block projections" });
    if (Object.keys(demands).length > 0) {
      saveFactoryPins(
        getFactoryPins().map((pin) => ({
          ...pin,
          rate: demands[pin.good] ?? pin.rate,
        })),
      );
    }
    await ensureSolvedProjections();
    const stateKey = scenarioStateKey();
    const demandKey = scenarioDemandKey(demands);
    const result = await solvePinnedFactory(
      demands,
      "scenario-preview",
      undefined,
      undefined,
      1,
      progress,
    );
    const record: ScenarioCacheRecord = {
      version: CACHE_VERSION,
      stateKey,
      demandKey,
      calculatedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started),
      result,
    };
    q.metaSet(CACHE_META_KEY, JSON.stringify(record));
    progress?.complete(
      result.status === "Optimal"
        ? "Scenario is up to date"
        : `Scenario finished: ${result.status}`,
    );
    return {
      state: "current",
      result: presentResult(result),
      calculatedAt: record.calculatedAt,
      durationMs: record.durationMs,
    };
  } catch (error) {
    progress?.fail(error);
    throw error;
  }
}

export async function applyFactoryScenario({
  demands = {},
  requestId,
}: {
  demands?: Record<string, number>;
  requestId?: string;
}) {
  const progress = startFactorySolveProgress(requestId, "balance-apply");
  try {
    progress?.update({ phase: "preparing", message: "Preparing final scenario validation" });
    await ensureSolvedProjections();
    const result = await applyPinnedFactory(demands, true, progress);
    progress?.complete(
      result.status === "Optimal" ? "Scenario applied" : `Apply failed: ${result.status}`,
    );
    return result;
  } catch (error) {
    progress?.fail(error);
    throw error;
  }
}

export function factoryScenarioProgress(requestId: string): FactorySolveProgress | null {
  return getFactorySolveProgress(requestId);
}
