import { expect, test } from "vite-plus/test";
import { migrateToLpInput } from "./migrate.ts";
import { solveBlockLp, type RecipeDef } from "./lp.ts";

const plate: RecipeDef = {
  name: "plate",
  energyRequired: 10,
  ingredients: [{ kind: "item", name: "ore", amount: 8 }],
  products: [{ kind: "item", name: "plate", amount: 1 }],
};
const gear: RecipeDef = {
  name: "gear",
  energyRequired: 0.5,
  ingredients: [{ kind: "item", name: "plate", amount: 2 }],
  products: [{ kind: "item", name: "gear", amount: 1 }],
};

test("auto-balanced intermediates become made; goal items don't need the mark", () => {
  const out = migrateToLpInput({
    targets: [{ name: "gear", rate: 1 }],
    recipes: [gear, plate],
  });
  expect(out.made).toEqual(["plate"]);
  expect(out.goals).toEqual([{ name: "gear", rate: 1 }]);
});

test("import/export overrides unlink; balance overrides mark made", () => {
  const out = migrateToLpInput({
    targets: [{ name: "gear", rate: 1 }],
    recipes: [gear, plate],
    dispositions: { plate: "import" },
  });
  expect(out.made).toBeUndefined();

  const out2 = migrateToLpInput({
    targets: [{ name: "gear", rate: 1 }],
    recipes: [gear],
    dispositions: { plate: "balance" }, // consumed-only, protected by balance
  });
  expect(out2.made).toEqual(["plate"]);
});

test("v2 solves what v1 could only relax: forced byproduct surplus", async () => {
  // A+2B recipe with goals on both — v1's exact balance can't hold; v2 exports
  // the B surplus and calls it solved (the intentional-improvement class of diff)
  const ab: RecipeDef = {
    name: "ab",
    energyRequired: 1,
    ingredients: [{ kind: "item", name: "x", amount: 1 }],
    products: [
      { kind: "item", name: "a", amount: 1 },
      { kind: "item", name: "b", amount: 2 },
    ],
  };
  const input = {
    targets: [
      { name: "a", rate: 1 },
      { name: "b", rate: 1 },
    ],
    recipes: [ab],
  };
  const v2 = await solveBlockLp(migrateToLpInput(input));
  expect(v2.status).toBe("solved");
  expect(v2.exports.find((f) => f.name === "b")?.rate).toBeCloseTo(1);
});
