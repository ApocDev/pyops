import { describe, expect, test } from "vite-plus/test";
import { solveBlockLp } from "./lp.ts";
import {
  expandQualities,
  qualityLadder,
  qualitySplit,
  type QualityRecipeDef,
  type QualityStep,
} from "./quality.ts";

/** Factorio 2.1's chain: base `normal` (next_probability 1, chain 0.1) linked
 * to the quality mod's four levels by `base-data-updates.lua`
 * (`data.raw.quality.normal.next = "uncommon"`). Values from
 * `quality/prototypes/quality.lua`; legendary is level 5 with no next. */
const STEPS: QualityStep[] = [
  { name: "legendary", level: 5, next: null, nextProbability: 0, chainProbability: 0 },
  { name: "normal", level: 0, next: "uncommon", nextProbability: 1, chainProbability: 0.1 },
  { name: "rare", level: 2, next: "epic", nextProbability: 1, chainProbability: 0.1 },
  { name: "uncommon", level: 1, next: "rare", nextProbability: 1, chainProbability: 0.1 },
  { name: "epic", level: 3, next: "legendary", nextProbability: 1, chainProbability: 0.1 },
  { name: "quality-unknown", level: 0, next: null, nextProbability: 0, chainProbability: 0 },
];
const ladder = qualityLadder(STEPS);
const shares = (split: { quality: string; share: number }[]) =>
  Object.fromEntries(split.map((s) => [s.quality, +s.share.toFixed(12)]));

describe("qualityLadder", () => {
  test("follows next from normal and drops qualities outside the chain", () => {
    expect(ladder.map((q) => q.name)).toEqual(["normal", "uncommon", "rare", "epic", "legendary"]);
  });

  test("is normal alone without a quality chain (Py)", () => {
    const py = qualityLadder([
      { name: "normal", level: 0, next: null, nextProbability: 1, chainProbability: 0.1 },
    ]);
    expect(py.map((q) => q.name)).toEqual(["normal"]);
    expect(qualityLadder([]).map((q) => q.name)).toEqual(["normal"]);
  });
});

describe("qualitySplit", () => {
  // Four quality module 3s: 4 × 0.025 = 0.1 total quality effect. YAFC-CE
  // ProductionTableContent.cs:548-561 gives P(≥ next) = 0.1 × 1, then × 0.1
  // per further level, and the exact shares are the differences.
  test("splits a normal craft with four quality module 3s", () => {
    expect(shares(qualitySplit(ladder, "normal", 0.1))).toEqual({
      normal: 0.9,
      uncommon: 0.09,
      rare: 0.009,
      epic: 0.0009,
      legendary: 0.0001,
    });
  });

  test("starts from the craft's own quality", () => {
    expect(shares(qualitySplit(ladder, "rare", 0.1))).toEqual({
      rare: 0.9,
      epic: 0.09,
      legendary: 0.01,
    });
  });

  test("puts chances past the unlocked top on the top quality", () => {
    // only uncommon and rare unlocked (the quality-module technology)
    expect(shares(qualitySplit(ladder, "normal", 0.1, "rare"))).toEqual({
      normal: 0.9,
      uncommon: 0.09,
      rare: 0.01,
    });
  });

  test("leaves the product at the craft's quality without a positive effect or a next level", () => {
    expect(qualitySplit(ladder, "normal", 0)).toEqual([{ quality: "normal", share: 1 }]);
    expect(qualitySplit(ladder, "normal", -0.05)).toEqual([{ quality: "normal", share: 1 }]);
    expect(qualitySplit(ladder, "legendary", 0.1)).toEqual([{ quality: "legendary", share: 1 }]);
    expect(qualitySplit(ladder.slice(0, 1), "normal", 0.1)).toEqual([
      { quality: "normal", share: 1 },
    ]);
  });

  test("clamps only the first step, as Factorio's chain_probability reads", () => {
    // Q × next_probability = 2 → always at least uncommon; the chain factor is
    // a conditional chance, so ≥rare stays 0.1 (YAFC-CE would give 0.2)
    expect(shares(qualitySplit(ladder, "normal", 2, "rare"))).toEqual({
      uncommon: 0.9,
      rare: 0.1,
    });
  });
});

