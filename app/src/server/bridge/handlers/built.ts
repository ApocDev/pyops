/**
 * `state.built` — the mod pushes how many of each machine the player has placed,
 * keyed by the recipe each is set to craft (a one-scan of force entities reading
 * entity.get_recipe() where available). We replace the stored snapshot;
 * required-vs-built (per recipe) is derived on read (machineSufficiency). No
 * re-solve needed — built counts don't change any block's solution, only how it's
 * reported against reality.
 */
import type { BridgeRequest, BridgeResponse } from "../protocol.ts";

const lib = () => import("../../../db/queries.ts");

export async function handleBuilt(req: BridgeRequest): Promise<BridgeResponse | null> {
  const payload = (req.payload ?? {}) as { machines?: unknown };
  const entries: { machine: string; recipe: string; count: number }[] = [];
  if (Array.isArray(payload.machines)) {
    for (const raw of payload.machines as unknown[]) {
      if (!raw || typeof raw !== "object") continue;
      const m = raw as { machine?: unknown; recipe?: unknown; count?: unknown };
      if (typeof m.machine !== "string") continue;
      if (typeof m.count !== "number" || !Number.isFinite(m.count)) continue;
      entries.push({
        machine: m.machine,
        recipe: typeof m.recipe === "string" ? m.recipe : "",
        count: m.count,
      });
    }
  }

  const q = await lib();
  const res = q.setBuiltMachines(entries);
  q.metaSet("built_synced_at", new Date().toISOString());
  q.metaSet("built_synced_count", String(res.total));
  return null;
}
