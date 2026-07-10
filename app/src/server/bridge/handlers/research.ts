/**
 * `state.research` — the mod pushes the force's full researched-tech set. We store
 * it as the planning horizon's researched set (the same slot the manual picker
 * fills), so the existing "now"-mode availability uses real unlock state with no
 * extra wiring. Fire-and-forget: no response needed.
 */
import type { BridgeRequest, BridgeResponse } from "../protocol.ts";
import * as q from "../../../db/queries.server.ts";
import { resolveAllBlocks } from "../../block-compute.server.ts";

export async function handleResearch(req: BridgeRequest): Promise<BridgeResponse | null> {
  const payload = (req.payload ?? {}) as {
    researched?: unknown;
    force?: unknown;
    mining_productivity_bonus?: unknown;
    recipe_productivity_bonuses?: unknown;
  };
  const researched = Array.isArray(payload.researched)
    ? payload.researched.filter((t): t is string => typeof t === "string")
    : [];
  const hasMiningBonus = Object.prototype.hasOwnProperty.call(payload, "mining_productivity_bonus");
  const miningBonus =
    typeof payload.mining_productivity_bonus === "number" &&
    Number.isFinite(payload.mining_productivity_bonus)
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

  const changed = q.setResearchHorizon(
    hasMiningBonus || hasRecipeBonuses
      ? {
          researched,
          ...(hasMiningBonus ? { miningProductivityBonus: miningBonus } : {}),
          ...(hasRecipeBonuses ? { recipeProductivityBonuses: recipeBonuses } : {}),
        }
      : { researched },
  );
  q.metaSet("research_synced_at", new Date().toISOString());
  q.metaSet("research_synced_count", String(researched.length));
  if (changed) await resolveAllBlocks();
  return null;
}
