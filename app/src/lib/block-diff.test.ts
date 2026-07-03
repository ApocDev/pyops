/**
 * Block-doc diff (#85): the pure snapshot-vs-current comparison the snapshot
 * drawer renders — goals, recipes, per-recipe picks, dispositions, spoil plans.
 */
import { describe, expect, it } from "vite-plus/test";

import type { BlockData } from "../db/schema.ts";
import { diffBlockDocs, diffRefNames } from "./block-diff";

const base = (over: Partial<BlockData> = {}): BlockData => ({
  goals: [{ name: "plate", rate: 1 }],
  recipes: ["smelt-plate"],
  ...over,
});

describe("diffBlockDocs", () => {
  it("reports identical docs as unchanged", () => {
    const d = diffBlockDocs(base(), base());
    expect(d.unchanged).toBe(true);
    expect(d.goals).toEqual({ added: [], removed: [], changed: [] });
    expect(d.recipes).toEqual({ added: [], removed: [], enabled: [], disabled: [] });
    expect(d.picks).toEqual([]);
  });

  it("goals: added, removed, and re-rated", () => {
    const from = base({
      goals: [
        { name: "plate", rate: 1 },
        { name: "gear", rate: 2 },
      ],
    });
    const to = base({
      goals: [
        { name: "plate", rate: 5 },
        { name: "pipe", rate: 1 },
      ],
    });
    const d = diffBlockDocs(from, to);
    expect(d.unchanged).toBe(false);
    expect(d.goals.added).toEqual([{ name: "pipe", rate: 1 }]);
    expect(d.goals.removed).toEqual([{ name: "gear", rate: 2 }]);
    expect(d.goals.changed).toEqual([
      { name: "plate", from: { name: "plate", rate: 1 }, to: { name: "plate", rate: 5 } },
    ]);
  });

  it("goals: a stock/window flip counts as a change even at the same rate", () => {
    const from = base({ goals: [{ name: "plate", rate: 1 }] });
    const to = base({ goals: [{ name: "plate", rate: 1, stock: 600, window: 600 }] });
    expect(diffBlockDocs(from, to).goals.changed).toHaveLength(1);
    // the display unit alone changing is also a (minor) change
    const unit = base({ goals: [{ name: "plate", rate: 1, unit: "min" }] });
    expect(diffBlockDocs(from, unit).goals.changed).toHaveLength(1);
  });

  it("recipes: added, removed, and enabled/disabled toggles", () => {
    const from = base({ recipes: ["a", "b", "c"], disabledRecipes: ["b"] });
    const to = base({ recipes: ["b", "c", "d"], disabledRecipes: ["c"] });
    const d = diffBlockDocs(from, to);
    expect(d.recipes.added).toEqual(["d"]);
    expect(d.recipes.removed).toEqual(["a"]);
    expect(d.recipes.enabled).toEqual(["b"]); // was off, now on
    expect(d.recipes.disabled).toEqual(["c"]); // was on, now off
  });

  it("picks: machine/fuel/modules/beacons changes on shared recipes only", () => {
    const from = base({
      recipes: ["a", "gone"],
      machines: { a: "furnace-1", gone: "x" },
      fuels: { a: "coal" },
      modules: { a: ["speed-1"] },
      beacons: { a: [{ beacon: "beacon", modules: ["speed-1"], count: 2 }] },
    });
    const to = base({
      recipes: ["a"],
      machines: { a: "furnace-2" },
      fuels: {},
      modules: { a: ["speed-1", "speed-1"] },
      beacons: { a: [{ beacon: "beacon", modules: ["speed-1"], count: 4 }] },
    });
    const d = diffBlockDocs(from, to);
    expect(d.picks).toHaveLength(1);
    const p = d.picks[0];
    expect(p.recipe).toBe("a");
    expect(p.machine).toEqual({ from: "furnace-1", to: "furnace-2" });
    expect(p.fuel).toEqual({ from: "coal", to: null });
    expect(p.modules).toEqual({ from: ["speed-1"], to: ["speed-1", "speed-1"] });
    expect(p.beacons?.from[0].count).toBe(2);
    expect(p.beacons?.to[0].count).toBe(4);
  });

  it("picks: reactor layout changes register, and equal layouts don't (#94)", () => {
    const from = base({ recipes: ["r"] }); // no layout = 1×1 default
    const to = base({ recipes: ["r"], reactorLayouts: { r: { x: 2, y: 2 } } });
    const d = diffBlockDocs(from, to);
    expect(d.picks[0]?.reactorLayout).toEqual({ from: null, to: { x: 2, y: 2 } });
    expect(d.unchanged).toBe(false);
    // identical layouts are not a change
    const same = base({ recipes: ["r"], reactorLayouts: { r: { x: 2, y: 4 } } });
    expect(diffBlockDocs(same, { ...same }).unchanged).toBe(true);
  });

  it("picks: distinguishes auto (no entry) from an explicit empty module list", () => {
    const from = base({ recipes: ["a"] }); // auto-fill
    const to = base({ recipes: ["a"], modules: { a: [] } }); // explicitly none
    const d = diffBlockDocs(from, to);
    expect(d.picks[0]?.modules).toEqual({ from: null, to: [] });
    // and identical explicit lists are NOT a change
    expect(
      diffBlockDocs(base({ recipes: ["a"], modules: { a: ["m"] } }), {
        ...base({ recipes: ["a"], modules: { a: ["m"] } }),
      }).unchanged,
    ).toBe(true);
  });

  it("dispositions and spoil plans", () => {
    const from = base({ dispositions: { ash: "export" }, spoilRates: { meat: 0.5 } });
    const to = base({ dispositions: { ash: "import", tar: "balance" }, spoilRates: {} });
    const d = diffBlockDocs(from, to);
    expect(d.dispositions).toEqual(
      expect.arrayContaining([
        { name: "ash", from: "export", to: "import" },
        { name: "tar", from: null, to: "balance" },
      ]),
    );
    expect(d.spoilRates).toEqual([{ name: "meat", from: 0.5, to: null }]);
  });

  it("sub-block grouping and row order are cosmetic — not a change", () => {
    const from = base({ recipes: ["a", "b"] });
    const to = base({
      recipes: ["b", "a"],
      rowGroups: [{ id: 1, name: "Sub" }],
      recipeGroups: { a: 1 },
    });
    expect(diffBlockDocs(from, to).unchanged).toBe(true);
  });
});

describe("diffRefNames", () => {
  it("collects every internal name the diff mentions, split by namespace (#113)", () => {
    const from = base({
      goals: [{ name: "plate", rate: 1 }],
      recipes: ["a", "old"],
      machines: { a: "furnace-1" },
    });
    const to = base({
      goals: [{ name: "gear", rate: 1 }],
      recipes: ["a", "new"],
      machines: { a: "furnace-2" },
      modules: { a: ["speed-1"] },
      spoilRates: { meat: 1 },
    });
    const names = diffRefNames(diffBlockDocs(from, to));
    // recipe rows + pick owners resolve against the recipe table…
    for (const n of ["old", "new", "a"]) expect(names.recipes).toContain(n);
    // …goals, machines, modules and spoil plans against items/fluids — a recipe
    // sharing a good's internal name must not pull the good's display (#113)
    for (const n of ["plate", "gear", "furnace-1", "furnace-2", "speed-1", "meat"])
      expect(names.goods).toContain(n);
    for (const n of ["plate", "gear", "meat"]) expect(names.recipes).not.toContain(n);
  });
});
