import { expect, test } from "vite-plus/test";
import { migrateToLpInput } from "./migrate.ts";
import { solveBlockLp, type RecipeDef } from "./lp.ts";
import { solveBlock } from "./block.ts";

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

test("v1 and v2 agree on a plain chain (parity of the happy path)", async () => {
  const v1input = { targets: [{ name: "gear", rate: 1 }], recipes: [gear, plate] };
  const v1 = solveBlock(v1input);
  const v2 = await solveBlockLp(migrateToLpInput(v1input));
  expect(v1.status).toBe("solved");
  expect(v2.status).toBe("solved");
  const r1 = Object.fromEntries(v1.recipes.map((x) => [x.recipe, x.rate]));
  const r2 = Object.fromEntries(v2.recipes.map((x) => [x.recipe, x.rate]));
  expect(r2.plate).toBeCloseTo(r1.plate, 9);
  expect(r2.gear).toBeCloseTo(r1.gear, 9);
  expect(v2.imports.find((f) => f.name === "ore")?.rate).toBeCloseTo(
    v1.imports.find((f) => f.name === "ore")!.rate,
    9,
  );
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
