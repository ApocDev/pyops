import { isBarrelingRecipe } from "./barreling";

export type RankedRecipeCandidate = {
  name: string;
  category?: string | null;
  subgroup?: string | null;
  unlockedNow: boolean;
  superseded?: unknown;
};

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
