/**
 * Recipe → block lookups for the in-game "focus block" hotkey: which blocks
 * plan a recipe, and which good stands for it in the factory resource view.
 */
import { eq } from "drizzle-orm";

import { normalizeBlockData } from "../lib/goals.ts";
import type { FocusGood } from "../server/bridge/open-request.ts";
import { db } from "./index.server.ts";
import { getRecipe } from "./queries.server.ts";
import { blocks } from "./schema.ts";

/** Enabled blocks with `recipe` as an active row (rows toggled off don't
 * count), in sidebar order. */
export function blocksUsingRecipe(recipe: string): { id: number; name: string }[] {
  return db
    .select({ id: blocks.id, name: blocks.name, data: blocks.data })
    .from(blocks)
    .where(eq(blocks.enabled, true))
    .orderBy(blocks.sortOrder, blocks.name)
    .all()
    .filter((b) => {
      const data = normalizeBlockData(b.data);
      return data.recipes.includes(recipe) && !data.disabledRecipes?.includes(recipe);
    })
    .map(({ id, name }) => ({ id, name }));
}

/** The recipe's localized name and the good that stands for it: its main
 * product, else its first product, else (a void/sink recipe) its first
 * ingredient. `produced` says whether that good is a product, so callers only
 * offer "create a block producing it" when that would plan this recipe. Null
 * when the recipe isn't in the reference data. */
export function recipeFocusInfo(
  recipe: string,
): { display: string; good: FocusGood | null; produced: boolean } | null {
  const r = getRecipe(recipe);
  if (!r) return null;
  const product = r.products.find((p) => p.name === r.mainProduct) ?? r.products[0];
  const pick = product ?? r.ingredients[0];
  return {
    display: r.display ?? recipe,
    good: pick ? { name: pick.name, kind: pick.kind === "fluid" ? "fluid" : "item" } : null,
    produced: product != null,
  };
}
