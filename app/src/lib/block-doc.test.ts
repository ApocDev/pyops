/**
 * withRecipeSet (#12): swapping a block's recipe list keeps everything else and
 * prunes per-recipe config for recipes that leave — no orphaned machine picks,
 * module loadouts, pins, fuel choices, or sub-block memberships.
 */
import { describe, expect, it } from "vite-plus/test";
import type { BlockData } from "../db/schema.ts";
import { extractRecipeToBlockDocs, withRecipeSet } from "./block-doc.ts";

const doc = (): BlockData => ({
  goals: [{ name: "iron-plate", rate: 2 }],
  recipes: ["iron-plate", "molten-iron", "helper"],
  made: ["iron-plate", "molten-iron"],
  machines: { "iron-plate": "furnace", "molten-iron": "foundry" },
  fuels: { "iron-plate": "coal" },
  modules: { "molten-iron": ["prod-1", "prod-1"] },
  beacons: { helper: [{ beacon: "beacon", count: 1, modules: ["speed-1"] }] },
  reactorLayouts: { helper: { x: 2, y: 2 } },
  disabledRecipes: ["helper"],
  pins: [
    { kind: "count", recipe: "molten-iron", count: 3 },
    { kind: "share", recipe: "helper", item: "iron-plate", share: 0.5 },
  ],
  rowGroups: [
    { id: 1, name: "smelt" },
    { id: 2, name: "aux" },
  ],
  recipeGroups: { "iron-plate": 1, "molten-iron": 1, helper: 2 },
});

describe("withRecipeSet (#12)", () => {
  it("keeps config for surviving recipes and prunes the removed recipe's config", () => {
    const next = withRecipeSet(doc(), ["iron-plate", "molten-iron", "iron-plate-adv"]);
    expect(next.recipes).toEqual(["iron-plate", "molten-iron", "iron-plate-adv"]);
    // surviving picks stay
    expect(next.machines).toEqual({ "iron-plate": "furnace", "molten-iron": "foundry" });
    expect(next.fuels).toEqual({ "iron-plate": "coal" });
    expect(next.modules).toEqual({ "molten-iron": ["prod-1", "prod-1"] });
    expect(next.pins).toEqual([{ kind: "count", recipe: "molten-iron", count: 3 }]);
    // the removed helper's config is gone entirely (empty maps dropped, not {})
    expect(next.beacons).toBeUndefined();
    expect(next.reactorLayouts).toBeUndefined();
    expect(next.disabledRecipes).toBeUndefined();
    // its emptied sub-block group is dropped; the surviving group stays
    expect(next.rowGroups).toEqual([{ id: 1, name: "smelt" }]);
    expect(next.recipeGroups).toEqual({ "iron-plate": 1, "molten-iron": 1 });
    // goals and made marks are user gestures — untouched
    expect(next.goals).toEqual([{ name: "iron-plate", rate: 2 }]);
    expect(next.made).toEqual(["iron-plate", "molten-iron"]);
  });

  it("does not mutate the input doc", () => {
    const original = doc();
    const before = JSON.parse(JSON.stringify(original)) as BlockData;
    withRecipeSet(original, ["iron-plate"]);
    expect(original).toEqual(before);
  });

  it("an identical recipe list is a no-op for the per-recipe config", () => {
    const original = doc();
    const next = withRecipeSet(original, original.recipes);
    expect(next.machines).toEqual(original.machines);
    expect(next.pins).toEqual(original.pins);
    expect(next.rowGroups).toEqual(original.rowGroups);
  });
});

describe("extractRecipeToBlockDocs", () => {
  it("moves one recipe's row config into a new block and prunes the source", () => {
    const next = extractRecipeToBlockDocs(doc(), "molten-iron", [{ name: "molten-iron", rate: 4 }]);

    expect(next.source.recipes).toEqual(["iron-plate", "helper"]);
    expect(next.source.machines).toEqual({ "iron-plate": "furnace" });
    expect(next.source.modules).toBeUndefined();
    expect(next.source.pins).toEqual([
      { kind: "share", recipe: "helper", item: "iron-plate", share: 0.5 },
    ]);
    expect(next.source.made).toEqual(["iron-plate"]);

    expect(next.extracted).toEqual({
      goals: [{ name: "molten-iron", rate: 4 }],
      recipes: ["molten-iron"],
      machines: { "molten-iron": "foundry" },
      modules: { "molten-iron": ["prod-1", "prod-1"] },
      pins: [{ kind: "count", recipe: "molten-iron", count: 3 }],
    });
  });

  it("keeps made claims when another remaining recipe still produces the product", () => {
    const next = extractRecipeToBlockDocs(
      doc(),
      "molten-iron",
      [{ name: "molten-iron", rate: 4 }],
      ["molten-iron"],
    );

    expect(next.source.made).toEqual(["iron-plate", "molten-iron"]);
  });
});
