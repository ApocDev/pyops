import { expect, test } from "vite-plus/test";
import { expandTemps, type TempRecipeDef } from "./temps.ts";
import { solveBlockLp } from "./lp.ts";

/** Py's real fusion/MHD shape (#110): dt-he3 makes neutron @3000°, b-h @4000°,
 * the MHD generator accepts exactly 4000°. Plus the heavy-water loop's water
 * 125° → ≤101° mismatch. Values from py.db. */
const dtHe3: TempRecipeDef = {
  name: "dt-he3",
  energyRequired: 40,
  ingredients: [{ kind: "fluid", name: "deuterium", amount: 50 }],
  products: [{ kind: "fluid", name: "neutron", amount: 7500, temperature: 3000 }],
};
const bH: TempRecipeDef = {
  name: "b-h",
  energyRequired: 40,
  ingredients: [{ kind: "item", name: "boron", amount: 20 }],
  products: [{ kind: "fluid", name: "neutron", amount: 10000, temperature: 4000 }],
};
const mdh4000: TempRecipeDef = {
  name: "generate-mdh-4000",
  energyRequired: 1,
  ingredients: [{ kind: "fluid", name: "neutron", amount: 24000, minTemp: 4000, maxTemp: 4000 }],
  products: [{ kind: "fluid", name: "pyops-electricity", amount: 9600000 }],
};

const noDefault = () => null;

const solve = (defs: TempRecipeDef[], goals: { name: string; rate: number }[], made: string[]) => {
  const { input, fold } = expandTemps({ goals, recipes: defs, made, pins: [] }, noDefault);
  return { fold, res: solveBlockLp(input) };
};

test("fluids without ranged consumers pass through untouched", () => {
  const { input, fold } = expandTemps(
    { goals: [{ name: "neutron", rate: 1 }], recipes: [dtHe3], made: [], pins: [] },
    noDefault,
  );
  expect(input.recipes).toHaveLength(1);
  expect(input.recipes[0].products[0].name).toBe("neutron");
  expect(fold.isSynthetic("anything")).toBe(false);
});

test("an out-of-range producer cannot feed a ranged consumer — the pool reads unmade", async () => {
  // only dt-he3 (3000°) present, generator needs 4000°: with neutron made, the
  // 4000° pool has no producer → reported unmade; the block imports the pool
  // (temperature is then the player's problem, stated honestly)
  const { res, fold } = solve(
    [dtHe3, mdh4000],
    [{ name: "pyops-electricity", rate: 9600000 }],
    ["neutron"],
  );
  const r = await res;
  expect(r.status).toBe("solved");
  const unmade = (r.unmade ?? []).map((u) => `${fold.bare(u)} ${fold.tempOf(u) ?? ""}`.trim());
  expect(unmade).toContain("neutron 4000°");
  // nothing pulls dt-he3 (its 3000° output can't feed the generator): it
  // honestly idles instead of running for an exportable byproduct
  const rates = Object.fromEntries(r.recipes.map((x) => [x.recipe, x.rate]));
  expect(rates["dt-he3"]).toBeCloseTo(0);
});

test("range pooling: the in-range producer feeds the consumer; the other exports", async () => {
  const { res, fold } = solve(
    [dtHe3, bH, mdh4000],
    [{ name: "pyops-electricity", rate: 9600000 }],
    ["neutron"],
  );
  const r = await res;
  expect(r.status).toBe("solved");
  const rates = Object.fromEntries(r.recipes.map((x) => [x.recipe, x.rate]));
  // generator needs 24000/s neutron@4000 → b-h at 2.4 exec/s; dt-he3 idles
  expect(rates["b-h"]).toBeCloseTo(2.4);
  expect(rates["generate-mdh-4000"]).toBeCloseTo(1);
  expect(rates["dt-he3"]).toBeCloseTo(0);
  expect(r.unmade ?? []).toEqual([]);
  // selector rows exist but are synthetic — callers fold them out
  const synthetic = r.recipes.filter((x) => fold.isSynthetic(x.recipe));
  expect(synthetic.length).toBeGreaterThan(0);
});

test("a wide range pools several variants (both producers can contribute)", async () => {
  const wide: TempRecipeDef = {
    ...mdh4000,
    name: "generate-wide",
    ingredients: [{ kind: "fluid", name: "neutron", amount: 24000, minTemp: 2000, maxTemp: 5000 }],
  };
  const { res } = solve(
    [dtHe3, bH, wide],
    [{ name: "pyops-electricity", rate: 9600000 }],
    ["neutron"],
  );
  const r = await res;
  expect(r.status).toBe("solved");
  const rates = Object.fromEntries(r.recipes.map((x) => [x.recipe, x.rate]));
  // cheapest mix: both are 40s recipes but dt-he3 yields 7500 vs b-h 10000 per
  // exec — the LP picks b-h (fewer machine-seconds per neutron)
  expect(rates["b-h"]).toBeCloseTo(2.4);
  expect(rates["dt-he3"]).toBeCloseTo(0);
});

