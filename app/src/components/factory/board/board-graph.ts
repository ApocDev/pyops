/**
 * Pure derivation of the factory board (Connections → Board): enabled blocks
 * become nodes, and every good one block makes for another becomes part of an
 * aggregated block→block edge. React-free and deterministic, mirroring the
 * block flow view's `flow-graph.ts`: per-good proportional bipartite split,
 * cycle-tolerant longest-path layering, and barycenter ordering — but over
 * blocks instead of recipe rows.
 *
 * Auto-layout only supplies positions for blocks the user has never dragged
 * (`boardX`/`boardY` null); hand-placed blocks keep their stored spot.
 */

import { meaningfulImbalance } from "../../../lib/factory-flow.ts";

const EPS = 1e-6;

/** Energy pseudo-goods (electricity/heat/fluid-fuel) are consumed by nearly
 * every block — drawing the power grid as edges buries the material flows and
 * a factory-wide power shortfall would tint the whole board red. Each node
 * already shows its power draw; the Overview/List views carry the balance. */
const ENERGY_PSEUDO = new Set(["pyops-electricity", "pyops-heat", "pyops-fluid-fuel"]);

export type BoardBlockInput = {
  id: number;
  name: string;
  iconKind: string | null;
  iconName: string | null;
  electricityW: number | null;
  boardX: number | null;
  boardY: number | null;
};

type End = { blockId: number; rate: number; role: string };

export type BoardLinkInput = {
  good: string;
  display: string | null;
  kind: string;
  producers: End[];
  consumers: End[];
  produced: number;
  consumed: number;
  net: number;
};

export type EdgeStatus = "short" | "surplus" | "balanced";

export type BoardEdgeGood = {
  good: string;
  display: string;
  kind: "item" | "fluid";
  /** this pair's attributed share of the good's flow, per second */
  rate: number;
  /** the GOOD's factory-wide balance — a short good tints every edge it rides */
  status: EdgeStatus;
  net: number;
};

export type BoardEdge = {
  id: string;
  source: number;
  target: number;
  goods: BoardEdgeGood[];
  /** worst status across goods: short > surplus > balanced */
  status: EdgeStatus;
  /** stroke width in px, log-normalized across the board */
  width: number;
};

export type BoardNode = {
  id: number;
  name: string;
  iconKind: string | null;
  iconName: string | null;
  electricityW: number | null;
  /** this block is a primary/stock producer of a good that runs short factory-
   * wide (incl. energy) — the block to scale up, flagged on the node itself */
  shortOutput: boolean;
  /** true when the position came from auto-layout, not a user drag */
  auto: boolean;
  x: number;
  y: number;
};

export type BoardGraph = { nodes: BoardNode[]; edges: BoardEdge[] };

/** Node box + grid dimensions (kept with the graph so layout math and the
 * rendered node component agree). */
export const BOARD_DIM = {
  nodeW: 216,
  nodeH: 60,
  colGap: 100,
  vGap: 28,
  pad: 40,
  minStroke: 1.5,
  maxStroke: 6.5,
} as const;

const statusRank: Record<EdgeStatus, number> = { balanced: 0, surplus: 1, short: 2 };

/** Status under the shared relative floor — a sub-1% residual on a bulk flow
 * is rounding noise, not a red edge (see meaningfulImbalance). */
const linkStatus = (l: BoardLinkInput): EdgeStatus =>
  !meaningfulImbalance(l.net, l.produced, l.consumed)
    ? "balanced"
    : l.net < 0
      ? "short"
      : "surplus";

