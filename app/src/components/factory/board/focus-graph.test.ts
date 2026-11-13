import { describe, expect, it } from "vite-plus/test";
import type { BoardBlockInput, BoardLinkInput } from "./board-graph.ts";
import { buildFocusGraph, shortfallGoods } from "./focus-graph.ts";

const block = (id: number): BoardBlockInput => ({
  id,
  name: `Block ${id}`,
  iconKind: null,
  iconName: null,
  electricityW: null,
  boardX: null,
  boardY: null,
});

const link = (
  good: string,
  producers: { blockId: number; rate: number }[],
  consumers: { blockId: number; rate: number }[],
): BoardLinkInput => {
  const produced = producers.reduce((s, p) => s + p.rate, 0);
  const consumed = consumers.reduce((s, c) => s + c.rate, 0);
  return {
    good,
    display: good,
    kind: "item",
    producers: producers.map((p) => ({ ...p, role: "byproduct" })),
    consumers: consumers.map((c) => ({ ...c, role: "import" })),
    produced,
    consumed,
    net: produced - consumed,
  };
};

const blocks = Array.from({ length: 12 }, (_, i) => block(i + 1));

describe("shortfallGoods", () => {
  it("keeps short material goods worst first, skipping balanced goods and power", () => {
    const goods = shortfallGoods([
      link("stone", [{ blockId: 1, rate: 8 }], [{ blockId: 2, rate: 10 }]),
      link("iron-plate", [{ blockId: 1, rate: 5 }], [{ blockId: 2, rate: 5 }]),
      link("ash", [{ blockId: 1, rate: 1 }], [{ blockId: 2, rate: 30 }]),
      link("pyops-electricity", [{ blockId: 1, rate: 1 }], [{ blockId: 2, rate: 99 }]),
    ]);
    expect(goods.map((l) => l.good)).toEqual(["ash", "stone"]);
  });
});

describe("buildFocusGraph", () => {
  it("shortfalls: makers left, short goods center, users right; balanced goods hidden", () => {
    const g = buildFocusGraph(
      blocks,
      [
        link("stone", [{ blockId: 1, rate: 8 }], [{ blockId: 2, rate: 10 }]),
        link("iron-plate", [{ blockId: 3, rate: 5 }], [{ blockId: 4, rate: 5 }]),
      ],
      { kind: "shortfalls" },
    );
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["g:stone", "m:1", "u:2"]);
    const x = (id: string) => g.nodes.find((n) => n.id === id)!.x;
    expect(x("m:1")).toBeLessThan(x("g:stone"));
    expect(x("g:stone")).toBeLessThan(x("u:2"));
    expect(g.edges.map((e) => e.id).sort()).toEqual(["g:stone->u:2", "m:1->g:stone"]);
    expect(g.edges.every((e) => e.status === "short")).toBe(true);
  });

  const manyMakers = Array.from({ length: 10 }, (_, i) => ({ blockId: i + 1, rate: 10 - i }));
  const ash = link("ash", manyMakers, [{ blockId: 12, rate: 100 }]);

  it("shortfalls fold a good's smallest makers into one node", () => {
    const g = buildFocusGraph(blocks, [ash], { kind: "shortfalls" });
    const blockMakers = g.nodes.filter((n) => n.type === "block" && n.id.startsWith("m:"));
    expect(blockMakers.map((n) => n.id)).toEqual(["m:1", "m:2", "m:3", "m:4"]);
    const fold = g.nodes.find((n) => n.type === "fold");
    expect(fold).toMatchObject({ id: "mf:ash", side: "makers", count: 6, rate: 21 });
    expect(g.edges.find((e) => e.id === "mf:ash->g:ash")?.goods[0].rate).toBe(21);
  });

  it("focusing a good shows every maker, so a fold node always leads somewhere", () => {
    const g = buildFocusGraph(blocks, [ash], { kind: "good", good: "ash" });
    expect(g.nodes.some((n) => n.type === "fold")).toBe(false);
    expect(g.nodes.filter((n) => n.id.startsWith("m:"))).toHaveLength(10);
  });

  it("block: direct suppliers and customers only, with the board's proportional split", () => {
    const g = buildFocusGraph(
      blocks,
      [
        // block 2 takes half of block 1's iron
        link(
          "iron-plate",
          [{ blockId: 1, rate: 10 }],
          [
            { blockId: 2, rate: 5 },
            { blockId: 3, rate: 5 },
          ],
        ),
        link("gear", [{ blockId: 2, rate: 4 }], [{ blockId: 4, rate: 4 }]),
        // not touching block 2
        link("stone", [{ blockId: 5, rate: 1 }], [{ blockId: 6, rate: 1 }]),
        link("pyops-electricity", [{ blockId: 7, rate: 1 }], [{ blockId: 2, rate: 1 }]),
      ],
      { kind: "block", id: 2 },
    );
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["b:2", "m:1", "u:4"]);
    expect(g.nodes.find((n) => n.id === "b:2")).toMatchObject({ type: "block", center: true });
    expect(g.edges.find((e) => e.id === "m:1->b:2")?.goods[0]).toMatchObject({
      good: "iron-plate",
      rate: 5,
    });
  });
});
