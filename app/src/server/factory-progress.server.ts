export type FactorySolvePhase =
  | "preparing"
  | "responses"
  | "solving"
  | "validating"
  | "refining"
  | "applying"
  | "complete"
  | "failed";

export type FactorySolveProgress = {
  requestId: string;
  source: "scenario-preview" | "balance-apply";
  phase: FactorySolvePhase;
  message: string;
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
  pass?: number;
  maxPasses?: number;
  current?: number;
  total?: number;
};

export type FactorySolveProgressUpdate = Partial<
  Pick<FactorySolveProgress, "phase" | "message" | "pass" | "maxPasses" | "current" | "total">
>;

export type FactorySolveProgressReporter = {
  update(update: FactorySolveProgressUpdate): void;
  complete(message?: string): void;
  fail(error: unknown): void;
};

type StoredProgress = Omit<FactorySolveProgress, "elapsedMs"> & { startedMs: number };

const MAX_AGE_MS = 10 * 60_000;
const MAX_ENTRIES = 100;
const progressByRequest = new Map<string, StoredProgress>();

function prune(now = Date.now()) {
  for (const [requestId, progress] of progressByRequest)
    if (now - progress.startedMs > MAX_AGE_MS) progressByRequest.delete(requestId);
}

export function startFactorySolveProgress(
  requestId: string | undefined,
  source: FactorySolveProgress["source"],
): FactorySolveProgressReporter | null {
  if (!requestId) return null;
  prune();
  while (progressByRequest.size >= MAX_ENTRIES) {
    const oldest = progressByRequest.keys().next().value;
    if (oldest == null) break;
    progressByRequest.delete(oldest);
  }
  const now = new Date();
  const progress: StoredProgress = {
    requestId,
    source,
    phase: "preparing",
    message: "Checking saved block projections",
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    startedMs: Date.now(),
  };
  progressByRequest.set(requestId, progress);

  const update = (next: FactorySolveProgressUpdate) => {
    Object.assign(progress, next, { updatedAt: new Date().toISOString() });
    progressByRequest.set(requestId, progress);
  };
  return {
    update,
    complete(message = "Scenario is up to date") {
      update({ phase: "complete", message, current: undefined, total: undefined });
    },
    fail(error) {
      update({
        phase: "failed",
        message: error instanceof Error ? error.message : String(error),
        current: undefined,
        total: undefined,
      });
    },
  };
}

export function getFactorySolveProgress(requestId: string): FactorySolveProgress | null {
  prune();
  const stored = progressByRequest.get(requestId);
  if (!stored) return null;
  const { startedMs, ...progress } = stored;
  return { ...progress, elapsedMs: Math.max(0, Date.now() - startedMs) };
}