export function buildBoardGraph(blocksIn: BoardBlockInput[], links: BoardLinkInput[]): BoardGraph {
  const blockIds = new Set(blocksIn.map((b) => b.id));

  // ── aggregate block→block edges (proportional split per good) ─────────────
  const pairs = new Map<
    string,
    { source: number; target: number; goods: Map<string, BoardEdgeGood> }
  >();
  for (const l of links) {
    if (ENERGY_PSEUDO.has(l.good)) continue;
    const producedTotal = l.producers.reduce((s, p) => s + p.rate, 0);
    if (producedTotal <= EPS) continue;
    const status = linkStatus(l);
    const kind = l.kind === "fluid" ? "fluid" : "item";
    for (const p of l.producers) {
      if (!blockIds.has(p.blockId)) continue;
      for (const c of l.consumers) {
        if (!blockIds.has(c.blockId) || p.blockId === c.blockId) continue;
        const rate = (p.rate * c.rate) / producedTotal;
        if (rate <= EPS) continue;
        const key = `${p.blockId}->${c.blockId}`;
        const pair =
          pairs.get(key) ??
          (() => {
            const created = {
              source: p.blockId,
              target: c.blockId,
              goods: new Map<string, BoardEdgeGood>(),
            };
            pairs.set(key, created);
            return created;
          })();
        const g = pair.goods.get(l.good);
        if (g) g.rate += rate;
        else
          pair.goods.set(l.good, {
            good: l.good,
            display: l.display ?? l.good,
            kind,
            rate,
            status,
            net: l.net,
          });
      }
    }
  }

  // Log-normalize widths: fluids flow at 100× item rates, so a linear scale
  // would flatten every item belt to the minimum.
  const weight = (goods: BoardEdgeGood[]) => goods.reduce((s, g) => s + Math.log1p(g.rate), 0);
  const maxWeight = Math.max(
    1e-9,
    ...[...pairs.values()].map((p) => weight([...p.goods.values()])),
  );
  // Calm edges first, short edges last — SVG paints in order, so the red
  // problem edges always sit on top of the balanced web.
  const edges: BoardEdge[] = [...pairs.entries()].map(([id, p]) => {
    const goods = [...p.goods.values()].sort(
      (a, b) => statusRank[b.status] - statusRank[a.status] || b.rate - a.rate,
    );
    return {
      id,
      source: p.source,
      target: p.target,
      goods,
      status: goods.reduce<EdgeStatus>(
        (worst, g) => (statusRank[g.status] > statusRank[worst] ? g.status : worst),
        "balanced",
      ),
      width:
        BOARD_DIM.minStroke +
        (BOARD_DIM.maxStroke - BOARD_DIM.minStroke) * (weight(goods) / maxWeight),
    };
  });
  edges.sort((a, b) => statusRank[a.status] - statusRank[b.status]);

  // The blocks to scale up: primary/stock producers of any short good. Energy
  // pseudo-goods count here even though they draw no edges — a starved power
  // block should still glow.
  const shortProducers = new Set(
    links
      .filter((l) => linkStatus(l) === "short")
      .flatMap((l) =>
        l.producers.filter((p) => p.role === "primary" || p.role === "stock").map((p) => p.blockId),
      ),
  );

  // ── auto-layout (cycle-tolerant longest-path layering + barycenter) ────────
  const auto = autoPositions(blocksIn, edges);
  const nodes: BoardNode[] = blocksIn.map((b) => {
    const placed = b.boardX != null && b.boardY != null;
    const a = auto.get(b.id)!;
    return {
      id: b.id,
      name: b.name,
      iconKind: b.iconKind,
      iconName: b.iconName,
      electricityW: b.electricityW,
      shortOutput: shortProducers.has(b.id),
      auto: !placed,
      x: placed ? b.boardX! : a.x,
      y: placed ? b.boardY! : a.y,
    };
  });

  return { nodes, edges };
}

/** Compute an auto position for every block (callers use it for the unplaced
 * ones, and "auto-arrange" applies it to all). Supplier blocks sit left of the
 * blocks they feed; blocks with no links park in a trailing column. */
