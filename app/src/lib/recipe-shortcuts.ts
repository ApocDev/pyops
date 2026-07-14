const BARREL_CATEGORIES = new Set(["py-barreling", "py-unbarreling", "barreling", "barrelling"]);

export type RankedRecipeCandidate = {
  name: string;
  category?: string | null;
  unlockedNow: boolean;
  superseded?: unknown;
};

/** Barrel fill/empty recipes are transport plumbing, not the production choice
 * a goal shortcut should make. Category is authoritative; the name fallback
 * covers modded variants that use a custom category. */
export function isBarrelingRecipe(recipe: Pick<RankedRecipeCandidate, "name" | "category">) {
  return (
    BARREL_CATEGORIES.has(recipe.category ?? "") || recipe.name.toLowerCase().includes("barrel")
  );
}

/** Candidates already carry the recipe picker's authoritative ordering:
 * currently unlocked recipe+machine first, then logistic cost and display name.
 * Select the first eligible entry rather than recreating that ranking here. */
export function bestUnlockedNonBarrelingRecipe<T extends RankedRecipeCandidate>(
  candidates: readonly T[],
): T | undefined {
  return candidates.find(
    (candidate) => candidate.unlockedNow && !candidate.superseded && !isBarrelingRecipe(candidate),
  );
}