const gear: QualityRecipeDef = {
  name: "iron-gear-wheel",
  energyRequired: 0.5,
  ingredients: [{ kind: "item", name: "iron-plate", amount: 2 }],
  products: [{ kind: "item", name: "iron-gear-wheel", amount: 1 }],
};
/** The recycler mod's generated recipe: ¼ of the 2 plates back
 * (`recycler/recycling.lua:105-123`), energy 0.5 / 16. */
const recycle: QualityRecipeDef = {
  name: "iron-gear-wheel-recycling",
  energyRequired: 0.03125,
  ingredients: [{ kind: "item", name: "iron-gear-wheel", amount: 1 }],
  products: [{ kind: "item", name: "iron-plate", amount: 0.5 }],
};
const noInput = { goals: [], made: [], pins: [], drains: [] };

describe("expandQualities", () => {
  test("returns the input untouched when nothing has quality", () => {
    const recipes = [gear];
    const made = ["iron-plate"];
    const pins = [{ kind: "rate" as const, recipe: gear.name, rate: 1 }];
    const drains: string[] = [];
    const { input, fold } = expandQualities(
      { goals: [{ name: "iron-gear-wheel", rate: 1 }], recipes, made, pins, drains },
      new Map([[gear.name, { levels: ["normal"], effect: 0 }]]),
      ladder,
    );
    expect(input.recipes).toBe(recipes);
    expect(input.made).toBe(made);
    expect(input.drains).toBe(drains);
    expect(input.pins).toEqual(pins);
    expect(input.goals).toEqual([{ name: "iron-gear-wheel", rate: 1 }]);
    expect(fold.rowOf(gear.name)).toEqual({ recipe: gear.name, quality: null });
  });

  test("a quality effect with no quality chain changes nothing (Py)", () => {
    const recipes = [gear];
    const { input } = expandQualities(
      { ...noInput, recipes },
      new Map([[gear.name, { levels: ["normal"], effect: 0.1 }]]),
      ladder.slice(0, 1),
    );
    expect(input.recipes).toBe(recipes);
  });

  test("gives each level its own column with ingredients at that quality and split products", () => {
    const fuelled: QualityRecipeDef = {
      ...gear,
      ingredients: [
        ...gear.ingredients,
        { kind: "item", name: "coal", amount: 1, fixedQuality: true },
      ],
      products: [
        ...gear.products,
        { kind: "fluid", name: "steam", amount: 10 },
        { kind: "item", name: "ash", amount: 1, fixedQuality: true },
      ],
    };
    const { input, fold } = expandQualities(
      { ...noInput, recipes: [fuelled] },
      new Map([[gear.name, { levels: ["normal", "uncommon"], effect: 0.1 }]]),
      ladder,
      "rare",
    );
    expect(input.recipes.map((r) => r.name)).toEqual([
      "iron-gear-wheel",
      "iron-gear-wheel@uncommon",
    ]);
    const [normal, uncommon] = input.recipes;
    expect(normal.ingredients.map((c) => c.name)).toEqual(["iron-plate", "coal"]);
    expect(uncommon.ingredients.map((c) => c.name)).toEqual(["iron-plate@uncommon", "coal"]);
    expect(Object.fromEntries(normal.products.map((c) => [c.name, +c.amount.toFixed(12)]))).toEqual(
      {
        "iron-gear-wheel": 0.9,
        "iron-gear-wheel@uncommon": 0.09,
        "iron-gear-wheel@rare": 0.01,
        steam: 10,
        ash: 1,
      },
    );
    expect(uncommon.products.map((c) => c.name)).toEqual([
      "iron-gear-wheel@uncommon",
      "iron-gear-wheel@rare",
      "steam",
      "ash",
    ]);
    expect(fold.rowOf("iron-gear-wheel@uncommon")).toEqual({
      recipe: "iron-gear-wheel",
      quality: "uncommon",
    });
    expect(fold.goodOf("iron-plate@uncommon")).toEqual({ name: "iron-plate", quality: "uncommon" });
    expect(fold.goodOf("iron-plate")).toEqual({ name: "iron-plate", quality: null });
  });

  test("keys goals and share pins by quality and spreads a count pin over the row", () => {
    const { input, ignoredPins } = expandQualities(
      {
        goals: [{ name: "iron-gear-wheel", rate: 1, quality: "rare" }],
        recipes: [gear, recycle],
        made: ["iron-plate@rare"],
        drains: ["iron-gear-wheel@uncommon"],
        pins: [
          { kind: "rate", recipe: gear.name, rate: 2 },
          {
            kind: "share",
            recipe: recycle.name,
            item: "iron-gear-wheel",
            share: 0.5,
            quality: "uncommon",
          },
          {
            kind: "share",
            recipe: recycle.name,
            item: "iron-gear-wheel",
            share: 0.5,
            quality: "rare",
          },
        ],
      },
      new Map([
        [gear.name, { levels: ["normal", "uncommon", "rare"], effect: 0 }],
        [recycle.name, { levels: ["normal", "uncommon"], effect: 0 }],
      ]),
      ladder,
    );
    expect(input.goals).toEqual([{ name: "iron-gear-wheel@rare", rate: 1 }]);
    expect(input.made).toEqual(["iron-plate@rare"]);
    expect(input.drains).toEqual(["iron-gear-wheel@uncommon"]);
    expect(input.pins).toEqual([
      {
        kind: "rate",
        recipe: "iron-gear-wheel",
        rate: 2,
        members: ["iron-gear-wheel", "iron-gear-wheel@uncommon", "iron-gear-wheel@rare"],
      },
      // the recycler doesn't run at rare, so the rare share has no consumer
      {
        kind: "share",
        recipe: "iron-gear-wheel-recycling@uncommon",
        item: "iron-gear-wheel@uncommon",
        share: 0.5,
      },
    ]);
    // ...and the block hears about it instead of the pin vanishing
    expect(ignoredPins).toEqual([
      { recipe: recycle.name, item: "iron-gear-wheel", quality: "rare", reason: "range" },
    ]);
  });

  test("reports a share pin above the best unlocked quality as locked", () => {
    // the row asked for normal..epic but plans at normal..uncommon, the best
    // unlocked quality; an epic share pin has no column to consume it
    const { input, ignoredPins } = expandQualities(
      {
        ...noInput,
        recipes: [gear, recycle],
        pins: [
          {
            kind: "share",
            recipe: recycle.name,
            item: "iron-gear-wheel",
            share: 1,
            quality: "epic",
          },
          { kind: "share", recipe: "gone", item: "iron-gear-wheel", share: 1, quality: "epic" },
        ],
      },
      new Map([[recycle.name, { levels: ["normal", "uncommon"], effect: 0 }]]),
      ladder,
      "uncommon",
    );
    expect(input.pins).toEqual([]);
    // a pin whose row left the block is dropped quietly, as without quality
    expect(ignoredPins).toEqual([
      { recipe: recycle.name, item: "iron-gear-wheel", quality: "epic", reason: "locked" },
    ]);
  });
});

