/**
 * `state.research` — the mod pushes the force's full researched-tech set. We store
 * it as the planning horizon's researched set (the same slot the manual picker
 * fills), so the existing "now"-mode availability uses real unlock state with no
 * extra wiring. Fire-and-forget: no response needed.
 */
import type { BridgeRequest, BridgeResponse } from "../protocol.ts";

const lib = () => import("../../../db/queries.ts");

export async function handleResearch(req: BridgeRequest): Promise<BridgeResponse | null> {
  const payload = (req.payload ?? {}) as { researched?: unknown; force?: unknown };
  const researched = Array.isArray(payload.researched)
    ? payload.researched.filter((t): t is string => typeof t === "string")
    : [];

  const q = await lib();
  q.setResearchHorizon({ researched });
  q.metaSet("research_synced_at", new Date().toISOString());
  q.metaSet("research_synced_count", String(researched.length));
  return null;
}
