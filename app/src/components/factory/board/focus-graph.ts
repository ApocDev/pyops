/**
 * Pure derivation of the focused board views (Connections → Board): the
 * shortfall triage view, one good with its makers and users, or one block with
 * its direct suppliers and customers. Each is three columns (left → center →
 * right) instead of the whole-factory map, so nodes render at full size.
 *
 * In the shortfall and block views, many small flows of one good fold into a
 * single "N more" node per good: byproducts like Ash come from dozens of
 * blocks, and one edge per trickle buries the flows that matter. Focusing that
 * good is how you see them all, so the single-good view never folds.
 */

import {
  BOARD_DIM,
  ENERGY_PSEUDO,
  addFlow,
  finishEdges,
  linkStatus,
  type BoardBlockInput,
  type BoardEdge,
  type BoardLinkInput,
  type EdgePairs,
  type EdgeStatus,
} from "./board-graph.ts";

const EPS = 1e-6;
/** Blocks shown per good on each side before the rest fold into one node. */
const FOLD_KEEP = 4;

export type FocusTarget =
  | { kind: "shortfalls" }
  | { kind: "good"; good: string }
  | { kind: "block"; id: number };

/** Placement, set by layout: column 0 = makers/suppliers, 1 = center, 2 = users. */
type At = { x: number; y: number; col: 0 | 1 | 2 };
const UNPLACED: At = { x: 0, y: 0, col: 1 };

export type FocusNode =
  | ({
      type: "block";
      id: string;
      blockId: number;
      name: string;
      iconKind: string | null;
      iconName: string | null;
      electricityW: number | null;
      /** the block the view is centered on */
      center: boolean;
    } & At)
  | ({
      type: "good";
      id: string;
      good: string;
      display: string;
      kind: "item" | "fluid";
      produced: number;
      consumed: number;
      net: number;
      status: EdgeStatus;
    } & At)
  | ({
      type: "fold";
      id: string;
      good: string;
      display: string;
      kind: "item" | "fluid";
      side: "makers" | "users";
      count: number;
      rate: number;
    } & At);

export type FocusGraph = { nodes: FocusNode[]; edges: BoardEdge<string>[] };

/** Material goods that run short factory-wide, worst first. Energy pseudo-goods
 * stay out: the board draws no power edges (see ENERGY_PSEUDO). */
export function shortfallGoods(links: BoardLinkInput[]): BoardLinkInput[] {
  return links
    .filter((l) => !ENERGY_PSEUDO.has(l.good) && linkStatus(l) === "short")
    .sort((a, b) => a.net - b.net);
}

export function buildFocusGraph(
  blocksIn: BoardBlockInput[],
  links: BoardLinkInput[],
  target: FocusTarget,
): FocusGraph {
  const blocks = new Map(blocksIn.map((b) => [b.id, b]));
  const material = links.filter((l) => !ENERGY_PSEUDO.has(l.good));
  if (target.kind === "block") return blockView(blocks, material, target.id);
  return target.kind === "good"
    ? goodsView(
        blocks,
        material.filter((l) => l.good === target.good),
        false,
      )
    : goodsView(blocks, shortfallGoods(material), true);
}

type Contrib = { blockId: number; rate: number };

/** One entry per block with its rows summed. Coherence keys links by good
 * name alone, so a block can appear several times on one side, e.g. a fluid
 * at two temperatures. */
export function byBlock(ends: readonly Contrib[]): Contrib[] {
  const sums = new Map<number, number>();
  for (const e of ends) sums.set(e.blockId, (sums.get(e.blockId) ?? 0) + e.rate);
  return [...sums].map(([blockId, rate]) => ({ blockId, rate }));
}

/** Split one good's contributing blocks into the ones drawn individually (top
 * FOLD_KEEP by rate) and the folded rest. A lone extra block isn't worth a
 * "1 more" node, so folding starts at FOLD_KEEP + 2. */
function splitFold(contribs: Contrib[]): { kept: Contrib[]; folded: Contrib[] } {
  const sorted = [...contribs].sort((a, b) => b.rate - a.rate || a.blockId - b.blockId);
  if (sorted.length <= FOLD_KEEP + 1) return { kept: sorted, folded: [] };
  return { kept: sorted.slice(0, FOLD_KEEP), folded: sorted.slice(FOLD_KEEP) };
}

/** Builder for the three columns and the edges between them. Nodes are added
 * once per id, in order. With `fold` off, every contributor is its own node. */
function builder(blocks: Map<number, BoardBlockInput>, fold: boolean) {
  const cols: [FocusNode[], FocusNode[], FocusNode[]] = [[], [], []];
  const seen = new Set<string>();
  const pairs: EdgePairs<string> = new Map();
  const add = (col: 0 | 1 | 2, node: FocusNode) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    cols[col].push(node);
  };
  /** Draw one side of center node `centerId` for link `l`: the top contributors
   * as block nodes, the rest as one fold node (when folding). */
  const placeSide = (
    l: BoardLinkInput,
    side: "makers" | "users",
    contribs: Contrib[],
    centerId: string,
  ) => {
    const drawn = byBlock(contribs).filter((c) => blocks.has(c.blockId) && c.rate > EPS);
    const { kept, folded } = fold ? splitFold(drawn) : { kept: drawn, folded: [] };
    const prefix = side === "makers" ? "m" : "u";
    const wire = (id: string, rate: number) =>
      side === "makers"
        ? addFlow(pairs, id, centerId, l, rate)
        : addFlow(pairs, centerId, id, l, rate);
    for (const c of kept) {
      const id = `${prefix}:${c.blockId}`;
      add(side === "makers" ? 0 : 2, blockNode(blocks.get(c.blockId)!, id));
      wire(id, c.rate);
    }
    if (folded.length > 0) {
      const fold = foldNode(l, side, folded);
      add(side === "makers" ? 0 : 2, fold);
      wire(fold.id, fold.rate);
    }
  };
  return { add, placeSide, finish: () => layout(cols, finishEdges(pairs)) };
}

