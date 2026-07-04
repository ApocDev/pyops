import { expect, test } from "vite-plus/test";
import { solveBlockLp, type RecipeDef } from "./lp.ts";
import {
  composeSubBlocks,
  isSyntheticSubName,
  producedGoods,
  solveSubBlock,
  syntheticRecipeName,
  syntheticSubId,
} from "./subblock.ts";

const noTemp = () => null;

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
const rate = (r: Awaited<ReturnType<typeof solveBlockLp>>) =>
  Object.fromEntries(r.recipes.map((x) => [x.recipe, x.rate]));
const flow = (fs: { name: string; rate: number }[], name: string) =>
  fs.find((f) => f.name === name)?.rate;

test("synthetic recipe name round-trips to its group id", () => {
  expect(isSyntheticSubName(syntheticRecipeName(7))).toBe(true);
  expect(syntheticSubId(syntheticRecipeName(7))).toBe(7);
  expect(isSyntheticSubName("plate")).toBe(false);
  expect(syntheticSubId("plate")).toBeNull();
});

test("a sub-block's contract = net imports + net exports (goal output included)", async () => {
  const sub = await solveSubBlock(
    { id: 1, name: "Plates", members: ["plate"], goals: [{ name: "plate", rate: 1 }] },
    [plate],
    noTemp,
  );
  expect(sub.status).toBe("solved");
  // the goal output IS a product of the contract — what physically leaves the module
  expect(flow(sub.exports, "plate")).toBeCloseTo(1);
  expect(flow(sub.imports, "ore")).toBeCloseTo(8);
  expect(sub.machineSeconds).toBeCloseTo(10);
  // the synthetic recipe the parent consumes mirrors the contract
  expect(sub.synthetic.name).toBe(syntheticRecipeName(1));
  expect(sub.synthetic.energyRequired).toBeCloseTo(10);
  const amount = (cs: { name: string; amount: number }[], n: string) =>
    cs.find((c) => c.name === n)?.amount;
  expect(amount(sub.synthetic.products, "plate")).toBeCloseTo(1);
  expect(amount(sub.synthetic.ingredients, "ore")).toBeCloseTo(8);
});

test("2-level compose reproduces the flat block's boundary flows", async () => {
  // Flat: ore -> plate -> gear, goal gear = 1/s, plate linked (made).
  const flat = await solveBlockLp({
    goals: [{ name: "gear", rate: 1 }],
    recipes: [gear, plate],
    made: ["plate"],
  });
  expect(flat.status).toBe("solved");
  expect(rate(flat).plate).toBeCloseTo(2);
  expect(flow(flat.imports, "ore")).toBeCloseTo(16);
  expect(flat.exports).toEqual([]);

  // Composed: `plate` becomes a module (goal plate, reference rate 1/s); the
  // parent solves over gear + the synthetic module recipe.
  const sub = await solveSubBlock(
    { id: 1, name: "Plates", members: ["plate"], goals: [{ name: "plate", rate: 1 }] },
    [plate],
    noTemp,
  );
  const parent = await solveBlockLp({
    goals: [{ name: "gear", rate: 1 }],
    recipes: [gear, sub.synthetic],
    made: ["plate"],
  });
  expect(parent.status).toBe("solved");
  // same net boundary as the flat block — internals hidden, contract identical
  expect(flow(parent.imports, "ore")).toBeCloseTo(16);
  expect(parent.exports).toEqual([]);
  // the module is scaled to demand: 2 plates/s needed -> synthetic runs at 2 ->
  // its member `plate` runs at nestedRate(1) * synRate(2) = 2, matching flat.
  const synRate = rate(parent)[sub.synthetic.name];
  expect(synRate).toBeCloseTo(2);
  expect(rate(sub.result).plate * synRate).toBeCloseTo(2);
});

test("a module's forced co-product stays visible as an export", async () => {
  // one recipe makes plate + slag (2:1); a module goal on plate must expose the
  // slag surplus so the factory can route it (issue #76: surpluses stay visible).
  const smelt: RecipeDef = {
    name: "smelt",
    energyRequired: 4,
    ingredients: [{ kind: "item", name: "ore", amount: 10 }],
    products: [
      { kind: "item", name: "plate", amount: 2 },
      { kind: "item", name: "slag", amount: 1 },
    ],
  };
  const sub = await solveSubBlock(
    { id: 3, name: "Smelt", members: ["smelt"], goals: [{ name: "plate", rate: 2 }] },
    [smelt],
    noTemp,
  );
  expect(sub.status).toBe("solved");
  expect(flow(sub.exports, "plate")).toBeCloseTo(2);
  expect(flow(sub.exports, "slag")).toBeCloseTo(1); // the co-product is on the contract
  expect(flow(sub.imports, "ore")).toBeCloseTo(10);
});

test("auto-made covers a module's own intermediates (imports only raws)", async () => {
  // two-step module, no explicit made: producedGoods marks plate + gear, so the
  // internal plate is covered in-module and only ore is imported.
  expect(producedGoods([plate, gear]).sort()).toEqual(["gear", "plate"]);
  const sub = await solveSubBlock(
    { id: 4, name: "Gears", members: ["plate", "gear"], goals: [{ name: "gear", rate: 1 }] },
    [plate, gear],
    noTemp,
  );
  expect(sub.status).toBe("solved");
  expect(sub.imports.map((f) => f.name)).toEqual(["ore"]);
  expect(flow(sub.imports, "ore")).toBeCloseTo(16);
  expect(flow(sub.exports, "gear")).toBeCloseTo(1);
  expect(flow(sub.exports, "plate")).toBeUndefined(); // intermediate stays hidden
});

test("composeSubBlocks routes members + pins into the module, keeps parent recipes", async () => {
  const { parentDefs, parentPins, subs, memberGroupOf } = await composeSubBlocks({
    defs: [plate, gear],
    groups: [{ id: 1, name: "Plates", members: ["plate"], goals: [{ name: "plate", rate: 1 }] }],
    pins: [
      { kind: "rate", recipe: "plate", rate: 5 }, // member pin -> routed into the module
      { kind: "cap", recipe: "gear", rate: 9 }, // parent pin -> stays on the parent
    ],
    defaultTemp: noTemp,
  });
  expect(memberGroupOf.get("plate")).toBe(1);
  expect(memberGroupOf.has("gear")).toBe(false);
  // parent keeps gear and gains exactly one synthetic recipe (plate is pulled out)
  expect(parentDefs.map((d) => d.name).filter((n) => !isSyntheticSubName(n))).toEqual(["gear"]);
  expect(parentDefs.some((d) => isSyntheticSubName(d.name))).toBe(true);
  // the plate rate-pin left the parent with gear's cap pin
  expect(parentPins).toEqual([{ kind: "cap", recipe: "gear", rate: 9 }]);
  // the module honoured its routed rate-pin (plate forced to 5/s)
  expect(subs).toHaveLength(1);
  expect(rate(subs[0].result).plate).toBeCloseTo(5);
});

test("an empty (member-less) composed group is inert", async () => {
  const { parentDefs, subs } = await composeSubBlocks({
    defs: [plate, gear],
    groups: [{ id: 9, name: "Ghost", members: ["gone"], goals: [] }],
    pins: [],
    defaultTemp: noTemp,
  });
  expect(subs).toHaveLength(0);
  expect(parentDefs.map((d) => d.name)).toEqual(["plate", "gear"]);
});
