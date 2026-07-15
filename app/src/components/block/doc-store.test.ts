import { describe, expect, it } from "vite-plus/test";
import { createBlockDocStore, solveInputOf } from "./doc-store.ts";

const seeded = () => {
  const doc = createBlockDocStore();
  doc.hydrate(
    {
      goals: [
        { name: "iron-plate", rate: 2 },
        { name: "copper-plate", rate: 0.5 },
      ],
      recipes: ["iron-plate", "copper-plate", "coke"],
      machines: { "iron-plate": "stone-furnace" },
      fuels: { "iron-plate": "coal" },
      fluidTemperatures: { "iron-plate": { steam: 250 } },
      modules: { "iron-plate": ["speed-module"] },
      beacons: { "iron-plate": [{ beacon: "beacon", count: 2, modules: ["speed-module"] }] },
      disabledRecipes: ["coke"],
      rowGroups: [{ id: 1, name: "Smelting" }],
      recipeGroups: { "iron-plate": 1, "copper-plate": 1 },
    },
    "Iron",
  );
  return doc;
};

describe("dirty tracking", () => {
  it("hydrate loads clean; mutations mark dirty; markClean/markDirty round-trip", () => {
    const doc = seeded();
    expect(doc.store.state.hydrated).toBe(true);
    expect(doc.store.state.dirty).toBe(false);

    doc.setGoalRate("iron-plate", 3);
    expect(doc.store.state.dirty).toBe(true);

    doc.markClean(); // save started
    expect(doc.store.state.dirty).toBe(false);
    doc.markDirty(); // save failed — retry on next edit
    expect(doc.store.state.dirty).toBe(true);

    // re-hydration (undo / snapshot restore) resets clean, replacing the doc
    doc.hydrate({ goals: [{ name: "iron-plate", rate: 1 }], recipes: [] }, "Iron");
    expect(doc.store.state.dirty).toBe(false);
    expect(doc.store.state.recipes).toEqual([]);
  });
});

