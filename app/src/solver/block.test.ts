import { expect, test } from "vite-plus/test";
import { solveBlock, type RecipeDef } from "./block.ts";

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
const rate = (r: ReturnType<typeof solveBlock>) =>
  Object.fromEntries(r.recipes.map((x) => [x.recipe, x.rate]));
/** flows with rates rounded to kill floating-point accumulation noise */
const flows = (fs: { name: string; kind: string; rate: number }[]) =>
  fs.map((f) => ({ name: f.name, kind: f.kind, rate: Math.round(f.rate * 1e6) / 1e6 }));

test("single recipe imports its raw input", () => {
  const r = solveBlock({ targets: [{ name: "plate", rate: 1 }], recipes: [plate] });
  expect(r.status).toBe("solved");
  expect(r.recipes[0].rate).toBeCloseTo(1);
  expect(r.recipes[0].machines1x).toBeCloseTo(10);
  expect(flows(r.imports)).toEqual([{ name: "ore", kind: "item", rate: 8 }]);
  expect(r.exports).toEqual([]);
});

test("a chain balances its intermediate", () => {
  const r = solveBlock({ targets: [{ name: "gear", rate: 1 }], recipes: [gear, plate] });
  expect(r.status).toBe("solved");
  expect(rate(r).plate).toBeCloseTo(2);
  expect(rate(r).gear).toBeCloseTo(1);
  expect(flows(r.imports)).toEqual([{ name: "ore", kind: "item", rate: 16 }]);
});

test("byproducts export; raw inputs import", () => {
  const r = solveBlock({
    targets: [{ name: "a", rate: 1 }],
    recipes: [
      {
        name: "ab",
        energyRequired: 1,
        ingredients: [{ kind: "item", name: "x", amount: 1 }],
        products: [
          { kind: "item", name: "a", amount: 1 },
          { kind: "item", name: "b", amount: 1 },
        ],
      },
    ],
  });
  expect(r.status).toBe("solved");
  expect(flows(r.exports)).toEqual([{ name: "b", kind: "item", rate: 1 }]);
  expect(flows(r.imports)).toEqual([{ name: "x", kind: "item", rate: 1 }]);
});

test("cyclic chain solves (redundant balance equations, m > n)", () => {
  // r1: a + x → b ; r2: b → a + c. a/b cycle; x imported; c is the goal.
  const r = solveBlock({
    targets: [{ name: "c", rate: 1 }],
    recipes: [
      {
        name: "r1",
        energyRequired: 1,
        ingredients: [
          { kind: "item", name: "a", amount: 1 },
          { kind: "item", name: "x", amount: 1 },
        ],
        products: [{ kind: "item", name: "b", amount: 1 }],
      },
      {
        name: "r2",
        energyRequired: 1,
        ingredients: [{ kind: "item", name: "b", amount: 1 }],
        products: [
          { kind: "item", name: "a", amount: 1 },
          { kind: "item", name: "c", amount: 1 },
        ],
      },
    ],
  });
  expect(r.status).toBe("solved");
  expect(rate(r).r1).toBeCloseTo(1);
  expect(rate(r).r2).toBeCloseTo(1);
  expect(flows(r.imports)).toEqual([{ name: "x", kind: "item", rate: 1 }]);
});

test("probabilistic byproduct uses expected amount", () => {
  const r = solveBlock({
    targets: [{ name: "a", rate: 1 }],
    recipes: [
      {
        name: "ab",
        energyRequired: 1,
        ingredients: [{ kind: "item", name: "x", amount: 1 }],
        products: [
          { kind: "item", name: "a", amount: 1 },
          { kind: "item", name: "b", amount: 1, probability: 0.5 },
        ],
      },
    ],
  });
  expect(r.status).toBe("solved");
  expect(flows(r.exports)).toEqual([{ name: "b", kind: "item", rate: 0.5 }]);
});

test("a target with no producing recipe is not solved", () => {
  const r = solveBlock({ targets: [{ name: "gear", rate: 1 }], recipes: [plate] });
  expect(r.status).not.toBe("solved");
});