export function autoPositions(
  blocksIn: BoardBlockInput[],
  edges: { source: number; target: number }[],
): Map<number, { x: number; y: number }> {
  const ids = blocksIn.map((b) => b.id);
  const idSet = new Set(ids);
  const linked = new Set<number>();
  const adj = new Map<number, Set<number>>(ids.map((id) => [id, new Set<number>()]));
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target) || e.source === e.target) continue;
    adj.get(e.source)!.add(e.target);
    linked.add(e.source);
    linked.add(e.target);
  }

  // Cycle-break with a DFS (recycle chains are the norm in Py), then
  // longest-path layer over the remaining forward edges.
  const backEdges = new Set<string>();
  const state = new Map<number, 0 | 1 | 2>(ids.map((id) => [id, 0]));
  const dfs = (u: number) => {
    state.set(u, 1);
    for (const v of adj.get(u)!) {
      if (state.get(v) === 1) backEdges.add(`${u}->${v}`);
      else if (state.get(v) === 0) dfs(v);
    }
    state.set(u, 2);
  };
  for (const id of ids) if (state.get(id) === 0) dfs(id);

  const fwd = new Map<number, number[]>(ids.map((id) => [id, []]));
  const indeg = new Map<number, number>(ids.map((id) => [id, 0]));
  for (const [u, vs] of adj)
    for (const v of vs)
      if (!backEdges.has(`${u}->${v}`)) {
        fwd.get(u)!.push(v);
        indeg.set(v, (indeg.get(v) ?? 0) + 1);
      }
  const layer = new Map<number, number>(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  while (queue.length) {
    const u = queue.shift()!;
    for (const v of fwd.get(u)!) {
      layer.set(v, Math.max(layer.get(v) ?? 0, (layer.get(u) ?? 0) + 1));
      indeg.set(v, (indeg.get(v) ?? 0) - 1);
      if ((indeg.get(v) ?? 0) === 0) queue.push(v);
    }
  }

  // Unlinked blocks go to their own trailing column instead of crowding col 0.
  const linkedIds = ids.filter((id) => linked.has(id));
  const isolatedIds = ids.filter((id) => !linked.has(id));
  const maxLayer = linkedIds.length ? Math.max(...linkedIds.map((id) => layer.get(id) ?? 0)) : -1;
  for (const id of isolatedIds) layer.set(id, maxLayer + 1);

  // Columns + a few barycenter sweeps to reduce crossings.
  const layerCount = ids.length ? Math.max(...ids.map((id) => layer.get(id) ?? 0)) + 1 : 0;
  const byLayer: number[][] = Array.from({ length: layerCount }, () => []);
  for (const id of ids) byLayer[layer.get(id) ?? 0].push(id);
  for (const col of byLayer) col.sort((a, b) => a - b);
  const pos = new Map<number, number>();
  const reindex = () => {
    for (const col of byLayer) col.forEach((id, i) => pos.set(id, i));
  };
  reindex();
  const neighbors = new Map<number, number[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target) || e.source === e.target) continue;
    neighbors.get(e.source)!.push(e.target);
    neighbors.get(e.target)!.push(e.source);
  }
  for (let sweep = 0; sweep < 4; sweep++) {
    for (const col of byLayer) {
      const bary = new Map<number, number>();
      for (const id of col) {
        const ns = neighbors.get(id)!;
        bary.set(
          id,
          ns.length
            ? ns.reduce((a, n) => a + (pos.get(n) ?? 0), 0) / ns.length
            : (pos.get(id) ?? 0),
        );
      }
      col.sort((a, b) => bary.get(a)! - bary.get(b)! || a - b);
    }
    reindex();
  }

  // ── y-coordinate assignment ────────────────────────────────────────────────
  // Without this every column stacks from its own top and the whole board
  // collapses into one horizontal band whose edges converge unreadably. Relax
  // each node toward the average y of its neighbors (keeping the crossing-
  // reduced order and a minimum separation), so supply chains straighten into
  // horizontal lanes you can actually follow.
  const minSep = BOARD_DIM.nodeH + BOARD_DIM.vGap;
  const y = new Map<number, number>();
  for (const col of byLayer) {
    const colH = col.length * minSep - BOARD_DIM.vGap;
    col.forEach((id, i) => y.set(id, i * minSep - colH / 2));
  }
  for (let sweep = 0; sweep < 12; sweep++) {
    const order = sweep % 2 ? [...byLayer].reverse() : byLayer;
    for (const col of order) {
      if (col.length === 0) continue;
      const desired = col.map((id) => {
        const ns = neighbors.get(id)!;
        return ns.length ? ns.reduce((a, n) => a + y.get(n)!, 0) / ns.length : y.get(id)!;
      });
      // follow the desired ys while keeping column order and separation: clamp
      // top-down, then shift the column back by the average deviation so a
      // long clamped run doesn't drift ever downward.
      const yy = [...desired];
      for (let i = 1; i < yy.length; i++) yy[i] = Math.max(yy[i], yy[i - 1] + minSep);
      const drift = yy.reduce((s, v, i) => s + (v - desired[i]), 0) / yy.length;
      col.forEach((id, i) => y.set(id, yy[i] - drift));
    }
  }

  // Open the lanes up: relaxation packs rows at the minimum separation, which
  // reads as one dense band at fit zoom. Scaling y preserves order and
  // alignment while giving edges room to be told apart.
  const SPREAD = 1.7;
  const out = new Map<number, { x: number; y: number }>();
  byLayer.forEach((col, l) => {
    for (const id of col) {
      out.set(id, {
        x: BOARD_DIM.pad + l * (BOARD_DIM.nodeW + BOARD_DIM.colGap),
        y: y.get(id)! * SPREAD,
      });
    }
  });
  return out;
}
