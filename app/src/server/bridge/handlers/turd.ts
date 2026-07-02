/**
 * `state.turd` — the mod pushes the player's TURD selections (master tech →
 * chosen sub-tech), read in-game from pyalienlife's pywiki_turd_page interface.
 * We replace our stored selections with the matched set, and — since TURD changes
 * machine throughput — re-solve cached blocks when it actually changed. Unknown
 * (master, sub) names (a runtime↔dump mismatch) are recorded for diagnosis.
 */
import type { BridgeRequest, BridgeResponse } from "../protocol.ts";
import * as q from "../../../db/queries.server.ts";
import { resolveAllBlocks } from "../../block-compute.server.ts";

export async function handleTurd(req: BridgeRequest): Promise<BridgeResponse | null> {
  const payload = (req.payload ?? {}) as { selections?: unknown };
  const selections: Record<string, string> = {};
  if (payload.selections && typeof payload.selections === "object") {
    for (const [master, sub] of Object.entries(payload.selections as Record<string, unknown>)) {
      if (typeof sub === "string") selections[master] = sub;
    }
  }

  const res = q.setTurdSelectionsBulk(selections);
  q.metaSet("turd_synced_at", new Date().toISOString());
  q.metaSet("turd_synced_count", String(res.applied));
  q.metaSet("turd_synced_unknown", JSON.stringify(res.unknown.slice(0, 20)));

  if (res.changed) {
    // TURD modules change machine throughput → cached block flows are now stale.
    await resolveAllBlocks();
  }
  return null;
}
