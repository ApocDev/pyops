import { describe, expect, it } from "vite-plus/test";
import {
  goalNames,
  normalizeBlockData,
  primaryGoal,
  primaryRate,
  withPrimaryRate,
} from "./goals.ts";

describe("normalizeBlockData", () => {
  it("derives temporary campaign rates and removes incompatible stock intent", () => {
    const out = normalizeBlockData({
      goals: [{ name: "vrauk", rate: 1, stock: 1, window: 3600 }],
      campaign: { duration: 3600, quantities: { vrauk: 1 }, confidence: "90" },
      recipes: [],
    });
    expect(out.campaign?.quantities).toEqual({ vrauk: 1 });
    expect(out.goals[0].rate * 3600).toBeCloseTo(Math.log(10), 5);
    expect(out.goals[0].stock).toBeUndefined();
  });
  it("migrates the legacy single-target shape to goals[]", () => {
    const out = normalizeBlockData({
      target: "transport-belt",
      rate: 1,
      recipes: ["transport-belt"],
    });
    expect(out.goals).toEqual([{ name: "transport-belt", rate: 1 }]);
    expect(out.recipes).toEqual(["transport-belt"]);
    // legacy fields are stripped
    expect("target" in out).toBe(false);
    expect("rate" in out).toBe(false);
  });

  it("defaults a legacy goal with no rate to 1/s", () => {
    expect(normalizeBlockData({ target: "plate" }).goals).toEqual([{ name: "plate", rate: 1 }]);
  });

  it("drops legacy extraGoals — they become byproducts, not goals", () => {
    const out = normalizeBlockData({
      target: "coke",
      rate: 10,
      extraGoals: ["carbolic-oil", "tar"],
      recipes: ["coking"],
    });
    expect(out.goals).toEqual([{ name: "coke", rate: 10 }]);
  });

  it("drops interim rate-less goals (old unpinned co-products)", () => {
    const out = normalizeBlockData({
      goals: [
        { name: "belt", rate: 4 },
        { name: "splitter", rate: null },
      ],
      recipes: ["transport-belt", "splitter"],
    });
    expect(out.goals).toEqual([{ name: "belt", rate: 4 }]);
  });

  it("is idempotent on the new shape", () => {
    const data = { goals: [{ name: "a", rate: 3 }], recipes: ["r"] };
    expect(normalizeBlockData(data)).toEqual(data);
  });

  it("repairs a stale stock-goal rate from its amount and refill window", () => {
    expect(
      normalizeBlockData({
        goals: [{ name: "belt", rate: 1, stock: 100, window: 600 }],
      }).goals,
    ).toEqual([{ name: "belt", rate: 1 / 6, stock: 100, window: 600 }]);
  });

  it("yields an empty goal list for an empty block", () => {
    expect(normalizeBlockData({ recipes: [] }).goals).toEqual([]);
  });
});

describe("goal accessors", () => {
  const data = {
    goals: [
      { name: "belt", rate: 10 },
      { name: "underground", rate: 4 },
      { name: "splitter", rate: 2 },
    ],
  };

  it("primaryGoal / primaryRate read the first goal", () => {
    expect(primaryGoal(data)).toEqual({ name: "belt", rate: 10 });
    expect(primaryRate(data)).toBe(10);
    expect(primaryRate({ goals: [] })).toBe(1); // empty → 1
  });

  it("goalNames lists every good in order", () => {
    expect(goalNames(data)).toEqual(["belt", "underground", "splitter"]);
  });

  it("withPrimaryRate re-rates only the first goal", () => {
    const out = withPrimaryRate(data, 20);
    expect(out.goals).toEqual([
      { name: "belt", rate: 20 },
      { name: "underground", rate: 4 },
      { name: "splitter", rate: 2 },
    ]);
  });

  it("preserves consume intent when a negative primary goal is balanced to zero", () => {
    const out = withPrimaryRate({ goals: [{ name: "kerogen", rate: -40 }] }, 0);
    expect(out.goals).toEqual([{ name: "kerogen", rate: 0, direction: "consume" }]);
  });
});
