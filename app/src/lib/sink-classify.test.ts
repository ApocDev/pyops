import { describe, expect, it } from "vite-plus/test";
import { drainsOnConsume } from "./sink-classify.ts";

const good = (name: string, amount: number) => ({ name, amount });

describe("drainsOnConsume", () => {
  it("drains a pure void whose output leaves the block (coal-gas → ash)", () => {
    // coal-gas-void: 50 coal-gas in, 1 ash out; nothing in the block uses ash
    expect(
      drainsOnConsume({
        good: "coal-gas",
        ingredients: [good("coal-gas", 50)],
        products: [good("ash", 1)],
        consumedInBlock: new Set(["coal", "raw-coal", "tar", "steam", "water"]),
      }),
    ).toBe(true);
  });

  it("does NOT drain a reprocessor whose output re-enters the chain (block 27)", () => {
    // grade-2-crush: consumes grade-2-iron, makes grade-3-iron which the chain uses
    expect(
      drainsOnConsume({
        good: "grade-2-iron",
        ingredients: [good("grade-2-iron", 4)],
        products: [good("grade-3-iron", 2), good("iron-slime", 1)],
        consumedInBlock: new Set(["grade-2-iron", "grade-3-iron", "iron-slime"]),
      }),
    ).toBe(false);
  });

  it("drains a product-less void", () => {
    expect(
      drainsOnConsume({
        good: "pollution",
        ingredients: [good("pollution", 10)],
        products: [],
        consumedInBlock: new Set(["iron-plate"]),
      }),
    ).toBe(true);
  });

  it("drains when it returns LESS of the same good (net reducer)", () => {
    expect(
      drainsOnConsume({
        good: "sludge",
        ingredients: [good("sludge", 10)],
        products: [good("sludge", 3)],
        consumedInBlock: new Set(),
      }),
    ).toBe(true);
  });

  it("does NOT drain a net PRODUCER of the good", () => {
    // consumes 10, makes 20 of the same good — not a sink
    expect(
      drainsOnConsume({
        good: "steam",
        ingredients: [good("steam", 10)],
        products: [good("steam", 20)],
        consumedInBlock: new Set(),
      }),
    ).toBe(false);
  });

  it("drains a multi-output void when every other product leaves the block", () => {
    expect(
      drainsOnConsume({
        good: "waste-water",
        ingredients: [good("waste-water", 100)],
        products: [good("mineral-sludge", 1), good("stone", 1)],
        consumedInBlock: new Set(["waste-water"]), // neither product used elsewhere
      }),
    ).toBe(true);
  });

  it("does NOT drain when ANY other product feeds the block", () => {
    expect(
      drainsOnConsume({
        good: "waste-water",
        ingredients: [good("waste-water", 100)],
        products: [good("stone", 1), good("iron-ore", 1)],
        consumedInBlock: new Set(["iron-ore"]), // iron-ore re-enters the chain
      }),
    ).toBe(false);
  });
});
