import { describe, expect, it } from "vite-plus/test";
import { buildFlowGraph, type FlowInput } from "./flow-graph.ts";

/** Shorthand for a recipe row (defaults fill the fields the graph ignores). */
function row(
  recipe: string,
  ingredients: [string, number, ("item" | "fluid")?][],
  products: [string, number, ("item" | "fluid")?][],
  machineCount = 1,
): FlowInput["rows"][number] {
  return {
    recipe,
    display: recipe,
    rate: 1,
    machine: { count: machineCount },
    ingredients: ingredients.map(([name, rate, kind]) => ({ name, rate, kind: kind ?? "item" })),
    products: products.map(([name, rate, kind]) => ({ name, rate, kind: kind ?? "item" })),
  };
}

describe("buildFlowGraph", () => {
  it("derives recipe, import and goal-output nodes with balanced links", () => {
    // ra: ore + W → X   |   rb: X → W + Y(goal)   — a W↔X recycle loop.
    const g = buildFlowGraph({
      rows: [
        row(
          "ra",
          [
            ["ore", 5],
            ["W", 2, "fluid"],
          ],
          [["X", 8]],
          2,
        ),
        row(
          "rb",
          [["X", 8]],
          [
            ["W", 2, "fluid"],
            ["Y", 8],
          ],
          3,
        ),
      ],
      imports: [{ name: "ore", kind: "item", rate: 5 }],
      exports: [],
      goalNames: ["Y"],
      display: { X: "Ecks", Y: "Why", ore: "Ore", W: "Dubya" },
    });

    const ids = new Set(g.nodes.map((n) => n.id));
    expect(ids).toEqual(new Set(["r:ra", "r:rb", "i:ore", "o:Y"]));

    // the import is a pure source at the left; the goal output is right-aligned.
    const imp = g.nodes.find((n) => n.id === "i:ore")!;
    const out = g.nodes.find((n) => n.id === "o:Y")!;
    expect(imp.kind).toBe("import");
    expect(imp.layer).toBe(0);
    expect(out.kind).toBe("output");
    expect(out.layer).toBe(g.layerCount - 1);
    expect(out.display).toBe("Why"); // localized, not the internal name

    // recipe node carries its ceil'd machine count and localized good on links
    expect(g.nodes.find((n) => n.id === "r:ra")!.machineCount).toBe(2);

    const link = (source: string, target: string, good: string) =>
      g.links.find((l) => l.source === source && l.target === target && l.good === good);
    expect(link("i:ore", "r:ra", "ore")!.rate).toBeCloseTo(5);
    expect(link("r:ra", "r:rb", "X")!.rate).toBeCloseTo(8);
    expect(link("r:rb", "r:ra", "W")!.rate).toBeCloseTo(2);
    expect(link("r:rb", "o:Y", "Y")!.rate).toBeCloseTo(8);
    expect(link("r:rb", "o:Y", "Y")!.display).toBe("Why");
  });

  it("flags the cycle's back-edge and keeps forward edges forward", () => {
    const g = buildFlowGraph({
      rows: [
        row("ra", [["W", 2, "fluid"]], [["X", 8]]),
        row(
          "rb",
          [["X", 8]],
          [
            ["W", 2, "fluid"],
            ["Y", 8],
          ],
        ),
      ],
      imports: [],
      exports: [],
      goalNames: ["Y"],
    });
    const xLink = g.links.find((l) => l.good === "X")!; // ra → rb, forward
    const wLink = g.links.find((l) => l.good === "W")!; // rb → ra, the recycle loop
    expect(xLink.back).toBe(false);
    expect(wLink.back).toBe(true);
    expect(g.nodes.find((n) => n.id === "r:ra")!.layer).toBeLessThan(
      g.nodes.find((n) => n.id === "r:rb")!.layer,
    );
  });

  it("splits a pooled good proportionally across producers and consumers", () => {
    // p1(6) + p2(4) → X(10) → q(5) + r(5): each producer feeds each consumer in
    // proportion, so the four links reconstruct both sides' totals exactly.
    const g = buildFlowGraph({
      rows: [
        row("p1", [], [["X", 6]]),
        row("p2", [], [["X", 4]]),
        row("q", [["X", 5]], [["Yq", 5]]),
        row("r", [["X", 5]], [["Yr", 5]]),
      ],
      imports: [],
      exports: [],
      goalNames: ["Yq", "Yr"],
    });
    const rate = (s: string, t: string) =>
      g.links.find((l) => l.source === s && l.target === t && l.good === "X")?.rate ?? 0;
    expect(rate("r:p1", "r:q")).toBeCloseTo(3);
    expect(rate("r:p1", "r:r")).toBeCloseTo(3);
    expect(rate("r:p2", "r:q")).toBeCloseTo(2);
    expect(rate("r:p2", "r:r")).toBeCloseTo(2);
    // producer p1 emits its whole 6, consumer q draws its whole 5
    expect(rate("r:p1", "r:q") + rate("r:p1", "r:r")).toBeCloseTo(6);
    expect(rate("r:p1", "r:q") + rate("r:p2", "r:q")).toBeCloseTo(5);
  });

  it("emits an export node for a surplus byproduct and no self-loop for a catalyst", () => {
    // rc makes X (goal) and spills Z as surplus; it also recycles its own cat.
    const g = buildFlowGraph({
      rows: [
        row(
          "rc",
          [["cat", 1]],
          [
            ["X", 4],
            ["Z", 2],
            ["cat", 1],
          ],
        ),
      ],
      imports: [],
      exports: [{ name: "Z", kind: "item", rate: 2 }],
      goalNames: ["X"],
    });
    expect(g.nodes.some((n) => n.id === "e:Z" && n.kind === "export")).toBe(true);
    // the catalyst is produced and consumed by the same node → no self link
    expect(g.links.some((l) => l.source === l.target)).toBe(false);
    expect(g.links.some((l) => l.good === "cat")).toBe(false);
  });

  it("returns an empty graph for a block with no running rows", () => {
    const g = buildFlowGraph({ rows: [], imports: [], exports: [], goalNames: [] });
    expect(g.nodes).toEqual([]);
    expect(g.links).toEqual([]);
    expect(g.layerCount).toBe(0);
  });
});
