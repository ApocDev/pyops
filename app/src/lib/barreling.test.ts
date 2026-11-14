import { describe, expect, it } from "vite-plus/test";
import { isBarrelingRecipe } from "./barreling.ts";

describe("isBarrelingRecipe", () => {
  it("matches Pyanodons' barrel categories", () => {
    expect(isBarrelingRecipe({ category: "py-barreling", subgroup: "empty-barrel" })).toBe(true);
    expect(isBarrelingRecipe({ category: "py-unbarreling", subgroup: null })).toBe(true);
  });

  it("matches vanilla barrel recipes, which import as plain crafting", () => {
    expect(isBarrelingRecipe({ category: "crafting", subgroup: "fill-barrel" })).toBe(true);
    expect(isBarrelingRecipe({ category: "crafting", subgroup: "empty-barrel" })).toBe(true);
  });

  it("leaves recipes that make or use barrels as products alone", () => {
    // vanilla's empty-barrel recipe, and Py's steel-from-barrels
    expect(isBarrelingRecipe({ category: "crafting", subgroup: "intermediate-product" })).toBe(
      false,
    );
    expect(isBarrelingRecipe({ category: "advanced-crafting", subgroup: null })).toBe(false);
  });
});
