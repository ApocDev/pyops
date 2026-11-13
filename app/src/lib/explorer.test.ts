import { describe, expect, it } from "vite-plus/test";
import {
  explorerGroup,
  groupExplorerCards,
  isRecyclingOrVoid,
  unitCost,
  type ExplorerCard,
} from "./explorer";

const card = (over: Partial<ExplorerCard> & { name: string }): ExplorerCard => ({
  display: over.name,
  enabled: true,
  unlocks: [],
  avail: { research: "enabled", turd: null },
  superseded: null,
  flow: null,
  cost: null,
  ...over,
});

describe("explorerGroup", () => {
  it("puts start-enabled and researched recipes in 'now'", () => {
    expect(explorerGroup(card({ name: "a" }))).toBe("now");
    expect(
      explorerGroup(
        card({
          name: "b",
          enabled: false,
          unlocks: [{}],
          avail: { research: "available", turd: null },
        }),
      ),
    ).toBe("now");
    // an ACTIVE TURD choice grants the recipe — it's available now
    expect(
      explorerGroup(
        card({
          name: "c",
          enabled: false,
          unlocks: [{}],
          avail: { research: "available", turd: { state: "active" } },
        }),
      ),
    ).toBe("now");
  });

  it("splits unpicked TURD choices from plain research locks", () => {
    expect(
      explorerGroup(
        card({
          name: "a",
          enabled: false,
          unlocks: [{}],
          avail: { research: "available", turd: { state: "pickable" } },
        }),
      ),
    ).toBe("turd");
    expect(
      explorerGroup(
        card({
          name: "b",
          enabled: false,
          unlocks: [{}],
          avail: { research: "needs-research", turd: null },
        }),
      ),
    ).toBe("research");
    // beyond the horizon wins over a pending TURD pick — research comes first
    expect(
      explorerGroup(
        card({
          name: "c",
          enabled: false,
          unlocks: [{}],
          avail: { research: "needs-research", turd: { state: "pickable" } },
        }),
      ),
    ).toBe("research");
  });

  it("marks superseded, TURD-blocked, and never-unlocked recipes 'off'", () => {
    expect(explorerGroup(card({ name: "a", superseded: { newRecipe: "x" } }))).toBe("off");
    expect(
      explorerGroup(
        card({
          name: "b",
          enabled: false,
          unlocks: [{}],
          avail: { research: "available", turd: { state: "blocked" } },
        }),
      ),
    ).toBe("off");
    expect(
      explorerGroup(
        card({
          name: "c",
          enabled: false,
          unlocks: [],
          avail: { research: "needs-research", turd: null },
        }),
      ),
    ).toBe("off");
  });
});

