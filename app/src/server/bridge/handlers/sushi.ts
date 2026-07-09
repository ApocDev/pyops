/**
 * sushi.trace — the mod's in-game loop tracer just measured (and wired) a belt
 * loop; hold the latest measurement so the sushi planner can offer it as the
 * loop length. In-memory only: a measurement is a point-in-time reading of the
 * save, not project data.
 */
import type { BridgeRequest, BridgeResponse } from "../protocol.ts";

export type SushiTrace = {
  tiles: number;
  belts: number;
  segments: number;
  readers: number;
  skipped: number;
  closed: boolean;
  receivedAt: number;
};

let last: SushiTrace | null = null;

export function handleSushiTrace(req: BridgeRequest): BridgeResponse | null {
  const p = (req.payload ?? {}) as Partial<SushiTrace>;
  if (typeof p.tiles !== "number" || !(p.tiles > 0)) return null;
  last = {
    tiles: Math.round(p.tiles),
    belts: typeof p.belts === "number" ? p.belts : 0,
    segments: typeof p.segments === "number" ? p.segments : 0,
    readers: typeof p.readers === "number" ? p.readers : 0,
    skipped: typeof p.skipped === "number" ? p.skipped : 0,
    closed: p.closed === true,
    receivedAt: Date.now(),
  };
  return null;
}

export function lastSushiTrace(): SushiTrace | null {
  return last;
}
