/**
 * Pure derivation of a block's material-flow graph from a solve result (#101):
 * recipe rows become nodes, imports/exports/goal-outputs become boundary nodes,
 * and item flows become weighted links (producer → consumer). This module is
 * intentionally React-free and deterministic so it can be unit-tested in
 * isolation — the SVG renderer (`FlowDiagram.tsx`) turns `layer`/`order`/`rate`
 * into pixels and paths.
 *
 * Py blocks routinely cycle (recycle loops are the norm), so the layering here
 * does NOT assume a DAG: a DFS breaks cycles by dropping back-edges, the
 * remaining forward edges get a longest-path layer, and the offending links are
 * flagged `back` so the renderer can draw them as recycle loops.
 */

const EPS = 1e-6;

/** A solved recipe row (a structural subset of `computeBlock`'s `rows[]`). */
export type FlowInputRow = {
  recipe: string;
  display: string;
  rate: number;
  machine?: { count: number } | null;
  ingredients: { name: string; kind: string; rate: number }[];
  products: { name: string; kind: string; rate: number }[];
};

/** The slice of a solve result the flow graph needs. */
export type FlowInput = {
  rows: FlowInputRow[];
  imports: { name: string; kind: string; rate: number }[];
  exports: { name: string; kind: string; rate: number }[];
  /** the block's goal goods (their leftover output becomes a sink node) */
  goalNames: string[];
  /** localized good display names (internal name → display) */
  display?: Record<string, string>;
};

export type FlowNodeKind = "recipe" | "import" | "export" | "output";
export type GoodKind = "item" | "fluid";

export type FlowNode = {
  id: string;
  kind: FlowNodeKind;
  /** recipe internal name (recipe nodes) or good internal name (boundary nodes) */
  ref: string;
  display: string;
  /** the good's kind, for boundary nodes' icon (item/fluid) */
  goodKind?: GoodKind;
  /** ceil'd building count, for recipe nodes */
  machineCount?: number;
  layer: number;
  /** position within the layer (0 = top), after crossing-reduction */
  order: number;
  /** max(total in, total out) — the flow through the node, for scaling */
  throughput: number;
};

export type FlowLink = {
  id: string;
  source: string; // node id
  target: string; // node id
  good: string; // internal good name
  goodKind: GoodKind;
  display: string; // localized good name
  rate: number; // items or fluid /s
  /** true when this link runs backwards (a recycle loop / cycle edge) */
  back: boolean;
};

export type FlowGraph = {
  nodes: FlowNode[];
  links: FlowLink[];
  layerCount: number;
};

const recipeId = (r: string) => `r:${r}`;
const importId = (g: string) => `i:${g}`;
const exportId = (g: string) => `e:${g}`;
const outputId = (g: string) => `o:${g}`;

type Endpoint = { node: string; rate: number };

/**
 * Build the flow graph. Producers of a good are the recipe rows that make it
 * plus (if any) its import boundary; consumers are the rows that use it plus its
 * export boundary plus, for a goal good, the leftover that leaves the block.
 * Because that leftover is derived as produced − consumed, producers and
 * consumers of every good balance, and links split proportionally without
 * leaking or double-counting flow.
 */
