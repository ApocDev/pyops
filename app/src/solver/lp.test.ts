import { expect, test } from "vite-plus/test";
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
const rate = (r: Awaited<ReturnType<typeof solveBlockLp>>) =>
  Object.fromEntries(r.recipes.map((x) => [x.recipe, x.rate]));
const flow = (fs: { name: string; rate: number }[], name: string) =>
  fs.find((f) => f.name === name)?.rate;

test("single recipe imports its raw input; ≥ goal binds exactly", async () => {
  const res = await solveBlockLp({ goals: [{ name: "plate", rate: 1 }], recipes: [plate] });
  expect(res.status).toBe("solved");
  expect(res.recipes[0].rate).toBeCloseTo(1);
  expect(res.recipes[0].machines1x).toBeCloseTo(10);
  expect(flow(res.imports, "ore")).toBeCloseTo(8);
  expect(res.exports).toEqual([]);
});

test("a chain links its intermediate via made and sizes the producer", async () => {
  const res = await solveBlockLp({
    goals: [{ name: "gear", rate: 1 }],
    recipes: [gear, plate],
    made: ["plate"],
  });
  expect(res.status).toBe("solved");
  expect(rate(res).plate).toBeCloseTo(2);
  expect(rate(res).gear).toBeCloseTo(1);
  expect(flow(res.imports, "ore")).toBeCloseTo(16);
  expect(res.exports).toEqual([]);
});

test("an unlinked intermediate imports instead — recipes are not conscripted", async () => {
  // plate NOT in `made`: the gear demand imports plates; the plate recipe
  // sits at 0 (nothing links it), and ore is never touched.
  const res = await solveBlockLp({
    goals: [{ name: "gear", rate: 1 }],
    recipes: [gear, plate],
  });
  expect(res.status).toBe("solved");
  expect(rate(res).gear).toBeCloseTo(1);
  expect(rate(res).plate).toBeCloseTo(0);
  expect(flow(res.imports, "plate")).toBeCloseTo(2);
  expect(flow(res.imports, "ore")).toBeUndefined();
});

test("forced byproduct surplus exports; both ≥ goals hold (1:2 co-product)", async () => {
  // one recipe makes a+2b; goals a≥1 and b≥1 would be INFEASIBLE as equalities
  const ab: RecipeDef = {
    name: "ab",
    energyRequired: 1,
    ingredients: [{ kind: "item", name: "x", amount: 1 }],
    products: [
      { kind: "item", name: "a", amount: 1 },
      { kind: "item", name: "b", amount: 2 },
    ],
  };
  const res = await solveBlockLp({
    goals: [
      { name: "a", rate: 1 },
      { name: "b", rate: 1 },
    ],
    recipes: [ab],
  });
  expect(res.status).toBe("solved");
  expect(rate(res).ab).toBeCloseTo(1); // a binds; b overshoots
  expect(flow(res.exports, "b")).toBeCloseTo(1); // only the surplus beyond the goal
  expect(flow(res.exports, "a")).toBeUndefined();
});

test("incidental byproduct offsets an import, never scales to cover it", async () => {
  // consumer needs 10 iron/s; a side recipe happens to make 0.02/s. iron is
  // NOT made → net import 9.98/s and the side recipe is sized by ITS product.
  const consumer: RecipeDef = {
    name: "consumer",
    energyRequired: 1,
    ingredients: [{ kind: "item", name: "iron", amount: 10 }],
    products: [{ kind: "item", name: "widget", amount: 1 }],
  };
  const side: RecipeDef = {
    name: "side",
    energyRequired: 1,
    ingredients: [{ kind: "item", name: "scrap", amount: 1 }],
    products: [
      { kind: "item", name: "goo", amount: 1 },
      { kind: "item", name: "iron", amount: 0.02 },
    ],
  };
  const res = await solveBlockLp({
    goals: [
      { name: "widget", rate: 1 },
      { name: "goo", rate: 1 },
    ],
    recipes: [consumer, side],
  });
  expect(res.status).toBe("solved");
  expect(rate(res).side).toBeCloseTo(1); // sized by goo, not by iron demand
  expect(flow(res.imports, "iron")).toBeCloseTo(9.98);
});

test("a consume goal (SINK) sizes the disposal recipe and imports the feed", async () => {
  const flare: RecipeDef = {
    name: "flare",
    energyRequired: 2,
    ingredients: [{ kind: "fluid", name: "tar", amount: 4 }],
    products: [],
  };
  const res = await solveBlockLp({ goals: [{ name: "tar", rate: -100 }], recipes: [flare] });
  expect(res.status).toBe("solved");
  expect(rate(res).flare).toBeCloseTo(25); // 100/4
  expect(flow(res.imports, "tar")).toBeCloseTo(100);
});