describe("goals", () => {
  it("addGoal pins 1/s and ignores duplicates", () => {
    const doc = seeded();
    doc.addGoal("coke");
    doc.addGoal("iron-plate"); // duplicate
    expect(doc.store.state.goals.map((g) => g.name)).toEqual([
      "iron-plate",
      "copper-plate",
      "coke",
    ]);
    expect(doc.store.state.goals[2]).toEqual({ name: "coke", rate: 1 });
  });

  it("stores an exact fluid goal temperature and clears it when the good changes", () => {
    const doc = seeded();
    doc.addGoal("steam", 250);
    expect(doc.store.state.goals.at(-1)).toEqual({ name: "steam", rate: 1, temperature: 250 });

    doc.setGoalTemperature("steam", 500);
    expect(doc.store.state.goals.at(-1)?.temperature).toBe(500);

    doc.changeGoalItem("steam", "water");
    expect(doc.store.state.goals.at(-1)).toEqual({ name: "water", rate: 1 });
  });

  it("makePrimary moves a goal to the front; changeGoalItem swaps in place and drops dupes", () => {
    const doc = seeded();
    doc.makePrimary("copper-plate");
    expect(doc.store.state.goals[0].name).toBe("copper-plate");

    doc.changeGoalItem("iron-plate", "steel-plate"); // swap keeps position + rate
    expect(doc.store.state.goals[1]).toMatchObject({ name: "steel-plate", rate: 2 });

    doc.changeGoalItem("steel-plate", "copper-plate"); // target already a goal → dropped
    expect(doc.store.state.goals.map((g) => g.name)).toEqual(["copper-plate"]);
  });

  it("reorderGoals preserves complete goal definitions and marks the document dirty", () => {
    const doc = seeded();
    const [iron, copper] = doc.store.state.goals;
    doc.reorderGoals([copper!, iron!]);

    expect(doc.store.state.goals).toEqual([copper, iron]);
    expect(doc.store.state.goals[0]).toMatchObject({ name: "copper-plate", rate: 0.5 });
    expect(doc.store.state.dirty).toBe(true);
  });

  it("appendGoals preserves destination order, skips duplicates, and drops derived factory rates", () => {
    const doc = seeded();
    const result = doc.appendGoals([
      { name: "iron-plate", rate: 99 },
      { name: "steel-plate", rate: 3, unit: "min", factoryRate: 4 },
      { name: "steel-plate", rate: 7 },
      { name: "stone-brick", rate: 20 / 3600, stock: 20, window: 3600 },
    ]);

    expect(result).toEqual({ added: 2, skipped: 2 });
    expect(doc.store.state.goals).toEqual([
      { name: "iron-plate", rate: 2 },
      { name: "copper-plate", rate: 0.5 },
      { name: "steel-plate", rate: 3, unit: "min" },
      { name: "stone-brick", rate: 20 / 3600, stock: 20, window: 3600 },
    ]);
    expect(doc.store.state.dirty).toBe(true);
  });

  it("appendGoals leaves the document clean when every copied goal already exists", () => {
    const doc = seeded();
    expect(doc.appendGoals([{ name: "iron-plate", rate: 99 }])).toEqual({
      added: 0,
      skipped: 1,
    });
    expect(doc.store.state.goals[0]).toEqual({ name: "iron-plate", rate: 2 });
    expect(doc.store.state.dirty).toBe(false);
  });

  it("stock goals derive rate = stock / window and convert back losslessly", () => {
    const doc = seeded();
    doc.makeStockGoal("iron-plate"); // rate 2/s × default window
    const g = doc.store.state.goals[0];
    expect(g.stock).toBeGreaterThan(0);
    expect(g.rate).toBeCloseTo(g.stock! / g.window!, 10);

    doc.setGoalWindow("iron-plate", 600);
    expect(doc.store.state.goals[0].rate).toBeCloseTo(doc.store.state.goals[0].stock! / 600, 10);

    doc.setGoalStock("iron-plate", 900);
    expect(doc.store.state.goals[0].rate).toBeCloseTo(900 / 600, 10);

    doc.makeRateGoal("iron-plate"); // keeps the derived rate, drops the intent
    expect(doc.store.state.goals[0].stock).toBeUndefined();
    expect(doc.store.state.goals[0].rate).toBeCloseTo(1.5, 10);
  });

  it("setPrimaryRate touches only goals[0]", () => {
    const doc = seeded();
    doc.setPrimaryRate(7);
    expect(doc.store.state.goals[0].rate).toBe(7);
    expect(doc.store.state.goals[1].rate).toBe(0.5);
  });
});