test("a goal on an expanded fluid is satisfied by any temperature, variants stay made", async () => {
  // water producer @125°, a ≤101° consumer elsewhere in the block forces
  // expansion; the goal on water itself accepts any temperature
  const boil: TempRecipeDef = {
    name: "boil",
    energyRequired: 1,
    ingredients: [{ kind: "item", name: "coal", amount: 1 }],
    products: [{ kind: "fluid", name: "water", amount: 175, temperature: 125 }],
  };
  const cold: TempRecipeDef = {
    name: "cold-process",
    energyRequired: 1,
    ingredients: [{ kind: "fluid", name: "water", amount: 10, maxTemp: 101 }],
    products: [{ kind: "item", name: "gel", amount: 1 }],
  };
  const { res, fold } = solve([boil, cold], [{ name: "water", rate: 175 }], ["water"]);
  const r = await res;
  expect(r.status).toBe("solved");
  const rates = Object.fromEntries(r.recipes.map((x) => [x.recipe, x.rate]));
  expect(rates["boil"]).toBeCloseTo(1); // goal met by the 125° variant
  // the ≤101° pool has no in-range producer → unmade, its consumer imports
  const unmade = (r.unmade ?? []).map((u) => `${fold.bare(u)} ${fold.tempOf(u) ?? ""}`.trim());
  expect(unmade).toContain("water ≤101°");
});

test("share pins follow the consumer onto its pool", async () => {
  const src: TempRecipeDef = {
    name: "src",
    energyRequired: 1,
    ingredients: [],
    products: [{ kind: "fluid", name: "steam", amount: 100, temperature: 500 }],
  };
  const turbineA: TempRecipeDef = {
    name: "turbine-a",
    energyRequired: 1,
    ingredients: [{ kind: "fluid", name: "steam", amount: 1, minTemp: 100 }],
    products: [],
  };
  const turbineB: TempRecipeDef = {
    name: "turbine-b",
    energyRequired: 1,
    ingredients: [{ kind: "fluid", name: "steam", amount: 1, minTemp: 100 }],
    products: [],
  };
  const { input } = expandTemps(
    {
      goals: [],
      recipes: [src, turbineA, turbineB],
      made: ["steam"],
      pins: [
        { kind: "rate", recipe: "src", rate: 1 },
        { kind: "share", item: "steam", recipe: "turbine-a", share: 0.5, base: "total" },
      ],
    },
    noDefault,
  );
  const share = input.pins!.find((p) => p.kind === "share")!;
  expect(share.kind === "share" && share.item.includes("pool")).toBe(true);
  const r = await solveBlockLp(input);
  expect(r.status).toBe("solved");
  const rates = Object.fromEntries(r.recipes.map((x) => [x.recipe, x.rate]));
  // NOTE: the share applies to the POOL's production (what selectors route),
  // which the two turbines' demand drives — with only pins driving, both idle
  // except the routed share. turbine-a takes 50% of pooled production.
  expect(rates["turbine-a"]).toBeCloseTo(50);
});

test("products without explicit temperature use the fluid default", async () => {
  const pump: TempRecipeDef = {
    name: "pump",
    energyRequired: 1,
    ingredients: [],
    products: [{ kind: "fluid", name: "water", amount: 100 }], // no temp → default 15°
  };
  const cold: TempRecipeDef = {
    name: "cold-process",
    energyRequired: 1,
    ingredients: [{ kind: "fluid", name: "water", amount: 10, maxTemp: 101 }],
    products: [{ kind: "item", name: "gel", amount: 1 }],
  };
  const { input } = expandTemps(
    {
      goals: [{ name: "gel", rate: 1 }],
      recipes: [pump, cold],
      made: ["water"],
      pins: [],
    },
    (f) => (f === "water" ? 15 : null),
  );
  const r = await solveBlockLp(input);
  expect(r.status).toBe("solved");
  const rates = Object.fromEntries(r.recipes.map((x) => [x.recipe, x.rate]));
  expect(rates["pump"]).toBeCloseTo(0.1); // 15° is within ≤101° — pooled fine
  expect(r.unmade ?? []).toEqual([]);
});
