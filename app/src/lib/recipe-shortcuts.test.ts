import { describe, expect, it } from "vite-plus/test";
import { bestUnlockedNonBarrelingRecipe, isBarrelingRecipe } from "./recipe-shortcuts.ts";

describe("best unlocked recipe shortcut", () => {
  it("takes the first unlocked non-barreling candidate from picker order", () => {
    const candidates = [
      { name: "fill-water-barrel", category: "py-barreling", unlockedNow: true },
      { name: "pump-water", category: "water", unlockedNow: true },
      { name: "distill-water", category: "chemistry", unlockedNow: true },
    ];

    expect(bestUnlockedNonBarrelingRecipe(candidates)?.name).toBe("pump-water");
  });

  it("does not fall through to horizon, locked, or superseded choices", () => {
    expect(
      bestUnlockedNonBarrelingRecipe([
        { name: "future", unlockedNow: false },
        { name: "old", unlockedNow: true, superseded: { by: "new" } },
      ]),
    ).toBeUndefined();
  });

  it("recognizes standard categories and custom-category barrel names", () => {
    expect(isBarrelingRecipe({ name: "fill-water", category: "barrelling" })).toBe(true);
    expect(isBarrelingRecipe({ name: "mod-fill-water-barrel", category: "chemistry" })).toBe(true);
    expect(isBarrelingRecipe({ name: "pump-water", category: "water" })).toBe(false);
  });
});
