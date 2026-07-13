import { readAppConfig } from "./app-config.server.ts";

const MAX_EVENTS = 100;
const MAX_JSON_CHARS = 2_000_000;
let sequence = 0;
let latestTrace: FactorySolverTrace | null = null;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type FactorySolverTraceEvent = {
  atMs: number;
  type: string;
  data: JsonValue;
};

export type FactorySolverTrace = {
  version: 1;
  id: number;
  source: "scenario-preview" | "balance-apply";
  startedAt: string;
  completedAt?: string;
  status: "running" | "complete" | "failed";
  truncated: boolean;
  events: FactorySolverTraceEvent[];
};

export type FactorySolverTraceRecorder = {
  event(type: string, data: unknown): void;
  finish(data: unknown): void;
  fail(error: unknown): void;
};

/** Start a bounded in-memory trace for the most recent factory solve. Tracing is
 * deliberately app-level and opt-in: normal Scenario typing does no diagnostic
 * allocation beyond this single config read. Starting a newer solve replaces the
 * visible trace, while an older concurrent solve can only mutate its own object. */
export function startFactorySolverTrace(
  source: FactorySolverTrace["source"],
): FactorySolverTraceRecorder | null {
  if (!readAppConfig().factorySolverDebug) return null;
  const started = performance.now();
  let jsonChars = 0;
  const trace: FactorySolverTrace = {
    version: 1,
    id: ++sequence,
    source,
    startedAt: new Date().toISOString(),
    status: "running",
    truncated: false,
    events: [],
  };
  latestTrace = trace;

  const event = (type: string, data: unknown) => {
    if (trace.events.length >= MAX_EVENTS) {
      trace.truncated = true;
      return;
    }
    const json = JSON.stringify(data) ?? "null";
    if (jsonChars + json.length > MAX_JSON_CHARS) {
      trace.truncated = true;
      trace.events.push({
        atMs: +(performance.now() - started).toFixed(2),
        type,
        data: { omitted: true, jsonChars: json.length },
      });
      return;
    }
    jsonChars += json.length;
    trace.events.push({
      atMs: +(performance.now() - started).toFixed(2),
      type,
      data: JSON.parse(json) as JsonValue,
    });
  };
  return {
    event,
    finish(data) {
      event("finish", data);
      trace.status = "complete";
      trace.completedAt = new Date().toISOString();
    },
    fail(error) {
      event("failure", {
        message: error instanceof Error ? error.message : String(error),
      });
      trace.status = "failed";
      trace.completedAt = new Date().toISOString();
    },
  };
}

export function getLatestFactorySolverTrace(): FactorySolverTrace | null {
  return latestTrace == null ? null : structuredClone(latestTrace);
}

export function clearLatestFactorySolverTrace(): void {
  latestTrace = null;
}
