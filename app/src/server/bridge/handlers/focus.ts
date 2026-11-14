/**
 * `block.focus` — the in-game focus hotkey sent the hovered machine's recipe.
 * Blocks are plans, not places, so the match is by recipe alone, never by
 * distance:
 *
 * - one enabled block runs the recipe → open it;
 * - several → the factory resource view for the recipe's good, listing them;
 * - none → a "no block plans this yet" nudge in the web UI.
 *
 * The reply (`block.focused`) tells the mod which case happened, so the player
 * gets feedback in-game too.
 */
import { blocksUsingRecipe, recipeFocusInfo } from "../../../db/recipe-blocks.server.ts";
import { setOpenRequest } from "../open-request.ts";
import type { BridgeRequest, BridgeResponse } from "../protocol.ts";

type BlockFocusedPayload = {
  result: "block" | "several" | "none";
  /** Blocks running the recipe. */
  count: number;
  /** The opened block's name (result "block" only). */
  block?: string;
};

export function handleBlockFocus(req: BridgeRequest): BridgeResponse | null {
  const recipe = (req.payload as { recipe?: unknown } | undefined)?.recipe;
  if (typeof recipe !== "string" || recipe === "") return null;

  const users = blocksUsingRecipe(recipe);
  const info = recipeFocusInfo(recipe);
  const reply = (payload: Omit<BlockFocusedPayload, "count">): BridgeResponse => ({
    type: "block.focused",
    request_id: req.request_id,
    payload: { count: users.length, ...payload } satisfies BlockFocusedPayload,
  });

  if (users.length === 1) {
    setOpenRequest({ to: "block", id: users[0].id });
    return reply({ result: "block", block: users[0].name });
  }
  if (users.length > 1) {
    // a recipe with no goods at all has no resource view to open; the mod's
    // reply still says how many blocks run it
    if (info?.good) setOpenRequest({ to: "good", recipe, good: info.good });
    return reply({ result: "several" });
  }
  setOpenRequest({ to: "none", label: info?.display ?? recipe, good: info?.good ?? null });
  return reply({ result: "none" });
}
