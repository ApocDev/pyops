/**
 * The game's latest "show this in PyOps" request. Bridge handlers record it;
 * the bridge status poll carries it to the browser, where `GameOpenBlock`
 * follows it. Module state: it lives for this app session only.
 */

export type FocusGood = { name: string; kind: "item" | "fluid" };

/** Where the web UI should go.
 * - `block`: open that block (`block.open`, or `block.focus` with one match).
 * - `good`: several blocks use `recipe`; open the factory resource view for
 *   its good, with those blocks listed.
 * - `none`: no block uses the recipe (`label`); nudge the player to create one. */
export type GameOpenTarget =
  | { to: "block"; id: number }
  | { to: "good"; recipe: string; good: FocusGood }
  | { to: "none"; label: string; good: FocusGood | null };

export type GameOpenRequest = GameOpenTarget & { at: number };

let last: GameOpenRequest | null = null;

/** Record a request, stamped now so the web UI opens it once. */
export function setOpenRequest(target: GameOpenTarget): void {
  last = { ...target, at: Date.now() };
}

/** The latest request from the game, if any this app session. */
export function lastOpenRequest(): GameOpenRequest | null {
  return last;
}