describe("quality loops through the LP", () => {
  // Rare gears from normal plates (only uncommon and rare unlocked): craft at
  // normal..rare and recycle at normal..uncommon, both with Q = 0.1. Draining
  // normal and uncommon gears sends them to the recycler; made marks keep the
  // recycled uncommon and rare plates in the loop. Normal plates import.
  test("solves craft-and-recycle to the hand-derived steady state", async () => {
    const { input, fold } = expandQualities(
      {
        goals: [{ name: "iron-gear-wheel", rate: 1, quality: "rare" }],
        recipes: [gear, recycle],
        made: ["iron-plate@uncommon", "iron-plate@rare"],
        drains: ["iron-gear-wheel", "iron-gear-wheel@uncommon"],
        pins: [],
      },
      new Map([
        [gear.name, { levels: ["normal", "uncommon", "rare"], effect: 0.1 }],
        [recycle.name, { levels: ["normal", "uncommon"], effect: 0.1 }],
      ]),
      ladder,
      "rare",
    );
    const result = await solveBlockLp(input);
    expect(result.status).toBe("solved");
    const rate = (column: string) => result.recipes.find((r) => r.recipe === column)?.rate ?? 0;
    // With g0..g2 the crafts at each level and r0, r1 the recycles:
    //   drains: r0 = 0.9 g0, r1 = 0.09 g0 + 0.9 g1
    //   uncommon plates: 2 g1 = 0.045 r0 + 0.45 r1  → g1 = 0.081 / 1.595 g0
    //   rare plates:     2 g2 = 0.005 r0 + 0.05 r1  → g2 = (0.009 + 0.045 g1/g0) / 2 g0
    //   goal: 0.01 g0 + 0.1 g1 + g2 = 1
    const g1PerG0 = 0.081 / 1.595;
    const g2PerG0 = (0.009 + 0.045 * g1PerG0) / 2;
    const g0 = 1 / (0.01 + 0.1 * g1PerG0 + g2PerG0);
    expect(rate("iron-gear-wheel")).toBeCloseTo(g0, 4);
    expect(rate("iron-gear-wheel@uncommon")).toBeCloseTo(g1PerG0 * g0, 4);
    expect(rate("iron-gear-wheel@rare")).toBeCloseTo(g2PerG0 * g0, 4);
    expect(rate("iron-gear-wheel-recycling")).toBeCloseTo(0.9 * g0, 4);
    expect(rate("iron-gear-wheel-recycling@uncommon")).toBeCloseTo(
      0.09 * g0 + 0.9 * g1PerG0 * g0,
      4,
    );
    // only normal plates cross the boundary, net of the recycled share
    expect(result.imports.map((f) => f.name)).toEqual(["iron-plate"]);
    expect(result.imports[0].rate).toBeCloseTo(2 * g0 - 0.45 * 0.9 * g0, 4);
    expect(result.exports).toEqual([]);
    expect(fold.rowOf("iron-gear-wheel-recycling@uncommon").recipe).toBe(recycle.name);
  });

  test("a count pin on a quality row fixes its total rate", async () => {
    const goals: { name: string; rate: number }[] = [];
    const { input } = expandQualities(
      {
        goals,
        recipes: [gear],
        made: [],
        drains: [],
        pins: [{ kind: "rate", recipe: gear.name, rate: 3 }],
      },
      new Map([[gear.name, { levels: ["normal", "uncommon"], effect: 0 }]]),
      ladder,
    );
    const result = await solveBlockLp(input);
    expect(result.status).toBe("solved");
    const total = result.recipes.reduce((sum, r) => sum + r.rate, 0);
    expect(total).toBeCloseTo(3, 6);
  });
});

