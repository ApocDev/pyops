/**
 * `state.stats` — the mod pushes the game's live production/consumption rates
 * (per second, force-wide, summed across surfaces) read from the flow statistics.
 * We replace the stored snapshot; the factory ledger compares these actuals
 * against its planned rates. No re-solve — stats don't change any solution.
 */
import type { BridgeRequest, BridgeResponse } from "../protocol.ts";
import * as q from "../../../db/queries.server.ts";

export async function handleStats(req: BridgeRequest): Promise<BridgeResponse | null> {
  const payload = (req.payload ?? {}) as { items?: unknown };
  const entries: { name: string; kind: string; produced: number; consumed: number }[] = [];
  if (Array.isArray(payload.items)) {
    for (const raw of payload.items as unknown[]) {
      if (!raw || typeof raw !== "object") continue;
      const e = raw as { name?: unknown; kind?: unknown; produced?: unknown; consumed?: unknown };
      if (typeof e.name !== "string") continue;
      const produced =
        typeof e.produced === "number" && Number.isFinite(e.produced) ? e.produced : 0;
      const consumed =
        typeof e.consumed === "number" && Number.isFinite(e.consumed) ? e.consumed : 0;
      entries.push({
        name: e.name,
        kind: typeof e.kind === "string" ? e.kind : "item",
        produced,
        consumed,
      });
    }
  }

  const res = q.setProductionStats(entries);
  q.metaSet("stats_synced_at", new Date().toISOString());
  q.metaSet("stats_synced_count", String(res.applied));
  return null;
}
