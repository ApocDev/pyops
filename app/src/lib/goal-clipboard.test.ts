import { describe, expect, it } from "vite-plus/test";
import { parseGoalsClipboard, serializeGoalsClipboard } from "./goal-clipboard.ts";

describe("goal clipboard", () => {
  it("round-trips goal intent while dropping source-derived factory rates", () => {
    const text = serializeGoalsClipboard([
      { name: "iron-plate", rate: 2, unit: "min", factoryRate: 8 },
      { name: "stone-brick", rate: 8, stock: 20, window: 3600, factoryRate: 8 },
    ]);

    expect(parseGoalsClipboard(text)).toEqual([
      { name: "iron-plate", rate: 2, unit: "min" },
      { name: "stone-brick", rate: 20 / 3600, stock: 20, window: 3600 },
    ]);
  });

  it("accepts goals from the existing Copy setup JSON", () => {
    expect(
      parseGoalsClipboard(JSON.stringify({ goals: [{ name: "copper-plate", rate: 0.5 }] })),
    ).toEqual([{ name: "copper-plate", rate: 0.5 }]);
  });

  it("rejects malformed, unrelated, and unknown-version payloads", () => {
    expect(parseGoalsClipboard("not json")).toBeNull();
    expect(parseGoalsClipboard(JSON.stringify({ recipes: ["iron-plate"] }))).toBeNull();
    expect(
      parseGoalsClipboard(
        JSON.stringify({ kind: "pyops/goals", version: 2, goals: [{ name: "a", rate: 1 }] }),
      ),
    ).toBeNull();
    expect(
      parseGoalsClipboard(JSON.stringify({ goals: [{ name: "iron-plate", rate: "fast" }] })),
    ).toBeNull();
  });
});