const blockNode = (b: BoardBlockInput, id: string, center = false): FocusNode => ({
  type: "block",
  id,
  blockId: b.id,
  name: b.name,
  iconKind: b.iconKind,
  iconName: b.iconName,
  electricityW: b.electricityW,
  center,
  ...UNPLACED,
});

type FoldNode = Extract<FocusNode, { type: "fold" }>;

const foldNode = (l: BoardLinkInput, side: "makers" | "users", folded: Contrib[]): FoldNode => ({
  type: "fold",
  id: `${side === "makers" ? "mf" : "uf"}:${l.good}`,
  good: l.good,
  display: l.display ?? l.good,
  kind: l.kind === "fluid" ? "fluid" : "item",
  side,
  count: folded.length,
  rate: folded.reduce((s, c) => s + c.rate, 0),
  ...UNPLACED,
});

/** Makers on the left, the goods in the middle, users on the right. */
function goodsView(
  blocks: Map<number, BoardBlockInput>,
  goods: BoardLinkInput[],
  fold: boolean,
): FocusGraph {
  const g = builder(blocks, fold);
  for (const l of goods) {
    const gid = `g:${l.good}`;
    g.add(1, {
      type: "good",
      id: gid,
      good: l.good,
      display: l.display ?? l.good,
      kind: l.kind === "fluid" ? "fluid" : "item",
      produced: l.produced,
      consumed: l.consumed,
      net: l.net,
      status: linkStatus(l),
      ...UNPLACED,
    });
    g.placeSide(l, "makers", l.producers, gid);
    g.placeSide(l, "users", l.consumers, gid);
  }
  return g.finish();
}

/** The block's suppliers on the left, the block in the middle, its customers on
 * the right. Each pair's share of a good uses the same proportional split as
 * the full board, so the rates match what an edge there shows. */
function blockView(
  blocks: Map<number, BoardBlockInput>,
  links: BoardLinkInput[],
  centerId: number,
): FocusGraph {
  const center = blocks.get(centerId);
  if (!center) return { nodes: [], edges: [] };
  const g = builder(blocks, true);
  const cid = `b:${centerId}`;
  g.add(1, blockNode(center, cid, true));
  const others = (ends: Contrib[]) => ends.filter((e) => e.blockId !== centerId);
  for (const l of links) {
    const producedTotal = l.producers.reduce((s, p) => s + p.rate, 0);
    if (producedTotal <= EPS) continue;
    const share = (p: Contrib, c: Contrib) => (p.rate * c.rate) / producedTotal;
    const asConsumer = byBlock(l.consumers).find((c) => c.blockId === centerId);
    const asProducer = byBlock(l.producers).find((p) => p.blockId === centerId);
    if (asConsumer)
      g.placeSide(
        l,
        "makers",
        others(l.producers).map((p) => ({ blockId: p.blockId, rate: share(p, asConsumer) })),
        cid,
      );
    if (asProducer)
      g.placeSide(
        l,
        "users",
        others(l.consumers).map((c) => ({ blockId: c.blockId, rate: share(asProducer, c) })),
        cid,
      );
  }
  return g.finish();
}

/** Good nodes are wider than block nodes: they carry made / used and the gap. */
export const GOOD_NODE_W = 280;
/** Column gap is wider than the full board's so the fan of edges between
 * columns stays readable; rows pack tighter since nothing is dragged here. */
const COL_GAP = 160;
const ROW_GAP = 12;
const COL_X = [0, BOARD_DIM.nodeW + COL_GAP, BOARD_DIM.nodeW + GOOD_NODE_W + 2 * COL_GAP];
/** Full width of a three-column focus graph at 1:1 zoom. */
export const FOCUS_GRAPH_W = COL_X[2] + BOARD_DIM.nodeW;

/** Stack each column centered on y = 0. The center column keeps its given
 * order; side nodes sort by the average row of the center nodes they touch,
 * so edges run roughly straight and cross less. */
function layout(cols: FocusNode[][], edges: BoardEdge<string>[]): FocusGraph {
  const step = BOARD_DIM.nodeH + ROW_GAP;
  const centerRow = new Map(cols[1].map((n, i) => [n.id, i]));
  const bary = new Map<string, number>();
  for (const side of [cols[0], cols[2]]) {
    for (const n of side) {
      const rows = edges
        .filter((e) => e.source === n.id || e.target === n.id)
        .map((e) => centerRow.get(e.source === n.id ? e.target : e.source) ?? 0);
      bary.set(n.id, rows.length ? rows.reduce((s, r) => s + r, 0) / rows.length : 0);
    }
    // folds sit below the blocks of the same rows: stable sort keeps insertion order on ties
    side.sort((a, b) => bary.get(a.id)! - bary.get(b.id)!);
  }
  const nodes = cols.flatMap((col, c) => {
    const top = -((col.length - 1) * step) / 2;
    return col.map((n, i) => ({ ...n, x: COL_X[c], y: top + i * step, col: c as At["col"] }));
  });
  return { nodes, edges };
}
