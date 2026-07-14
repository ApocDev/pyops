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
      }),
    ).toBe(true);
  });

  it("drains a reprocessor whose output re-enters the chain", () => {
    // The byproduct-chip gesture explicitly links the surplus to this consumer;
    // returning grade 3 to the chain must not make the selected row optional.
    expect(
      drainsOnConsume({
        good: "grade-2-iron",
        ingredients: [good("grade-2-iron", 4)],
        products: [good("grade-3-iron", 2), good("iron-slime", 1)],
      }),
    ).toBe(true);
  });

  it("drains pitch into coke when its products re-enter the chain", () => {
    expect(
      drainsOnConsume({
        good: "pitch",
        ingredients: [good("pitch", 100), good("steam", 100)],
        products: [
          good("hydrogen", 10),
          good("light-oil", 20),
          good("naphthalene-oil", 20),
          good("anthracene-oil", 30),
          good("coke", 10),
        ],
      }),
    ).toBe(true);
  });

  it("drains a product-less void", () => {
    expect(
      drainsOnConsume({
        good: "pollution",
        ingredients: [good("pollution", 10)],
        products: [],
      }),
    ).toBe(true);
  });

  it("drains when it returns LESS of the same good (net reducer)", () => {
    expect(
      drainsOnConsume({
        good: "sludge",
        ingredients: [good("sludge", 10)],
        products: [good("sludge", 3)],
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
      }),
    ).toBe(false);
  });
});