describe("recipes", () => {
  it("dropRecipe cascades: picks, modules, beacons, disabled, group membership + prune", () => {
    const doc = seeded();
    doc.dropRecipe("iron-plate");
    const s = doc.store.state;
    expect(s.recipes).toEqual(["copper-plate", "coke"]);
    expect(s.machines).toEqual({});
    expect(s.fuels).toEqual({});
    expect(s.fluidTemperatures).toEqual({});
    expect(s.modules).toEqual({});
    expect(s.beacons).toEqual({});
    expect(s.recipeGroups).toEqual({ "copper-plate": 1 });
    expect(s.rowGroups).toHaveLength(1); // copper-plate still holds the group open

    doc.dropRecipe("copper-plate");
    expect(doc.store.state.rowGroups).toEqual([]); // last member gone → group pruned
  });

  it("dropRecipe clears the disabled flag so re-adding starts enabled", () => {
    const doc = seeded();
    doc.dropRecipe("coke");
    expect([...doc.store.state.disabled]).toEqual([]);
  });

  it("applyRecipeDefaults never overwrites an existing pick", () => {
    const doc = seeded();
    doc.applyRecipeDefaults("iron-plate", {
      machine: "electric-furnace",
      fuel: "wood",
      fluidTemperatures: { steam: 2000 },
    });
    expect(doc.store.state.machines["iron-plate"]).toBe("stone-furnace"); // kept
    expect(doc.store.state.fluidTemperatures["iron-plate"]).toEqual({ steam: 250 }); // kept
    doc.applyRecipeDefaults("coke", {
      machine: "coke-oven",
      fluidTemperatures: { water: 15 },
    });
    expect(doc.store.state.machines.coke).toBe("coke-oven"); // new row → applied
    expect(doc.store.state.fluidTemperatures.coke).toEqual({ water: 15 });
  });

  it("stores an exact fluid ingredient temperature and clears back to Auto", () => {
    const doc = seeded();
    doc.pickFluidTemperature("copper-plate", "steam", 250);
    expect(solveInputOf(doc.store.state).fluidTemperatures).toEqual({
      "iron-plate": { steam: 250 },
      "copper-plate": { steam: 250 },
    });
    doc.pickFluidTemperature("copper-plate", "steam", null);
    expect(doc.store.state.fluidTemperatures).toEqual({ "iron-plate": { steam: 250 } });
  });

  it("applyRecipeDefaults bakes a default module template into a NEW row only (#99)", () => {
    const doc = seeded();
    const beacons = [{ beacon: "beacon-AM1-FM1", count: 1, modules: ["speed-module"] }];
    doc.applyRecipeDefaults("coke", { modules: ["productivity-module"], beacons });
    expect(doc.store.state.modules.coke).toEqual(["productivity-module"]);
    expect(doc.store.state.beacons.coke).toEqual(beacons);

    // an existing loadout — even an explicit "no modules" — is never overwritten
    doc.setModules("copper-plate", [], []);
    doc.applyRecipeDefaults("copper-plate", { modules: ["productivity-module"], beacons });
    expect(doc.store.state.modules["copper-plate"]).toEqual([]);
    expect(doc.store.state.beacons["copper-plate"]).toEqual([]);
    doc.applyRecipeDefaults("iron-plate", { modules: ["productivity-module"] });
    expect(doc.store.state.modules["iron-plate"]).toEqual(["speed-module"]);
  });

  it("setReactorLayout stores real farms; the 1×1 default (or null) clears (#94)", () => {
    const doc = seeded();
    doc.setReactorLayout("iron-plate", { x: 2, y: 4 });
    expect(doc.store.state.reactorLayouts["iron-plate"]).toEqual({ x: 2, y: 4 });
    expect(solveInputOf(doc.store.state).reactorLayouts).toEqual({
      "iron-plate": { x: 2, y: 4 },
    });
    doc.setReactorLayout("iron-plate", { x: 1, y: 1 }); // back to the default
    expect(doc.store.state.reactorLayouts).toEqual({});
    expect(solveInputOf(doc.store.state).reactorLayouts).toBeUndefined();
    doc.setReactorLayout("iron-plate", { x: 2, y: 2 });
    doc.setReactorLayout("iron-plate", null); // explicit clear
    expect(doc.store.state.reactorLayouts).toEqual({});
    // dropRecipe cascades the layout away too
    doc.setReactorLayout("coke", { x: 2, y: 2 });
    doc.dropRecipe("coke");
    expect(doc.store.state.reactorLayouts).toEqual({});
  });
});

