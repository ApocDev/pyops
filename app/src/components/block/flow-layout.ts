/**
 * Pure pixel layout for the block flow diagram (#101): turns the abstract
 * `FlowGraph` (layers + within-layer order) into placed nodes and link paths in
 * an SVG coordinate space. React-free so the geometry can be reasoned about and
 * tested independently of the renderer.
 *
 * Columns map to layers left→right; nodes stack within a column in `order`.
 * Links attach to distributed ports along a node's vertical edge — forward links
 * leave the right edge and enter the left; a `back` link (a recycle loop) leaves
 * the left edge and re-enters the target's right edge, arcing back through the gap.
 */
import type { FlowGraph, FlowLink, FlowNode } from "./flow-graph.ts";

export const DIM = {
  nodeW: 180,
  recipeH: 48,
  boundaryH: 40,
  colGap: 96,
  vGap: 16,
  pad: 20,
  minStroke: 1.5,
  maxStroke: 13,
} as const;

export type PlacedNode = FlowNode & { x: number; y: number; w: number; h: number };
export type PlacedLink = FlowLink & {
  width: number;
  path: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
};
export type FlowLayout = {
  nodes: PlacedNode[];
  links: PlacedLink[];
  width: number;
  height: number;
};

const nodeH = (n: FlowNode) => (n.kind === "recipe" ? DIM.recipeH : DIM.boundaryH);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function layoutFlow(graph: FlowGraph): FlowLayout {
  const { nodes, links, layerCount } = graph;
  if (!nodes.length) return { nodes: [], links: [], width: 0, height: 0 };

  // Group nodes by column and order them top-to-bottom.
  const cols: FlowNode[][] = Array.from({ length: layerCount }, () => []);
  for (const n of nodes) cols[n.layer].push(n);
  for (const col of cols) col.sort((a, b) => a.order - b.order);

  const colHeight = (col: FlowNode[]) =>
    col.reduce((h, n) => h + nodeH(n), 0) + Math.max(0, col.length - 1) * DIM.vGap;
  const tallest = Math.max(0, ...cols.map(colHeight));

  const placed = new Map<string, PlacedNode>();
  cols.forEach((col, layer) => {
    const x = DIM.pad + layer * (DIM.nodeW + DIM.colGap);
    let y = DIM.pad + (tallest - colHeight(col)) / 2; // vertically center each column
    for (const n of col) {
      const h = nodeH(n);
      placed.set(n.id, { ...n, x, y, w: DIM.nodeW, h });
      y += h + DIM.vGap;
    }
  });

  // Distribute link ports along each node's edges. Each node has four port lists:
  // forward-out (right edge), forward-in (left edge), back-out (left edge),
  // back-in (right edge). Ports are ordered by the other endpoint's center so the
  // links fan out without needless crossings.
  type Ports = { fOut: FlowLink[]; fIn: FlowLink[]; bOut: FlowLink[]; bIn: FlowLink[] };
  const ports = new Map<string, Ports>();
  for (const n of nodes) ports.set(n.id, { fOut: [], fIn: [], bOut: [], bIn: [] });
  for (const l of links) {
    const p = (id: string) => ports.get(id)!;
    if (l.back) {
      p(l.source).bOut.push(l);
      p(l.target).bIn.push(l);
    } else {
      p(l.source).fOut.push(l);
      p(l.target).fIn.push(l);
    }
  }
  const centerY = (id: string) => {
    const n = placed.get(id)!;
    return n.y + n.h / 2;
  };
  const portY = (node: PlacedNode, index: number, count: number) =>
    node.y + (node.h * (index + 1)) / (count + 1);

  const maxRate = Math.max(1e-9, ...links.map((l) => l.rate));
  const strokeFor = (rate: number) =>
    clamp((rate / maxRate) * DIM.maxStroke, DIM.minStroke, DIM.maxStroke);

  // Assign a y to every (link, endpoint) once port lists are ordered.
  const sourceY = new Map<string, number>();
  const targetY = new Map<string, number>();
  for (const [id, ps] of ports) {
    const node = placed.get(id)!;
    const order = (arr: FlowLink[], other: (l: FlowLink) => string) =>
      arr.sort((a, b) => centerY(other(a)) - centerY(other(b)));
    order(ps.fOut, (l) => l.target).forEach((l, i) =>
      sourceY.set(l.id, portY(node, i, ps.fOut.length)),
    );
    order(ps.fIn, (l) => l.source).forEach((l, i) =>
      targetY.set(l.id, portY(node, i, ps.fIn.length)),
    );
    order(ps.bOut, (l) => l.target).forEach((l, i) =>
      sourceY.set(l.id, portY(node, i, ps.bOut.length)),
    );
    order(ps.bIn, (l) => l.source).forEach((l, i) =>
      targetY.set(l.id, portY(node, i, ps.bIn.length)),
    );
  }

  const placedLinks: PlacedLink[] = links.map((l) => {
    const s = placed.get(l.source)!;
    const t = placed.get(l.target)!;
    const sy = sourceY.get(l.id) ?? centerY(l.source);
    const ty = targetY.get(l.id) ?? centerY(l.target);
    let sx: number, tx: number, path: string;
    if (l.back) {
      // recycle loop: exit the source's left, arc back to the target's right
      sx = s.x;
      tx = t.x + t.w;
      const dx = Math.max(52, Math.abs(sx - tx) * 0.6);
      path = `M ${sx} ${sy} C ${sx - dx} ${sy} ${tx + dx} ${ty} ${tx} ${ty}`;
    } else {
      sx = s.x + s.w;
      tx = t.x;
      const mx = sx + (tx - sx) * 0.5;
      path = `M ${sx} ${sy} C ${mx} ${sy} ${mx} ${ty} ${tx} ${ty}`;
    }
    return { ...l, width: strokeFor(l.rate), path, sx, sy, tx, ty };
  });

  const width = DIM.pad * 2 + layerCount * DIM.nodeW + Math.max(0, layerCount - 1) * DIM.colGap;
  const height = DIM.pad * 2 + tallest;
  return { nodes: [...placed.values()], links: placedLinks, width, height };
}