// Real Py Hard Mode iron-plate chain (from molten iron, via the cyclic ore-pulp
// refinement). The flotation step (iron-pulp-06) emits iron-pulp-02 as a byproduct,
// but the leaching step (iron-pulp-03) consumes more than that — so the pulp loop
// can't self-close. Default dispositions force iron-pulp-02 to balance=0 → conflict.
// Freeing iron-pulp-02 as an import (it's the raw slurry feed, only partially
// recycled in-block) makes the block solvable. Exact defs dumped from the DB.
const F = (name: string, amount: number) => ({ kind: "fluid", name, amount });
const I = (name: string, amount: number) => ({ kind: "item", name, amount });
const ironChain: RecipeDef[] = [
  {
    name: "hotair-iron-plate-1",
    energyRequired: 4,
    ingredients: [F("molten-iron", 100), I("borax", 3), I("sand-casting", 1), F("hot-air", 50)],
    products: [I("iron-plate", 75)],
  },
  {
    name: "molten-iron-01",
    energyRequired: 4,
    ingredients: [I("sintered-iron", 1), I("borax", 3), F("oxygen", 60)],
    products: [F("molten-iron", 150)],
  },
  {
    name: "sinter-iron-2",
    energyRequired: 4,
    ingredients: [I("reduced-iron", 1), I("lime", 3), F("syngas", 100), F("pressured-air", 100)],
    products: [I("sintered-iron", 2)],
  },
  {
    name: "reduction-iron",
    energyRequired: 5,
    ingredients: [
      I("high-grade-iron", 1),
      I("sodium-sulfate", 2),
      F("diesel", 50),
      F("pressured-air", 100),
    ],
    products: [I("reduced-iron", 1)],
  },
  {
    name: "high-grade-iron",
    energyRequired: 10,
    ingredients: [F("iron-pulp-07", 450), I("filtration-media", 1)],
    products: [I("high-grade-iron", 7)],
  },
  {
    name: "iron-pulp-06-thickener",
    energyRequired: 3,
    ingredients: [F("iron-pulp-06", 100)],
    products: [F("tailings", 50), F("iron-pulp-07", 50)],
  },
  {
    name: "iron-pulp-06",
    energyRequired: 3,
    ingredients: [F("iron-pulp-05", 100), F("sulfuric-acid", 50), F("pressured-air", 150)],
    products: [F("iron-pulp-06", 100), F("tailings", 100), F("iron-pulp-02", 50)],
  },
  {
    name: "iron-pulp-05",
    energyRequired: 3,
    ingredients: [F("iron-pulp-04", 100), F("water", 300), F("pressured-air", 150)],
    products: [F("iron-pulp-05", 100)],
  },
  {
    name: "iron-pulp-04",
    energyRequired: 3,
    ingredients: [F("iron-pulp-03", 500), F("organic-solvent", 50), F("pressured-air", 150)],
    products: [F("iron-pulp-04", 500)],
  },
  {
    name: "iron-pulp-03",
    energyRequired: 3,
    ingredients: [F("iron-pulp-02", 100), F("xylenol", 50)],
    products: [F("iron-pulp-03", 50)],
  },
];

test("Py iron chain: unclosed recycle loop auto-frees the loop feed, stays solvable", () => {
  // No dispositions: the solver detects the iron-pulp recycle loop can't self-close
  // and auto-frees the lowest-tier loop item (iron-pulp-02) to the boundary rather
  // than failing — so the panel still shows every requirement.
  const r = solveBlock({ targets: [{ name: "iron-plate", rate: 1 }], recipes: ironChain });
  expect(r.status).toBe("relaxed");
  expect(r.autoFreed).toEqual(["iron-pulp-02"]);
  const imp = Object.fromEntries(r.imports.map((f) => [f.name, f.rate]));
  const exp = Object.fromEntries(r.exports.map((f) => [f.name, f.rate]));
  expect(imp["iron-pulp-02"]).toBeCloseTo(0.857, 2); // 150/175
  expect(exp["tailings"]).toBeCloseTo(0.857, 2);
  // the whole chain stays engaged, not trivialised: the deep pulp feed runs
  expect(imp["water"]).toBeCloseTo(1.714, 2);
  expect(imp["xylenol"]).toBeCloseTo(0.571, 2);
});

test("Py iron chain: an explicit import disposition matches the auto-relaxed result", () => {
  const r = solveBlock({
    targets: [{ name: "iron-plate", rate: 1 }],
    recipes: ironChain,
    dispositions: { "iron-pulp-02": "import" },
  });
  expect(r.status).toBe("solved"); // explicit → no auto-relax needed
  const imp = Object.fromEntries(r.imports.map((f) => [f.name, f.rate]));
  expect(imp["iron-pulp-02"]).toBeCloseTo(0.857, 2);
});
