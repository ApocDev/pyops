import { expect, test } from "vite-plus/test";
import { diagnoseBlock } from "./diagnose.ts";
import type { RecipeDef } from "./lp.ts";

const plate: RecipeDef = {
  name: "plate",
  energyRequired: 10,
  ingredients: [{ kind: "item", name: "ore", amount: 8 }],
  products: [{ kind: "item", name: "plate", amount: 1 }],
};

const provTypes = (card: { members: { prov: { type: string } }[] }) =>
  card.members.map((m) => m.prov.type).sort();

test("feasible block diagnoses to no cards", async () => {
  const cards = await diagnoseBlock({ goals: [{ name: "plate", rate: 1 }], recipes: [plate] });
  expect(cards).toEqual([]);
});

test("cap vs goal: one card naming exactly the two gestures, with the shortfall", async () => {
  const cards = await diagnoseBlock({
    goals: [{ name: "plate", rate: 10 }],
    recipes: [plate],
    pins: [{ kind: "cap", recipe: "plate", rate: 4 }],
  });
  expect(cards).toHaveLength(1);
  expect(provTypes(cards[0])).toEqual(["goal", "pin-cap"].sort());
  // the elastic pass quantifies it: 10 wanted, 4 possible → short 6 (on one side)
  const short = Math.max(...cards[0].members.map((m) => m.shortBy));
  expect(short).toBeCloseTo(6);
});

test("a deadlock loop (made item whose only producer is net-negative) is named", async () => {
  // "producer" consumes 10 iron to make 5 — a loop that can never bootstrap
  const loop: RecipeDef = {
    name: "loop",
    energyRequired: 1,
    ingredients: [{ kind: "item", name: "iron", amount: 10 }],
    products: [{ kind: "item", name: "iron", amount: 5 }],
  };
  const consumer: RecipeDef = {
    name: "consumer",
    energyRequired: 1,
    ingredients: [{ kind: "item", name: "iron", amount: 2 }],
    products: [{ kind: "item", name: "widget", amount: 1 }],
  };
  const cards = await diagnoseBlock({
    goals: [{ name: "widget", rate: 1 }],
    recipes: [loop, consumer],
    made: ["iron"],
  });
  expect(cards).toHaveLength(1);
  // the made mark is the constraint that can't hold; the goal drives it
  const types = provTypes(cards[0]);
  expect(types).toContain("made");
  const madeMember = cards[0].members.find((m) => m.prov.type === "made")!;
  expect(madeMember.prov).toMatchObject({ item: "iron" });
});

test("overcommitted share pins are named together", async () => {
  const src: RecipeDef = {
    name: "src",
    energyRequired: 1,
    ingredients: [],
    products: [{ kind: "fluid", name: "tar", amount: 100 }],
  };
  const a: RecipeDef = {
    name: "a",
    energyRequired: 1,
    ingredients: [{ kind: "fluid", name: "tar", amount: 1 }],
    products: [],
  };
  const b: RecipeDef = {
    name: "b",
    energyRequired: 1,
    ingredients: [{ kind: "fluid", name: "tar", amount: 1 }],
    products: [],
  };
  const cards = await diagnoseBlock({
    goals: [],
    recipes: [src, a, b],
    made: ["tar"],
    pins: [
      { kind: "rate", recipe: "src", rate: 1 },
      { kind: "share", item: "tar", recipe: "a", share: 0.6, base: "total" },
      { kind: "share", item: "tar", recipe: "b", share: 0.6, base: "total" },
    ],
  });
  expect(cards.length).toBeGreaterThanOrEqual(1);
  // the involved gestures must all be pins/made on tar — never an unrelated recipe
  const provs = cards.flatMap((c) => c.members.map((m) => m.prov));
  for (const p of provs) {
    expect(["pin-share", "made", "pin-rate"]).toContain(p.type);
  }
  expect(provs.some((p) => p.type === "pin-share")).toBe(true);
});

test("two independent problems arrive as two cards", async () => {
  // two DISJOINT chains (no shared items), each with its own goal-vs-cap conflict
  const glass: RecipeDef = {
    name: "glass",
    energyRequired: 2,
    ingredients: [{ kind: "item", name: "sand", amount: 4 }],
    products: [{ kind: "item", name: "glass", amount: 1 }],
  };
  const cards = await diagnoseBlock({
    goals: [
      { name: "plate", rate: 10 },
      { name: "glass", rate: 5 },
    ],
    recipes: [plate, glass],
    pins: [
      { kind: "cap", recipe: "plate", rate: 4 }, // problem 1: plate goal unreachable
      { kind: "cap", recipe: "glass", rate: 2 }, // problem 2: glass goal unreachable
    ],
  });
  expect(cards).toHaveLength(2);
  const items = cards
    .map((c) => c.members.find((m) => m.prov.type === "goal")?.prov)
    .map((p) => (p && "item" in p ? p.item : null));
  expect(items.sort((a, b) => (a ?? "").localeCompare(b ?? ""))).toEqual(["glass", "plate"]);
});

test("coupled problems merge into one card (the chains share an item)", async () => {
  // gear consumes plate, so a plate cap and a gear cap are ONE tangled problem
  const gearRecipe: RecipeDef = {
    name: "gear",
    energyRequired: 0.5,
    ingredients: [{ kind: "item", name: "plate", amount: 2 }],
    products: [{ kind: "item", name: "gear", amount: 1 }],
  };
  const cards = await diagnoseBlock({
    goals: [
      { name: "plate", rate: 10 },
      { name: "gear", rate: 5 },
    ],
    recipes: [plate, gearRecipe],
    made: ["plate"],
    pins: [
      { kind: "cap", recipe: "plate", rate: 4 },
      { kind: "cap", recipe: "gear", rate: 2 },
    ],
  });
  expect(cards).toHaveLength(1);
});

test("diagnosis never names an uninvolved gesture", async () => {
  // an unrelated healthy chain sits alongside the broken one
  const healthy: RecipeDef = {
    name: "healthy",
    energyRequired: 1,
    ingredients: [{ kind: "item", name: "sand", amount: 1 }],
    products: [{ kind: "item", name: "glass", amount: 1 }],
  };
  const cards = await diagnoseBlock({
    goals: [
      { name: "glass", rate: 2 },
      { name: "plate", rate: 10 },
    ],
    recipes: [healthy, plate],
    pins: [{ kind: "cap", recipe: "plate", rate: 4 }],
  });
  expect(cards).toHaveLength(1);
  for (const m of cards[0].members) {
    const p = m.prov;
    if (p.type === "goal") expect(p.item).toBe("plate");
    if (p.type === "pin-cap") expect(p.recipe).toBe("plate");
    expect(JSON.stringify(p)).not.toContain("glass");
  }
});
