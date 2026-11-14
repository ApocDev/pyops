/**
 * `state.research` — the mod pushes the force's full researched-tech set. We store
 * it as the planning horizon's researched set (the same slot the manual picker
 * fills), so the existing "now"-mode availability uses real unlock state with no
 * extra wiring. It also carries the force's lab speed and productivity bonuses,
 * which size the science block's labs and pack demand, and the worker robot
 * speed and cargo bonuses for the bot counts. Fire-and-forget: no response
 * needed.
 */
import type { BridgeRequest, BridgeResponse } from "../protocol.ts";
import * as q from "../../../db/queries.server.ts";
import { resolveAllBlocks } from "../../block-compute.server.ts";

export async function handleResearch(req: BridgeRequest): Promise<BridgeResponse | null> {
  const payload = (req.payload ?? {}) as {
    researched?: unknown;
    force?: unknown;
    mining_productivity_bonus?: unknown;
    laboratory_speed_modifier?: unknown;
    laboratory_productivity_bonus?: unknown;
    recipe_productivity_bonuses?: unknown;
    worker_robots_speed_modifier?: unknown;
    worker_robots_storage_bonus?: unknown;
  };
  const researched = Array.isArray(payload.researched)
    ? payload.researched.filter((t): t is string => typeof t === "string")
    : [];
  const hasMiningBonus = Object.prototype.hasOwnProperty.call(payload, "mining_productivity_bonus");
  // A stored bonus PINS mining productivity and skips the tech-derived sum
  // (productivityBonuses), so a synced zero silently overrides the bonus the
  // researched set implies — and it comes back on every sync, defeating a manual
  // reset to Auto. Zero is exactly what "nothing researched" looks like, and Auto
  // derives zero from that same set, so the two agree wherever the game is right
  // and Auto wins where they disagree. Only a positive bonus is worth pinning.
  const miningBonus =
    typeof payload.mining_productivity_bonus === "number" &&
    Number.isFinite(payload.mining_productivity_bonus) &&
    payload.mining_productivity_bonus > 0
      ? payload.mining_productivity_bonus
      : null;
  const hasRecipeBonuses = Object.prototype.hasOwnProperty.call(
    payload,
    "recipe_productivity_bonuses",
  );
  const recipeBonuses =
    payload.recipe_productivity_bonuses &&
    typeof payload.recipe_productivity_bonuses === "object" &&
    !Array.isArray(payload.recipe_productivity_bonuses)
      ? Object.fromEntries(
          Object.entries(payload.recipe_productivity_bonuses)
            .filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]))
            .filter(([, bonus]) => bonus !== 0),
        )
      : null;

  // Lab bonuses change the science block's pins (pack demand and beacon upkeep),
  // so they go through the same change check as the rest. A missing bonus is 0.
  const labBonus = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

  const changed = q.setResearchHorizon({
    researched,
    ...(hasMiningBonus ? { miningProductivityBonus: miningBonus } : {}),
    ...(hasRecipeBonuses ? { recipeProductivityBonuses: recipeBonuses } : {}),
    labSpeedBonus: labBonus(payload.laboratory_speed_modifier),
    labProductivityBonus: labBonus(payload.laboratory_productivity_bonus),
  });
  // Robot bonuses only size the bot counts, never a solve, so they skip the
  // research change check. An older mod that omits them leaves the stored ones.
  for (const [field, key] of [
    ["worker_robots_speed_modifier", "research_worker_robots_speed_bonus"],
    ["worker_robots_storage_bonus", "research_worker_robots_storage_bonus"],
  ] as const) {
    const v = payload[field];
    if (typeof v === "number" && Number.isFinite(v)) q.metaSet(key, String(v));
  }
  q.metaSet("research_synced_at", new Date().toISOString());
  q.metaSet("research_synced_count", String(researched.length));
  if (changed) await resolveAllBlocks();
  return null;
}