export function buildFlowGraph(input: FlowInput): FlowGraph {
  const disp = input.display ?? {};
  const nameOf = (g: string) => disp[g] ?? g;

  // Only rows that actually run contribute flows; an idle producer (pinned to 0,
  // or a backward recipe) would otherwise render as a dead node with no links.
  const rows = input.rows.filter((r) => r.rate > EPS);

  const producers = new Map<string, Endpoint[]>();
  const consumers = new Map<string, Endpoint[]>();
  const goodKind = new Map<string, GoodKind>();
  const push = (m: Map<string, Endpoint[]>, good: string, node: string, rate: number) => {
    const list = m.get(good) ?? [];
    list.push({ node, rate });
    m.set(good, list);
  };
  const noteKind = (good: string, kind: string) => {
    if (!goodKind.has(good)) goodKind.set(good, kind === "fluid" ? "fluid" : "item");
  };

  for (const r of rows) {
    for (const p of r.products) {
      if (p.rate <= EPS) continue;
      noteKind(p.name, p.kind);
      push(producers, p.name, recipeId(r.recipe), p.rate);
    }
    for (const c of r.ingredients) {
      if (c.rate <= EPS) continue;
      noteKind(c.name, c.kind);
      push(consumers, c.name, recipeId(r.recipe), c.rate);
    }
  }
  for (const f of input.imports) {
    if (f.rate <= EPS) continue;
    noteKind(f.name, f.kind);
    push(producers, f.name, importId(f.name), f.rate);
  }
  for (const f of input.exports) {
    if (f.rate <= EPS) continue;
    noteKind(f.name, f.kind);
    push(consumers, f.name, exportId(f.name), f.rate);
  }
  // A goal good's leftover (produced − consumed, incl. imports/exports) is what
  // leaves the block as the target output — a sink node so the producing recipe
  // isn't left with unbalanced output. Non-goal goods always balance internally.
  const sum = (list: Endpoint[] | undefined) => (list ?? []).reduce((a, e) => a + e.rate, 0);
  for (const g of new Set(input.goalNames)) {
    const residual = sum(producers.get(g)) - sum(consumers.get(g));
    if (residual > EPS) push(consumers, g, outputId(g), residual);
  }

  // ── nodes ────────────────────────────────────────────────────────────────
  const nodes = new Map<string, FlowNode>();
  const ensureBoundary = (id: string, kind: FlowNodeKind, good: string) => {
    if (nodes.has(id)) return;
    nodes.set(id, {
      id,
      kind,
      ref: good,
      display: nameOf(good),
      goodKind: goodKind.get(good) ?? "item",
      layer: 0,
      order: 0,
      throughput: 0,
    });
  };
  for (const r of rows)
    nodes.set(recipeId(r.recipe), {
      id: recipeId(r.recipe),
      kind: "recipe",
      ref: r.recipe,
      display: r.display,
      machineCount: r.machine ? Math.ceil(r.machine.count - 1e-9) : undefined,
      layer: 0,
      order: 0,
      throughput: 0,
    });
  for (const [good, list] of producers)
    for (const e of list) if (e.node.startsWith("i:")) ensureBoundary(e.node, "import", good);
  for (const [good, list] of consumers)
    for (const e of list) {
      if (e.node.startsWith("e:")) ensureBoundary(e.node, "export", good);
      else if (e.node.startsWith("o:")) ensureBoundary(e.node, "output", good);
    }

  // ── links (proportional bipartite split per good) ──────────────────────────
  const links: FlowLink[] = [];
  const inFlow = new Map<string, number>();
  const outFlow = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string, v: number) => m.set(id, (m.get(id) ?? 0) + v);
  for (const [good, prod] of producers) {
    const cons = consumers.get(good);
    if (!cons?.length) continue;
    const total = sum(prod);
    if (total <= EPS) continue;
    const kind = goodKind.get(good) ?? "item";
    for (const p of prod) {
      for (const c of cons) {
        if (p.node === c.node) continue; // a recipe that both makes and uses a good
        const rate = (p.rate * c.rate) / total;
        if (rate <= EPS) continue;
        links.push({
          id: `${p.node}->${c.node}:${good}`,
          source: p.node,
          target: c.node,
          good,
          goodKind: kind,
          display: nameOf(good),
          rate,
          back: false, // set during layering
        });
        bump(outFlow, p.node, rate);
        bump(inFlow, c.node, rate);
      }
    }
  }
  for (const n of nodes.values())
    n.throughput = Math.max(inFlow.get(n.id) ?? 0, outFlow.get(n.id) ?? 0);

  // ── layering (cycle-tolerant) ──────────────────────────────────────────────
  const nodeIds = [...nodes.keys()];
  const adj = new Map<string, Set<string>>(nodeIds.map((id) => [id, new Set<string>()]));
  for (const l of links) if (l.source !== l.target) adj.get(l.source)!.add(l.target);

  // Break cycles: a DFS starting from import sources orients edges forward; any
  // edge to a node still on the recursion stack is a back-edge and is excluded
  // from layering (but kept in the graph, flagged `back`, so recycle loops show).
  const backEdges = new Set<string>();
  const state = new Map<string, 0 | 1 | 2>(nodeIds.map((id) => [id, 0]));
  const startOrder = [...nodeIds].sort((a, b) => rank(a, nodes) - rank(b, nodes));
  const dfs = (u: string) => {
    state.set(u, 1);
    for (const v of adj.get(u)!) {
      if (state.get(v) === 1) backEdges.add(`${u}->${v}`);
      else if (state.get(v) === 0) dfs(v);
    }
    state.set(u, 2);
  };
  for (const id of startOrder) if (state.get(id) === 0) dfs(id);

  // Longest-path layering over the forward (non-back) edges.
  const fwd = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  const indeg = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  for (const [u, vs] of adj)
    for (const v of vs)
      if (!backEdges.has(`${u}->${v}`)) {
        fwd.get(u)!.push(v);
        indeg.set(v, (indeg.get(v) ?? 0) + 1);
      }
  const layer = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const queue = nodeIds.filter((id) => (indeg.get(id) ?? 0) === 0);
  while (queue.length) {
    const u = queue.shift()!;
    for (const v of fwd.get(u)!) {
      layer.set(v, Math.max(layer.get(v) ?? 0, (layer.get(u) ?? 0) + 1));
      indeg.set(v, (indeg.get(v) ?? 0) - 1);
      if ((indeg.get(v) ?? 0) === 0) queue.push(v);
    }
  }
  // Right-align the boundary outputs: exports and goal sinks sit one column past
  // the furthest recipe/import, so everything leaving the block lines up.
  let nonOutMax = 0;
  for (const n of nodes.values())
    if (n.kind !== "export" && n.kind !== "output")
      nonOutMax = Math.max(nonOutMax, layer.get(n.id) ?? 0);
  for (const n of nodes.values()) {
    if (n.kind === "export" || n.kind === "output") layer.set(n.id, nonOutMax + 1);
    n.layer = layer.get(n.id) ?? 0;
  }
  for (const l of links) l.back = (layer.get(l.source) ?? 0) >= (layer.get(l.target) ?? 0);

  const layerCount = nodeIds.length ? Math.max(...nodeIds.map((id) => layer.get(id) ?? 0)) + 1 : 0;

  // ── within-layer ordering (barycenter, to reduce crossings) ────────────────
  const byLayer: string[][] = Array.from({ length: layerCount }, () => []);
  for (const n of nodes.values()) byLayer[n.layer].push(n.id);
  for (const col of byLayer)
    col.sort((a, b) => rank(a, nodes) - rank(b, nodes) || (a < b ? -1 : 1));
  const pos = new Map<string, number>();
  const reindex = () => {
    for (const col of byLayer) col.forEach((id, i) => pos.set(id, i));
  };
  reindex();
  const neighbors = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const l of links) {
    if (l.source === l.target) continue;
    neighbors.get(l.source)!.push(l.target);
    neighbors.get(l.target)!.push(l.source);
  }
  for (let sweep = 0; sweep < 4; sweep++) {
    for (const col of byLayer) {
      const bary = new Map<string, number>();
      for (const id of col) {
        const ns = neighbors.get(id)!;
        bary.set(
          id,
          ns.length
            ? ns.reduce((a, n) => a + (pos.get(n) ?? 0), 0) / ns.length
            : (pos.get(id) ?? 0),
        );
      }
      col.sort((a, b) => bary.get(a)! - bary.get(b)! || (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
    }
    reindex();
  }
  for (const n of nodes.values()) n.order = pos.get(n.id) ?? 0;

  return { nodes: [...nodes.values()], links, layerCount };
}

/** Stable seed order within a layer: imports first, then recipes, then export /
 * output sinks; alphabetical within a kind. Keeps the barycenter sweeps and the
 * cycle-breaking DFS deterministic. */
function rank(id: string, nodes: Map<string, FlowNode>): number {
  const k = nodes.get(id)?.kind;
  return k === "import" ? 0 : k === "recipe" ? 1 : k === "export" ? 2 : 3;
}