test("a rate pin drives a goalless block (supply-push)", async () => {
  const res = await solveBlockLp({
    goals: [],
    recipes: [plate],
    pins: [{ kind: "rate", recipe: "plate", rate: 3 }],
  });
  expect(res.status).toBe("solved");
  expect(rate(res).plate).toBeCloseTo(3);
  expect(flow(res.exports, "plate")).toBeCloseTo(3);
  expect(flow(res.imports, "ore")).toBeCloseTo(24);
});

test("a cap pin binds → infeasible when the goal needs more", async () => {
  const res = await solveBlockLp({
    goals: [{ name: "plate", rate: 10 }],
    recipes: [plate],
    pins: [{ kind: "cap", recipe: "plate", rate: 4 }],
  });
  expect(res.status).toBe("infeasible");
});

test("share pins mix with rate pins: fixed intake first, % of remainder, rest exports", async () => {
  // tar 100/s produced. A pinned at a rate consuming 20/s; B takes 25% of the
  // remaining 80 = 20/s; 60/s exports.
  const src: RecipeDef = {
    name: "src",
    energyRequired: 1,
    ingredients: [],
    products: [{ kind: "fluid", name: "tar", amount: 100 }],
  };
  const a: RecipeDef = {
    name: "a",
    energyRequired: 1,
    ingredients: [{ kind: "fluid", name: "tar", amount: 4 }],
    products: [{ kind: "item", name: "pa", amount: 1 }],
  };
  const b: RecipeDef = {
    name: "b",
    energyRequired: 1,
    ingredients: [{ kind: "fluid", name: "tar", amount: 1 }],
    products: [{ kind: "item", name: "pb", amount: 1 }],
  };
  const res = await solveBlockLp({
    goals: [],
    recipes: [src, a, b],
    pins: [
      { kind: "rate", recipe: "src", rate: 1 },
      { kind: "rate", recipe: "a", rate: 5 }, // 5 × 4 = 20/s tar
      { kind: "share", item: "tar", recipe: "b", share: 0.25 }, // of remaining 80
    ],
  });
  expect(res.status).toBe("solved");
  expect(rate(res).b).toBeCloseTo(20); // 0.25 × (100 − 20) / 1
  expect(flow(res.exports, "tar")).toBeCloseTo(60);
});

test("share of total (base: total) uses full production", async () => {
  const src: RecipeDef = {
    name: "src",
    energyRequired: 1,
    ingredients: [],
    products: [{ kind: "fluid", name: "tar", amount: 100 }],
  };
  const b: RecipeDef = {
    name: "b",
    energyRequired: 1,
    ingredients: [{ kind: "fluid", name: "tar", amount: 1 }],
    products: [],
  };
  const res = await solveBlockLp({
    goals: [],
    recipes: [src, b],
    pins: [
      { kind: "rate", recipe: "src", rate: 1 },
      { kind: "share", item: "tar", recipe: "b", share: 0.5, base: "total" },
    ],
  });
  expect(res.status).toBe("solved");
  expect(rate(res).b).toBeCloseTo(50);
  expect(flow(res.exports, "tar")).toBeCloseTo(50);
});

test("unmade produce goal is reported, not enforced — the rest still solves", async () => {
  const res = await solveBlockLp({
    goals: [
      { name: "gear", rate: 1 },
      { name: "widget", rate: 5 }, // nothing makes it
    ],
    recipes: [gear],
  });
  expect(res.status).toBe("solved");
  expect(res.unmade).toEqual(["widget"]);
  expect(rate(res).gear).toBeCloseTo(1);
});

test("made mark with no producer is reported and dropped, consumers keep running", async () => {
  const res = await solveBlockLp({
    goals: [{ name: "gear", rate: 1 }],
    recipes: [gear],
    made: ["plate"], // no plate producer in the block
  });
  expect(res.status).toBe("solved");
  expect(res.unmade).toEqual(["plate"]);
  expect(flow(res.imports, "plate")).toBeCloseTo(2);
});

test("self-consuming catalyst recipe covers itself under made (coal liquefaction shape)", async () => {
  const liq: RecipeDef = {
    name: "liq",
    energyRequired: 5,
    ingredients: [
      { kind: "item", name: "coal", amount: 10 },
      { kind: "fluid", name: "heavy-oil", amount: 25 },
    ],
    products: [{ kind: "fluid", name: "heavy-oil", amount: 90 }],
  };
  const res = await solveBlockLp({
    goals: [{ name: "heavy-oil", rate: 65 }],
    recipes: [liq],
    made: ["heavy-oil"],
  });
  expect(res.status).toBe("solved");
  expect(rate(res).liq).toBeCloseTo(1); // net 65/craft
  expect(res.exports).toEqual([]); // goal absorbs the whole net
  expect(flow(res.imports, "heavy-oil")).toBeUndefined(); // never imports its own catalyst
});