describe("made marks, pins & spoil plans", () => {
  it("markMade/unmark edit the made set; adoptMade only fills a legacy null (clean)", () => {
    const doc = seeded();
    // seeded() hydrates a doc with no `made` → legacy (null) until adopted
    expect(doc.store.state.made).toBeNull();
    doc.adoptMade(["iron-plate", "coke"]);
    expect(doc.store.state.dirty).toBe(false); // adoption is not a user edit
    expect([...doc.store.state.made!].sort((a, b) => a.localeCompare(b))).toEqual([
      "coke",
      "iron-plate",
    ]);
    doc.adoptMade(["tar"]); // no-op — the doc already owns a made set
    expect(doc.store.state.made!.has("tar")).toBe(false);

    doc.markMade("tar");
    expect(doc.store.state.dirty).toBe(true);
    expect(doc.store.state.made!.has("tar")).toBe(true);
    doc.unmark("tar");
    expect(doc.store.state.made!.has("tar")).toBe(false);
  });

  it("pins: one count/cap per recipe, one share per edge; dropRecipe cascades", () => {
    const doc = seeded();
    doc.setPin({ kind: "count", recipe: "coke", count: 5 });
    doc.setPin({ kind: "cap", recipe: "coke", count: 8 }); // replaces the count pin
    expect(doc.store.state.pins).toEqual([{ kind: "cap", recipe: "coke", count: 8 }]);
    doc.setPin({ kind: "share", recipe: "coke", item: "tar", share: 0.5 });
    doc.setPin({ kind: "share", recipe: "coke", item: "tar", share: 0.25 }); // replaces
    expect(doc.store.state.pins).toHaveLength(2);
    doc.clearPin("coke", { item: "tar" });
    expect(doc.store.state.pins).toEqual([{ kind: "cap", recipe: "coke", count: 8 }]);
    doc.dropRecipe("coke");
    expect(doc.store.state.pins).toEqual([]);
  });

  it("setSpoilRate clears on null or non-positive rates", () => {
    const doc = seeded();
    doc.setSpoilRate("vrauk", 0.5);
    expect(doc.store.state.spoilRates.vrauk).toBe(0.5);
    doc.setSpoilRate("vrauk", 0);
    expect("vrauk" in doc.store.state.spoilRates).toBe(false);
    doc.setSpoilRate("vrauk", null);
    expect(doc.store.state.spoilRates).toEqual({});
  });
});

describe("sub-blocks", () => {
  it("createGroupFromRow allocates the next id; removeFromGroup prunes emptied groups", () => {
    const doc = seeded();
    const id = doc.createGroupFromRow("coke");
    expect(id).toBe(2);
    expect(doc.store.state.recipeGroups.coke).toBe(2);

    doc.removeFromGroup("coke");
    expect(doc.store.state.rowGroups.map((g) => g.id)).toEqual([1]); // group 2 pruned
  });

  it("ungroupRows dissolves the group but keeps the rows", () => {
    const doc = seeded();
    doc.ungroupRows(1);
    expect(doc.store.state.rowGroups).toEqual([]);
    expect(doc.store.state.recipeGroups).toEqual({});
    expect(doc.store.state.recipes).toHaveLength(3);
  });

  it("joinRecipeToGroup makes members contiguous", () => {
    const doc = seeded();
    doc.joinRecipeToGroup("coke", 1);
    expect(doc.store.state.recipeGroups.coke).toBe(1);
    // members of group 1 are contiguous in recipe order
    const members = doc.store.state.recipes.filter((r) => doc.store.state.recipeGroups[r] === 1);
    const first = doc.store.state.recipes.findIndex((r) => doc.store.state.recipeGroups[r] === 1);
    expect(doc.store.state.recipes.slice(first, first + members.length)).toEqual(members);
  });
});

describe("solveInputOf", () => {
  it("omits empty maps, sorts disabled recipes, and keeps explicit empty module lists", () => {
    const doc = createBlockDocStore();
    doc.hydrate({ goals: [{ name: "iron-plate", rate: 1 }], recipes: ["iron-plate"] }, "Iron");
    expect(solveInputOf(doc.store.state)).toEqual({
      goals: [{ name: "iron-plate", rate: 1 }],
      recipes: ["iron-plate"],
    });

    // explicit [] modules = "no modules" (suppresses auto-fill) — must persist
    doc.setModules("iron-plate", [], []);
    const si = solveInputOf(doc.store.state);
    expect(si.modules).toEqual({ "iron-plate": [] });
    expect(si.beacons).toBeUndefined(); // empty beacon list pruned

    const seededDoc = seeded();
    const full = solveInputOf(seededDoc.store.state);
    expect(full.disabledRecipes).toEqual(["coke"]);
    expect(full.rowGroups).toHaveLength(1);
  });

  it("round-trips through hydrate (save → load is lossless)", () => {
    const doc = seeded();
    doc.setSpoilRate("iron-plate", 0.25);
    doc.setCustomIcon({ kind: "fluid", name: "crude-oil" });
    const saved = solveInputOf(doc.store.state);

    const doc2 = createBlockDocStore();
    doc2.hydrate(saved, "Iron");
    expect(solveInputOf(doc2.store.state)).toEqual(saved);
  });
});
