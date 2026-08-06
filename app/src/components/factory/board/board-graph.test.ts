import { describe, expect, it } from "vite-plus/test";
import {
  BOARD_DIM,
  autoPositions,
  buildBoardGraph,
  type BoardBlockInput,
  type BoardLinkInput,
} from "./board-graph.ts";

const block = (id: number, over: Partial<BoardBlockInput> = {}): BoardBlockInput => ({
  id,
  name: `Block ${id}`,
  iconKind: null,
  iconName: null,
  electricityW: null,
  boardX: null,
  boardY: null,
  ...over,
});

const link = (
  good: string,
  producers: { blockId: number; rate: number }[],
  consumers: { blockId: number; rate: number }[],
  over: Partial<BoardLinkInput> = {},
): BoardLinkInput => {
  const produced = producers.reduce((s, p) => s + p.rate, 0);
  const consumed = consumers.reduce((s, c) => s + c.rate, 0);
  return {
    good,
    display: good,
    kind: "item",
    producers: producers.map((p) => ({ ...p, role: "primary" })),
    consumers: consumers.map((c) => ({ ...c, role: "import" })),
    produced,
    consumed,
    net: produced - consumed,
    ...over,
  };
};

describe("buildBoardGraph edges", () => {
  it("aggregates every good between a block pair into one edge", () => {
    const g = buildBoardGraph(
      [block(1), block(2)],
      [
        link("iron-plate", [{ blockId: 1, rate: 4 }], [{ blockId: 2, rate: 4 }]),
        link("copper-plate", [{ blockId: 1, rate: 2 }], [{ blockId: 2, rate: 2 }]),
      ],
    );
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].goods.map((x) => x.good).sort()).toEqual(["copper-plate", "iron-plate"]);
  });

  it("splits a good's flow proportionally across producer/consumer pairs", () => {
    const g = buildBoardGraph(
      [block(1), block(2), block(3)],
      [
        link(
          "ash",
          [
            { blockId: 1, rate: 3 },
            { blockId: 2, rate: 1 },
          ],
          [{ blockId: 3, rate: 4 }],
        ),
      ],
    );
    const rates = new Map(g.edges.map((e) => [e.source, e.goods[0].rate]));
    expect(rates.get(1)).toBeCloseTo(3);
    expect(rates.get(2)).toBeCloseTo(1);
  });

  it("tints an edge by its worst good and puts short goods first", () => {
    const g = buildBoardGraph(
      [block(1), block(2)],
      [
        link("ok", [{ blockId: 1, rate: 2 }], [{ blockId: 2, rate: 2 }]),
        // consumed 5, produced 2 → short
        link("starved", [{ blockId: 1, rate: 2 }], [{ blockId: 2, rate: 5 }]),
      ],
    );
    expect(g.edges[0].status).toBe("short");
    expect(g.edges[0].goods[0].good).toBe("starved");
  });

  it("treats a sub-1% imbalance as balanced (rounding noise, not a red edge)", () => {
    const g = buildBoardGraph(
      [block(1), block(2)],
      // consumed 10,000.5 vs produced 10,000 — 0.005% short, i.e. noise
      [link("water", [{ blockId: 1, rate: 10_000 }], [{ blockId: 2, rate: 10_000.5 }])],
    );
    expect(g.edges[0].status).toBe("balanced");
    expect(g.nodes.find((n) => n.id === 1)!.shortOutput).toBe(false);
  });

  it("drops self-loops and edges to disabled/missing blocks", () => {
    const g = buildBoardGraph(
      [block(1)],
      [
        link("loop", [{ blockId: 1, rate: 1 }], [{ blockId: 1, rate: 1 }]),
        link("gone", [{ blockId: 1, rate: 1 }], [{ blockId: 99, rate: 1 }]),
      ],
    );
    expect(g.edges).toHaveLength(0);
  });
});

describe("auto-layout", () => {
  it("layers suppliers left of their consumers, cycle-tolerant", () => {
    const chain = [
      { source: 1, target: 2 },
      { source: 2, target: 3 },
      { source: 3, target: 1 }, // recycle loop back to the start
    ];
    const pos = autoPositions([block(1), block(2), block(3)], chain);
    expect(pos.get(1)!.x).toBeLessThan(pos.get(2)!.x);
    expect(pos.get(2)!.x).toBeLessThan(pos.get(3)!.x);
  });

  it("parks unlinked blocks in a trailing column", () => {
    const pos = autoPositions([block(1), block(2), block(9)], [{ source: 1, target: 2 }]);
    expect(pos.get(9)!.x).toBeGreaterThan(pos.get(2)!.x);
  });

  it("keeps hand-placed positions and auto-places the rest", () => {
    const g = buildBoardGraph(
      [block(1, { boardX: 500, boardY: -200 }), block(2)],
      [link("iron-plate", [{ blockId: 1, rate: 1 }], [{ blockId: 2, rate: 1 }])],
    );
    const n1 = g.nodes.find((n) => n.id === 1)!;
    const n2 = g.nodes.find((n) => n.id === 2)!;
    expect(n1).toMatchObject({ x: 500, y: -200, auto: false });
    expect(n2.auto).toBe(true);
    expect(n2.x).toBe(BOARD_DIM.pad + BOARD_DIM.nodeW + BOARD_DIM.colGap);
  });
});
