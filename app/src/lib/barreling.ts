// Pyanodons and older barrel mods give barrel recipes their own crafting category.
const BARRELING_CATEGORIES = new Set(["py-barreling", "py-unbarreling", "barreling", "barrelling"]);
// Vanilla generates barrel recipes in base/data-updates.lua with no category (so
// they import as `crafting`) and these subgroups.
const BARRELING_SUBGROUPS = new Set(["fill-barrel", "empty-barrel"]);

/** Barrel fill/empty recipes: plumbing that moves a fluid into and out of an item
 * container, not a production choice. Cost analysis penalizes them, the
 * dependency graph leaves them out, and the goal shortcut skips them. */
export function isBarrelingRecipe(recipe: {
  category?: string | null;
  subgroup?: string | null;
}): boolean {
  return (
    BARRELING_CATEGORIES.has(recipe.category ?? "") ||
    BARRELING_SUBGROUPS.has(recipe.subgroup ?? "")
  );
}