describe("groupExplorerCards", () => {
  it("orders groups now → turd → research → off and drops empty ones", () => {
    const groups = groupExplorerCards([
      card({
        name: "later",
        enabled: false,
        unlocks: [{}],
        avail: { research: "needs-research", turd: null },
      }),
      card({ name: "ready" }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(["now", "research"]);
    expect(groups[0].cards.map((c) => c.name)).toEqual(["ready"]);
  });

  it("ranks by flow desc inside a group, then cost asc, then name", () => {
    const groups = groupExplorerCards([
      card({ name: "slack", flow: 0, cost: 1 }),
      card({ name: "hot", flow: 5, cost: 100 }),
      card({ name: "warm", flow: 2, cost: 3 }),
      card({ name: "b-cheap", flow: 0, cost: 1 }),
      card({ name: "pricey", flow: 0, cost: 9 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].cards.map((c) => c.name)).toEqual([
      "hot",
      "warm",
      "b-cheap",
      "slack",
      "pricey",
    ]);
  });

  it("ranks by unit cost asc in unit-cost order, unpriced last", () => {
    const groups = groupExplorerCards(
      [
        card({ name: "unpriced", unitCost: null, flow: 9 }),
        card({ name: "pricey", unitCost: 14.27, flow: 0 }),
        card({ name: "cheap", unitCost: 4.66, flow: 0 }),
      ],
      "unit-cost",
    );
    expect(groups[0].cards.map((c) => c.name)).toEqual(["cheap", "pricey", "unpriced"]);
  });

  it("sorts unpriced recipes (null flow) below zero-flow ones", () => {
    const groups = groupExplorerCards([
      card({ name: "unpriced", flow: null }),
      card({ name: "zero", flow: 0 }),
    ]);
    expect(groups[0].cards.map((c) => c.name)).toEqual(["zero", "unpriced"]);
  });
});

describe("unitCost", () => {
  const prices: Record<string, number> = { plate: 1.18, slag: 0.1, junk: 0 };
  const priceOf = (n: string) => prices[n];

  it("divides a single-output recipe's cost by the amount made", () => {
    expect(unitCost(46.59, [{ name: "plate", amount: 10 }], "plate", priceOf)).toBeCloseTo(4.659);
  });

  it("splits a multi-output recipe's cost by output value share", () => {
    // value: 10 plates × 1.18 = 11.8, 20 slag × 0.1 = 2 → plates carry 11.8/13.8
    const products = [
      { name: "plate", amount: 10 },
      { name: "slag", amount: 20 },
    ];
    expect(unitCost(27.6, products, "plate", priceOf)).toBeCloseTo((27.6 * (11.8 / 13.8)) / 10);
    expect(unitCost(27.6, products, "slag", priceOf)).toBeCloseTo((27.6 * (2 / 13.8)) / 20);
  });

  it("puts exactly the recipe's waste share above the good's price", () => {
    const products = [
      { name: "plate", amount: 10 },
      { name: "slag", amount: 20 },
    ];
    const cost = 27.6;
    const waste = 1 - 13.8 / cost;
    expect(unitCost(cost, products, "plate", priceOf)! / prices.plate).toBeCloseTo(1 / (1 - waste));
  });

  it("counts probability in the amount made", () => {
    expect(
      unitCost(5, [{ name: "plate", amount: 2, probability: 0.5 }], "plate", priceOf),
    ).toBeCloseTo(5);
  });

  it("splits evenly when no output has a positive price", () => {
    const products = [
      { name: "junk", amount: 1 },
      { name: "other", amount: 4 },
    ];
    expect(unitCost(8, products, "junk", priceOf)).toBeCloseTo(4);
  });

  it("is null for unpriced recipes, unpriced goods, or goods not made", () => {
    expect(unitCost(null, [{ name: "plate", amount: 1 }], "plate", priceOf)).toBeNull();
    expect(unitCost(5, [{ name: "other", amount: 1 }], "other", priceOf)).toBeNull();
    expect(unitCost(5, [{ name: "slag", amount: 1 }], "plate", priceOf)).toBeNull();
  });
});

describe("isRecyclingOrVoid", () => {
  const recipe = (
    category: string | null,
    ingredients: { name: string; amount: number }[],
    products: { name: string; amount: number; probability?: number }[],
  ) => ({ category, ingredients, products });

  it("matches recycler recipes by category", () => {
    expect(
      isRecyclingOrVoid(
        recipe("recycling", [{ name: "turret", amount: 1 }], [{ name: "plate", amount: 5 }]),
      ),
    ).toBe(true);
  });

  it("matches voids that consume one good and return less of it", () => {
    // venting/sinkhole: no products
    expect(isRecyclingOrVoid(recipe("py-venting", [{ name: "gas", amount: 100 }], []))).toBe(true);
    // incineration: 1 ash in, 1 ash back at 20%
    expect(
      isRecyclingOrVoid(
        recipe(
          "py-incineration",
          [{ name: "ash", amount: 1 }],
          [{ name: "ash", amount: 1, probability: 0.2 }],
        ),
      ),
    ).toBe(true);
  });

  it("leaves productive recipes alone", () => {
    expect(
      isRecyclingOrVoid(
        recipe("smelting", [{ name: "ore", amount: 8 }], [{ name: "plate", amount: 1 }]),
      ),
    ).toBe(false);
    // a catalyst loop that returns at least what it takes is not a void
    expect(
      isRecyclingOrVoid(
        recipe("crafting", [{ name: "seed", amount: 1 }], [{ name: "seed", amount: 2 }]),
      ),
    ).toBe(false);
    expect(isRecyclingOrVoid(recipe("mining", [], [{ name: "ore", amount: 1 }]))).toBe(false);
  });
});
