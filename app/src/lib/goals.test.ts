import { describe, expect, it } from "vite-plus/test";
import {
  goalChangeRequest,
  goalNames,
  normalizeBlockData,
  primaryGoal,
  primaryRate,
  requestedGoalChanges,
  withGoalChanges,
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

describe("withGoalChanges", () => {
  // a mall block: one rate goal, two keep-in-stock goals
  const mall = {
    goals: [
      { name: "biofactory", rate: 0.01 },
      { name: "assembler", rate: 0.02, stock: 12, window: 600 },
      { name: "soil-extractor", rate: 0.01, stock: 6, window: 600 },
    ],
  };
  const changed = (changes: Parameters<typeof withGoalChanges>[1]) => {
    const out = withGoalChanges(mall, changes);
    if ("error" in out) throw new Error(out.error);
    return out.data.goals;
  };

  it("changes several goals by name in one call and keeps the rest", () => {
    const goals = changed([
      { name: "assembler", stock: 78 },
      { name: "soil-extractor", stock: 53, window: 1200 },
    ]);
    expect(goals[0]).toEqual(mall.goals[0]);
    expect(goals[1]).toMatchObject({ name: "assembler", stock: 78, window: 600 });
    expect(goals[1].rate).toBeCloseTo(78 / 600);
    expect(goals[2]).toMatchObject({ stock: 53, window: 1200 });
    expect(goals[2].rate).toBeCloseTo(53 / 1200);
  });

  it("re-derives a stock goal's rate from a new window alone", () => {
    const goals = changed([{ name: "assembler", window: 300 }]);
    expect(goals[1]).toMatchObject({ stock: 12, window: 300, rate: 12 / 300 });
  });

  it("changes a rate goal that is not the first one", () => {
    const out = withGoalChanges(
      {
        goals: [
          { name: "a", rate: 1 },
          { name: "b", rate: 2 },
        ],
      },
      [{ name: "b", rate: 5 }],
    );
    expect(out).toEqual({
      data: {
        goals: [
          { name: "a", rate: 1 },
          { name: "b", rate: 5, direction: undefined },
        ],
      },
      indexes: [1],
    });
  });

  describe("one fluid at several temperatures", () => {
    const boilers = {
      goals: [
        { name: "steam", rate: 60, temperature: 165 },
        { name: "steam", rate: 20, temperature: 500 },
        { name: "water", rate: 10 },
      ],
    };

    it("refuses a bare name that matches several goals, listing them", () => {
      expect(withGoalChanges(boilers, [{ name: "steam", rate: 90 }])).toEqual({
        error:
          '"steam" matches several goals (steam at 165°, steam at 500°) — pass `temperature` to pick one',
      });
    });

    it("edits only the goal at the given temperature", () => {
      const out = withGoalChanges(boilers, [{ name: "steam", temperature: 500, rate: 45 }]);
      if ("error" in out) throw new Error(out.error);
      expect(out.indexes).toEqual([1]);
      expect(out.data.goals.map((g) => g.rate)).toEqual([60, 45, 10]);
      expect(out.data.goals[1].temperature).toBe(500);
    });

    it("still matches a unique name without a temperature", () => {
      const out = withGoalChanges(boilers, [{ name: "water", rate: 12 }]);
      if ("error" in out) throw new Error(out.error);
      expect(out.data.goals.map((g) => g.rate)).toEqual([60, 20, 12]);
    });

    it("names the goals when no goal has that temperature", () => {
      expect(withGoalChanges(boilers, [{ name: "steam", temperature: 250, rate: 1 }])).toEqual({
        error:
          '"steam at 250°" is not a goal of this block (its goals: steam at 165°, steam at 500°, water)',
      });
    });
  });

  describe("one fluid with and without a temperature", () => {
    const block = {
      goals: [
        { name: "steam", rate: 60 },
        { name: "steam", rate: 20, temperature: 500 },
      ],
    };
    const rates = (changes: Parameters<typeof withGoalChanges>[1], d = block) => {
      const out = withGoalChanges(d, changes);
      if ("error" in out) throw new Error(out.error);
      return out.data.goals.map((g) => g.rate);
    };

    it("a bare name edits the goal with no temperature", () => {
      expect(rates([{ name: "steam", rate: 90 }])).toEqual([90, 20]);
    });

    it("a temperature edits the qualified goal", () => {
      expect(rates([{ name: "steam", temperature: 500, rate: 45 }])).toEqual([60, 45]);
    });

    it("the top-level rate edits the first goal by position", () => {
      expect(rates(requestedGoalChanges(block, 90))).toEqual([90, 20]);
      // even when name matching alone couldn't tell the goals apart
      const twins = {
        goals: [
          { name: "steam", rate: 60 },
          { name: "steam", rate: 20 },
        ],
      };
      expect(rates(requestedGoalChanges(twins, 90), twins)).toEqual([90, 20]);
      expect(withGoalChanges(twins, [{ name: "steam", rate: 90 }])).toEqual({
        error: expect.stringMatching(/matches several goals/),
      });
      // the proposal card's Apply keeps the position the preview changed
      const diff = {
        name: "steam",
        index: 0,
        display: "Steam",
        before: { rate: 60 },
        after: { rate: 90 },
      };
      expect(rates([goalChangeRequest(diff)], twins)).toEqual([90, 20]);
      // a stale position falls back to matching the temperature
      const reordered = { goals: [...block.goals].reverse() };
      expect(rates([{ name: "steam", temperature: 500, index: 1, rate: 45 }], reordered)).toEqual([
        45, 60,
      ]);
    });
  });

  it("names an unknown good and the block's real goals", () => {
    expect(withGoalChanges(mall, [{ name: "pipe", stock: 10 }])).toEqual({
      error:
        '"pipe" is not a goal of this block (its goals: biofactory, assembler, soil-extractor)',
    });
  });

  it("rejects repeated, contradictory, and empty changes", () => {
    expect(
      withGoalChanges(mall, [
        { name: "assembler", stock: 1 },
        { name: "assembler", stock: 2 },
      ]),
    ).toEqual({ error: expect.stringMatching(/changed twice/) });
    expect(withGoalChanges(mall, [{ name: "assembler", rate: 1, stock: 2 }])).toEqual({
      error: expect.stringMatching(/not both/),
    });
    expect(withGoalChanges(mall, [{ name: "biofactory", window: 60 }])).toEqual({
      error: expect.stringMatching(/rate goal/),
    });
    expect(withGoalChanges(mall, [{ name: "assembler" }])).toEqual({
      error: expect.stringMatching(/pass a new/),
    });
  });
});