test("deterministic: identical degenerate producers solve identically twice", async () => {
  const p1: RecipeDef = { ...plate, name: "p1" };
  const p2: RecipeDef = { ...plate, name: "p2" };
  const input = {
    goals: [{ name: "plate", rate: 4 }],
    recipes: [p1, p2],
    made: ["plate"],
  };
  const a = await solveBlockLp(input);
  const b = await solveBlockLp(input);
  expect(a.status).toBe("solved");
  expect(rate(a)).toEqual(rate(b));
  expect(a.imports).toEqual(b.imports);
});

test("zero-time recipes stay bounded and deterministic (epsilon cost)", async () => {
  const vent: RecipeDef = {
    name: "vent",
    energyRequired: 0,
    ingredients: [{ kind: "fluid", name: "gas", amount: 1 }],
    products: [],
  };
  const src: RecipeDef = {
    name: "src",
    energyRequired: 0,
    ingredients: [],
    products: [{ kind: "fluid", name: "gas", amount: 1 }],
  };
  const res = await solveBlockLp({ goals: [{ name: "gas", rate: -5 }], recipes: [vent, src] });
  expect(res.status).toBe("solved");
  expect(rate(res).vent).toBeCloseTo(5);
  expect(rate(res).src).toBeCloseTo(0); // making gas just to vent it costs ε — never chosen
});

test("scale invariance: TW-scale and milli-scale blocks both solve exactly", async () => {
  const big: RecipeDef = {
    name: "big",
    energyRequired: 1,
    ingredients: [{ kind: "fluid", name: "steam", amount: 10_000_000 }],
    products: [{ kind: "fluid", name: "power", amount: 5_000_000 }],
  };
  const tiny: RecipeDef = {
    name: "tiny",
    energyRequired: 1,
    ingredients: [{ kind: "item", name: "spore", amount: 0.002 }],
    products: [{ kind: "item", name: "essence", amount: 0.001 }],
  };
  const r1 = await solveBlockLp({ goals: [{ name: "power", rate: 5_000_000 }], recipes: [big] });
  expect(r1.status).toBe("solved");
  expect(r1.recipes[0].rate).toBeCloseTo(1);
  const r2 = await solveBlockLp({ goals: [{ name: "essence", rate: 0.001 }], recipes: [tiny] });
  expect(r2.status).toBe("solved");
  expect(r2.recipes[0].rate).toBeCloseTo(1);
  expect(flow(r2.imports, "spore")).toBeCloseTo(0.002, 9);
});

test("empty block: no recipes, goals all unmade, nothing crashes", async () => {
  const res = await solveBlockLp({ goals: [{ name: "gear", rate: 1 }], recipes: [] });
  expect(res.status).toBe("solved");
  expect(res.unmade).toEqual(["gear"]);
  expect(res.recipes).toEqual([]);
});

test("mass conservation: every item's flows balance on a cyclic Py-style chain", async () => {
  // A recycle loop with a raw feed: net of every internal item must be exactly 0
  const crack: RecipeDef = {
    name: "crack",
    energyRequired: 2,
    ingredients: [{ kind: "fluid", name: "heavy", amount: 40 }],
    products: [{ kind: "fluid", name: "light", amount: 30 }],
  };
  const refine: RecipeDef = {
    name: "refine",
    energyRequired: 5,
    ingredients: [{ kind: "item", name: "crude", amount: 10 }],
    products: [
      { kind: "fluid", name: "heavy", amount: 20 },
      { kind: "fluid", name: "light", amount: 10 },
    ],
  };
  const res = await solveBlockLp({
    goals: [{ name: "light", rate: 25 }],
    recipes: [crack, refine],
    made: ["heavy", "light"],
  });
  expect(res.status).toBe("solved");
  const r = rate(res);
  // independent post-check, not the solver's own numbers: recompute all nets
  const netHeavy = 20 * r.refine - 40 * r.crack;
  const netLight = 10 * r.refine + 30 * r.crack;
  expect(netHeavy).toBeGreaterThanOrEqual(-1e-9); // made: net ≥ 0
  expect(netLight).toBeCloseTo(25, 9); // goal binds exactly (ε-cost pushes down)
});