describe("fluid share pins on quality rows", () => {
  // Gears that also eat lubricant. Fluids never carry quality, so a share pin on
  // lubricant names no quality and must cover every column of the row.
  const lubed: QualityRecipeDef = {
    ...gear,
    ingredients: [...gear.ingredients, { kind: "fluid", name: "lubricant", amount: 10 }],
  };
  const lubricant: QualityRecipeDef = {
    name: "lubricant",
    energyRequired: 1,
    ingredients: [],
    products: [{ kind: "fluid", name: "lubricant", amount: 10 }],
  };
  const widget: QualityRecipeDef = {
    name: "widget",
    energyRequired: 1,
    ingredients: [{ kind: "fluid", name: "lubricant", amount: 10 }],
    products: [{ kind: "item", name: "widget", amount: 1 }],
  };
  const sharePin = { kind: "share" as const, recipe: lubed.name, item: "lubricant", share: 0.25 };

  test("targets the only column of a rare-only row and spans a range row", () => {
    const pinsFor = (levels: string[]) =>
      expandQualities(
        { ...noInput, recipes: [lubed], pins: [sharePin] },
        new Map([[lubed.name, { levels, effect: 0 }]]),
        ladder,
      ).input.pins;
    expect(pinsFor(["rare"])).toEqual([{ ...sharePin, recipe: "iron-gear-wheel@rare" }]);
    expect(pinsFor(["normal", "uncommon", "rare"])).toEqual([
      {
        ...sharePin,
        members: ["iron-gear-wheel", "iron-gear-wheel@uncommon", "iron-gear-wheel@rare"],
      },
    ]);
  });

  test("splits the row's summed intake across its columns", async () => {
    // widgets eat 30 lubricant; the gear row takes a quarter of all lubricant,
    // so its two columns eat 10 together: 0.6 uncommon crafts (6) + 0.4 normal (4)
    const { input } = expandQualities(
      {
        goals: [
          { name: "widget", rate: 3 },
          { name: "iron-gear-wheel", rate: 0.6, quality: "uncommon" },
        ],
        recipes: [lubed, lubricant, widget],
        made: ["lubricant"],
        drains: [],
        pins: [sharePin],
      },
      new Map([[lubed.name, { levels: ["normal", "uncommon"], effect: 0 }]]),
      ladder,
    );
    const result = await solveBlockLp(input);
    expect(result.status).toBe("solved");
    const rate = (column: string) => result.recipes.find((r) => r.recipe === column)?.rate ?? 0;
    expect(rate("iron-gear-wheel@uncommon")).toBeCloseTo(0.6, 6);
    expect(rate("iron-gear-wheel")).toBeCloseTo(0.4, 6);
    expect(rate("lubricant")).toBeCloseTo(4, 6);
  });

  test("a count-pinned range row's fluid intake comes off a remaining share", async () => {
    // 100 lubricant/s; the gear row is pinned at 5 crafts over normal..uncommon,
    // eating 50/s whatever the split; widgets take 25% of the remaining 50
    const goals: { name: string; rate: number }[] = [];
    const { input } = expandQualities(
      {
        goals,
        recipes: [lubed, lubricant, widget],
        made: [],
        drains: [],
        pins: [
          { kind: "rate", recipe: lubricant.name, rate: 10 },
          { kind: "rate", recipe: lubed.name, rate: 5 },
          { kind: "share", recipe: widget.name, item: "lubricant", share: 0.25 },
        ],
      },
      new Map([[lubed.name, { levels: ["normal", "uncommon"], effect: 0 }]]),
      ladder,
    );
    const result = await solveBlockLp(input);
    expect(result.status).toBe("solved");
    expect(result.recipes.find((r) => r.recipe === widget.name)?.rate).toBeCloseTo(1.25, 6);
  });

  test("a count-pinned range row's item intake comes off a remaining share", async () => {
    // 100 normal plates/s; the gear row is pinned at 10 crafts over
    // normal..uncommon and a goal of 10 normal gears forces all ten to normal,
    // eating 20 plates; a second consumer takes 25% of the remaining 80
    const src: QualityRecipeDef = {
      name: "plate-src",
      energyRequired: 1,
      ingredients: [],
      products: [{ kind: "item", name: "iron-plate", amount: 100 }],
    };
    const chest: QualityRecipeDef = {
      name: "chest",
      energyRequired: 1,
      ingredients: [{ kind: "item", name: "iron-plate", amount: 8 }],
      products: [{ kind: "item", name: "chest", amount: 1 }],
    };
    const { input } = expandQualities(
      {
        goals: [{ name: "iron-gear-wheel", rate: 10, quality: "normal" }],
        recipes: [src, gear, chest],
        made: [],
        drains: [],
        pins: [
          { kind: "rate", recipe: src.name, rate: 1 },
          { kind: "rate", recipe: gear.name, rate: 10 },
          { kind: "share", recipe: chest.name, item: "iron-plate", share: 0.25 },
        ],
      },
      new Map([[gear.name, { levels: ["normal", "uncommon"], effect: 0 }]]),
      ladder,
    );
    const result = await solveBlockLp(input);
    expect(result.status).toBe("solved");
    expect(result.recipes.find((r) => r.recipe === chest.name)?.rate).toBeCloseTo(2.5, 6);
  });
});
