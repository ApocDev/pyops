/**
 * Bridge message dispatch. Each handler maps one request `type` to a response
 * (or null for fire-and-forget). Keep handlers small and domain-focused; as the
 * integration grows, add new modules (e.g. ./handlers/research.ts) and register
 * them here rather than swelling this file.
 */
import { PROTOCOL_VERSION, type BridgeRequest, type BridgeResponse } from "./protocol.ts";
import { handleResearch } from "./handlers/research.ts";
import { handleTurd } from "./handlers/turd.ts";
import { handleBuilt } from "./handlers/built.ts";
import { handleStats } from "./handlers/stats.ts";
import { handleSushiTrace } from "./handlers/sushi.ts";
import { handleTaskCapture, handleTaskList } from "./handlers/tasks.ts";
import { handleModResult } from "./inspect.ts";

export type BridgeHandler = (
  req: BridgeRequest,
) => BridgeResponse | null | Promise<BridgeResponse | null>;

const handlers: Record<string, BridgeHandler> = {
  // Connection check — the mod's heartbeat. Echo back (with our protocol version
  // so the mod can warn on a mismatch) so it shows "connected".
  "bridge.ping": (req) => ({
    type: "bridge.pong",
    request_id: req.request_id,
    protocol_version: PROTOCOL_VERSION,
  }),
  // Live force state: researched techs → planning horizon's researched set.
  "state.research": handleResearch,
  // Live force state: TURD selections → stored master→sub picks (re-solves blocks).
  "state.turd": handleTurd,
  // Live force state: placed-machine counts → built_machines (required-vs-built view).
  "state.built": handleBuilt,
  // Live force state: production/consumption rates → production_stats (planned-vs-actual).
  "state.stats": handleStats,
  // The in-game sushi tracer measured (and wired) a belt loop — hold the reading.
  "sushi.trace": handleSushiTrace,
  // The in-game New-task dialog filed a task (title/description + best-effort anchors).
  "task.capture": handleTaskCapture,
  // The in-game panel pulls the project's tasks to render (list + detail).
  "task.list": handleTaskList,
  // A reply to an app→mod inspect request (correlated by request_id). Fire-and-forget
  // here — handleModResult resolves the pending promise; no response goes back.
  "bridge.result": (req) => {
    handleModResult(req);
    return null;
  },
};

/** Register a handler for a message type (used by domain modules as they land). */
export function registerHandler(type: string, handler: BridgeHandler): void {
  handlers[type] = handler;
}

/** Route a request to its handler. Unknown types resolve to null (ignored). */
export async function dispatch(req: BridgeRequest): Promise<BridgeResponse | null> {
  const handler = handlers[req.type];
  if (!handler) return null;
  return handler(req);
}
