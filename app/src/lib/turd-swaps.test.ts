import { describe, expect, it } from "vite-plus/test";
import { groupSwaps, lineIsGood, swapLabel, swapLines, type RecipeSide } from "./turd-swaps";

const good = (name: string, amount: number, kind = "item") => ({
  kind,
  name,
  display: name[0]!.toUpperCase() + name.slice(1),
  amount,
});
const recipe = (
  time: number,
  ins: ReturnType<typeof good>[],
  outs: ReturnType<typeof good>[],
): RecipeSide => ({ energyRequired: time, ingredients: ins, products: outs });

describe("swapLines", () => {
  it("reports only what differs: time, added inputs, changed outputs", () => {
    const from = recipe(100, [good("seed", 1)], [good("moss", 8)]);
    const to = recipe(75, [good("seed", 1), good("water", 1, "fluid")], [good("moss", 12)]);
    expect(swapLines(from, to)).toEqual([
      { kind: "time", a: 100, b: 75 },
      { kind: "in", good: { kind: "fluid", name: "water", display: "Water" }, a: 0, b: 1 },
      { kind: "out", good: { kind: "item", name: "moss", display: "Moss" }, a: 8, b: 12 },
    ]);
  });

  it("sums a good listed twice before comparing", () => {
    const from = recipe(1, [good("ore", 2), good("ore", 3)], []);
    const to = recipe(1, [good("ore", 5)], []);
    expect(swapLines(from, to)).toEqual([]);
  });
});

describe("groupSwaps", () => {
  const change = (fromDisplay: string, from: RecipeSide, to: RecipeSide) => ({
    fromDisplay,
    lines: swapLines(from, to),
  });

  it("collapses tiers with the same change into one group with ranges", () => {
    const tiers = [1, 2, 3].map((t) =>
      change(
        `Bioprinter MK 0${t}`,
        recipe(10, [], [good("egg", 4 * t)]),
        recipe(10, [good("gel", t)], [good("egg", 6 * t)]),
      ),
    );
    const [group, ...rest] = groupSwaps(tiers);
    expect(rest).toEqual([]);
    expect(group!.label).toBe("Bioprinter");
    expect(group!.changes).toHaveLength(3);
    const egg = group!.lines.find((l) => l.good?.name === "egg")!;
    expect(egg.a).toEqual([4, 12]);
    expect(egg.ratio).toEqual([1.5, 1.5]);
    expect(lineIsGood(egg)).toBe(true);
    const gel = group!.lines.find((l) => l.good?.name === "gel")!;
    expect(gel.b).toEqual([1, 3]);
    expect(lineIsGood(gel)).toBe(false);
  });

  it("merges tiered goods into one tier-less line", () => {
    const tiers = [1, 2].map((t) =>
      change(
        `Moss farm MK 0${t}`,
        recipe(1, [], []),
        recipe(
          1,
          [{ kind: "item", name: `reactor-${t}`, display: `Bioreactor MK 0${t}`, amount: 1 }],
          [],
        ),
      ),
    );
    const [group, ...rest] = groupSwaps(tiers);
    expect(rest).toEqual([]);
    expect(group!.label).toBe("Moss farm");
    expect(groupSwaps(tiers.slice(0, 1))[0]!.label).toBe("Moss farm MK 01");
    expect(group!.lines).toHaveLength(1);
    expect(group!.lines[0]!.good?.display).toBe("Bioreactor");
  });

  it("keeps a dropped and an added tier of the same good as separate lines", () => {
    const reactor = (t: number) => ({
      kind: "item",
      name: `reactor-${t}`,
      display: `Bioreactor MK 0${t}`,
      amount: 1,
    });
    const [group] = groupSwaps([
      change("Moss farm", recipe(1, [reactor(1)], []), recipe(1, [reactor(2)], [])),
    ]);
    expect(group!.lines).toHaveLength(2);
    expect(group!.lines.map((l) => [l.a[1], l.b[1]]).sort((x, y) => x[0]! - y[0]!)).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });

  it("keeps same-named swaps apart when their changes point different ways", () => {
    const up = change("Fish", recipe(10, [], [good("fish", 1)]), recipe(10, [], [good("fish", 2)]));
    const down = change(
      "Fish",
      recipe(10, [], [good("fish", 2)]),
      recipe(10, [], [good("fish", 1)]),
    );
    expect(groupSwaps([up, down])).toHaveLength(2);
  });
});

describe("swapLabel", () => {
  it("drops only a trailing MK tier", () => {
    expect(swapLabel("Fawogae MK 02")).toBe("Fawogae");
    expect(swapLabel("MK 02 parts")).toBe("MK 02 parts");
  });
});
