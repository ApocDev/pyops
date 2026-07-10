/**
 * Dependency explorer (#100): the transitive requires / required-by graph for a
 * good or recipe.
 *
 * The graph alternates two node types with the AND/OR distinction kept:
 *   requires:    good → its producing recipes (ANY one suffices),
 *                recipe → its ingredients (ALL required)
 *   requiredBy:  good → the recipes that consume it (each an independent
 *                dependent), recipe → the goods it makes
 *
 * `depsTree` walks breadth-first from a root to a depth limit (measured in
 * edges) under a node budget and returns a FLAT map keyed `g:<name>` /
 * `r:<name>` — cycle-safe: every node appears once, children reference keys.
 * Each node carries its DIRECT child count plus the size of its full
 * transitive closure in the same direction ("requires 12 goods via 4
 * recipes"), computed over the whole graph, not the depth-limited slice.
 *
 * Hidden recipes, excluded (EE/user-glob) recipes, and barrel fill/empty
 * plumbing are not part of the graph — same policy as the assistant's
 * recipeGraph tool and the cost analysis.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/index.server.ts";
import { fluids, items, recipeIngredients, recipeProducts, recipes } from "../db/schema.ts";
import {
  createExclusionMatcher,
  recipeAvailabilities,
  searchAll,
  type RecipeAvail,
} from "../db/queries.server.ts";

const BARREL_CATEGORIES = new Set(["py-barreling", "py-unbarreling", "barreling", "barrelling"]);

export type DepsDir = "requires" | "requiredBy";
export type DepsRootKind = "good" | "recipe";

/** Transitive closure size, excluding the node itself. */
export type DepsClosure = { goods: number; recipes: number };

export type DepsNode = {
  key: string;
  type: DepsRootKind;
  /** item vs fluid — for icon resolution (good nodes only) */
  goodKind?: "item" | "fluid";
  name: string;
  display: string | null;
  /** child keys included in this payload (within the depth limit + budget) */
  children: string[];
  /** direct child count in the FULL graph — children may be a truncated subset */
  childCount: number;
  /** childCount > children.length: expand by re-rooting on this node */
  truncated: boolean;
  closure: DepsClosure;
  /** recipe nodes: availability vs the research horizon + TURD selections */
  avail?: Pick<RecipeAvail, "research" | "needs" | "turd">;
  /** recipe nodes: display names of the unlocking techs (empty = start-enabled) */
  unlockedBy?: string[];
};

export type DepsTree = {
  root: string;
  dir: DepsDir;
  nodes: Record<string, DepsNode>;
  budgetHit: boolean;
};

const DEFAULT_BUDGET = 500;
export const MAX_DEPTH = 12; // edges — the UI exposes tiers (1 tier = 2 edges)

/* ── In-memory graph (interned ids: goods [0..G), recipes [G..G+R)) ─────────── */

type Graph = {
  goodCount: number;
  nodeCount: number;
  goodId: Map<string, number>;
  recipeId: Map<string, number>;
  goodName: string[];
  goodKind: ("item" | "fluid")[];
  goodDisplay: (string | null)[];
  recipeName: string[];
  recipeDisplay: (string | null)[];
  recipeEnabled: boolean[];
  /** adjacency by direction: forward[dir][nodeId] = child node ids */
  children: Record<DepsDir, number[][]>;
};

/** Bulk-load the dependency graph for the current project db. Rebuilt per
 * request — ~50k rows, a few tens of ms — so it can never go stale across
 * project switches, data syncs, or exclusion edits. */
function loadGraph(): Graph {
  const isExcluded = createExclusionMatcher();
  const keptRecipes = db
    .select({
      name: recipes.name,
      display: recipes.display,
      enabled: recipes.enabled,
      category: recipes.category,
      subgroup: recipes.subgroup,
    })
    .from(recipes)
    .where(eq(recipes.hidden, false))
    .all()
    .filter(
      (r) =>
        !BARREL_CATEGORIES.has(r.category ?? "") && !isExcluded(r.name, r.category, r.subgroup),
    );

  const itemDisplay = new Map(
    db
      .select({ name: items.name, display: items.display })
      .from(items)
      .all()
      .map((r) => [r.name, r.display] as const),
  );
  const fluidDisplay = new Map(
    db
      .select({ name: fluids.name, display: fluids.display })
      .from(fluids)
      .all()
      .map((r) => [r.name, r.display] as const),
  );

  const recipeId = new Map<string, number>();
  const recipeName: string[] = [];
  const recipeDisplay: (string | null)[] = [];
  const recipeEnabled: boolean[] = [];
  for (const r of keptRecipes) {
    recipeId.set(r.name, recipeId.size);
    recipeName.push(r.name);
    recipeDisplay.push(r.display);
    recipeEnabled.push(r.enabled);
  }

  const goodId = new Map<string, number>();
  const goodName: string[] = [];
  const goodKind: ("item" | "fluid")[] = [];
  const goodDisplay: (string | null)[] = [];
  const internGood = (name: string, kind: string): number => {
    let id = goodId.get(name);
    if (id === undefined) {
      id = goodId.size;
      goodId.set(name, id);
      goodName.push(name);
      goodKind.push(kind === "fluid" ? "fluid" : "item");
      goodDisplay.push(
        kind === "fluid"
          ? (fluidDisplay.get(name) ?? null)
          : (itemDisplay.get(name) ?? fluidDisplay.get(name) ?? null),
      );
    }
    return id;
  };

  // pass 1: intern every good that appears in a kept recipe
  const ingRows = db
    .select({
      recipe: recipeIngredients.recipe,
      name: recipeIngredients.name,
      kind: recipeIngredients.kind,
    })
    .from(recipeIngredients)
    .all()
    .filter((r) => recipeId.has(r.recipe));
  const prodRows = db
    .select({ recipe: recipeProducts.recipe, name: recipeProducts.name, kind: recipeProducts.kind })
    .from(recipeProducts)
    .all()
    .filter((r) => recipeId.has(r.recipe));
  for (const r of [...ingRows, ...prodRows]) internGood(r.name, r.kind);

  const goodCount = goodId.size;
  const nodeCount = goodCount + recipeId.size;
  const empty = (): number[][] => Array.from({ length: nodeCount }, () => []);
  const requires = empty();
  const requiredBy = empty();

  // dedupe (recipe, good) pairs — a recipe can list the same good twice
  const seen = new Set<number>();
  const link = (adj: number[][], from: number, to: number) => {
    const k = from * nodeCount + to;
    if (seen.has(k)) return;
    seen.add(k);
    adj[from].push(to);
  };
  for (const r of ingRows) {
    const rid = goodCount + recipeId.get(r.recipe)!;
    const gid = goodId.get(r.name)!;
    link(requires, rid, gid); // recipe requires ALL its ingredients
    link(requiredBy, gid, rid); // a good is required by its consumers
  }
  seen.clear();
  for (const r of prodRows) {
    const rid = goodCount + recipeId.get(r.recipe)!;
    const gid = goodId.get(r.name)!;
    link(requires, gid, rid); // a good requires ANY of its producers
    link(requiredBy, rid, gid); // a recipe's products depend on it
  }

  return {
    goodCount,
    nodeCount,
    goodId,
    recipeId,
    goodName,
    goodKind,
    goodDisplay,
    recipeName,
    recipeDisplay,
    recipeEnabled,
    children: { requires, requiredBy },
  };
}

/** Compute every requested node's full closure together.
 *
 * A separate BFS per payload node revisited the same large downstream graph up
 * to 500 times. Collapse cycles into SCCs, propagate a compact bitset of which
 * requested roots reach each component once over the resulting DAG, then add
 * each component's goods/recipes to those roots. The result is identical to
 * per-node BFS (including cycles and shared descendants) without repeated
 * full-graph walks. All state is scoped to this request. */
function closureCountsFor(g: Graph, adj: number[][], starts: number[]): Map<number, DepsClosure> {
  if (!starts.length) return new Map();

  const reverse = Array.from({ length: g.nodeCount }, () => [] as number[]);
  for (let from = 0; from < adj.length; from++) {
    for (const to of adj[from]) reverse[to].push(from);
  }

  // Iterative DFS keeps Py's large cyclic graphs off the JavaScript call stack.
  const seen = new Uint8Array(g.nodeCount);
  const finish: number[] = [];
  for (let root = 0; root < g.nodeCount; root++) {
    if (seen[root]) continue;
    seen[root] = 1;
    const nodes = [root];
    const nextEdge = [0];
    while (nodes.length) {
      const top = nodes.length - 1;
      const node = nodes[top];
      const edge = nextEdge[top];
      if (edge < adj[node].length) {
        nextEdge[top] = edge + 1;
        const next = adj[node][edge];
        if (!seen[next]) {
          seen[next] = 1;
          nodes.push(next);
          nextEdge.push(0);
        }
      } else {
        finish.push(node);
        nodes.pop();
        nextEdge.pop();
      }
    }
  }

  const component = new Int32Array(g.nodeCount);
  component.fill(-1);
  const componentGoods: number[] = [];
  const componentRecipes: number[] = [];
  for (let oi = finish.length - 1; oi >= 0; oi--) {
    const root = finish[oi];
    if (component[root] !== -1) continue;
    const cid = componentGoods.length;
    let goods = 0;
    let recipesN = 0;
    component[root] = cid;
    const stack = [root];
    while (stack.length) {
      const node = stack.pop()!;
      if (node < g.goodCount) goods++;
      else recipesN++;
      for (const prev of reverse[node]) {
        if (component[prev] !== -1) continue;
        component[prev] = cid;
        stack.push(prev);
      }
    }
    componentGoods.push(goods);
    componentRecipes.push(recipesN);
  }

  const componentCount = componentGoods.length;
  const dagSets = Array.from({ length: componentCount }, () => new Set<number>());
  const indegree = new Int32Array(componentCount);
  for (let from = 0; from < adj.length; from++) {
    const fromC = component[from];
    for (const to of adj[from]) {
      const toC = component[to];
      if (fromC === toC || dagSets[fromC].has(toC)) continue;
      dagSets[fromC].add(toC);
      indegree[toC]++;
    }
  }

  const wordCount = Math.ceil(starts.length / 32);
  const reaches = new Uint32Array(componentCount * wordCount);
  for (let i = 0; i < starts.length; i++) {
    const offset = component[starts[i]] * wordCount + (i >>> 5);
    reaches[offset] |= 1 << (i & 31);
  }

  const topo: number[] = [];
  for (let c = 0; c < componentCount; c++) if (indegree[c] === 0) topo.push(c);
  for (let qi = 0; qi < topo.length; qi++) {
    const from = topo[qi];
    const fromOffset = from * wordCount;
    for (const to of dagSets[from]) {
      const toOffset = to * wordCount;
      for (let w = 0; w < wordCount; w++) reaches[toOffset + w] |= reaches[fromOffset + w];
      if (--indegree[to] === 0) topo.push(to);
    }
  }

  const goods = new Int32Array(starts.length);
  const recipesN = new Int32Array(starts.length);
  for (let c = 0; c < componentCount; c++) {
    const offset = c * wordCount;
    for (let w = 0; w < wordCount; w++) {
      let bits = reaches[offset + w] >>> 0;
      while (bits) {
        const lowBit = (bits & -bits) >>> 0;
        const bit = 31 - Math.clz32(lowBit);
        const index = (w << 5) + bit;
        if (index < starts.length) {
          goods[index] += componentGoods[c];
          recipesN[index] += componentRecipes[c];
        }
        bits = (bits & (bits - 1)) >>> 0;
      }
    }
  }

  return new Map(
    starts.map((start, i) => [
      start,
      {
        goods: goods[i] - (start < g.goodCount ? 1 : 0),
        recipes: recipesN[i] - (start < g.goodCount ? 0 : 1),
      },
    ]),
  );
}

const keyOf = (g: Graph, id: number) =>
  id < g.goodCount ? `g:${g.goodName[id]}` : `r:${g.recipeName[id - g.goodCount]}`;

/** Depth- and budget-limited dependency tree from one root. Returns null when
 * the root doesn't exist in the dataset. */
export function depsTree(input: {
  kind: DepsRootKind;
  name: string;
  dir: DepsDir;
  /** depth in EDGES from the root (clamped to MAX_DEPTH) */
  depth: number;
  budget?: number;
}): DepsTree | null {
  const g = loadGraph();
  const depth = Math.max(1, Math.min(MAX_DEPTH, Math.floor(input.depth)));
  const budget = Math.max(2, input.budget ?? DEFAULT_BUDGET);

  let rootId: number | undefined;
  if (input.kind === "recipe") {
    const rid = g.recipeId.get(input.name);
    if (rid === undefined) return null;
    rootId = g.goodCount + rid;
  } else {
    rootId = g.goodId.get(input.name);
    if (rootId === undefined) {
      // a good no kept recipe touches — still a valid root if it exists at all
      const item = db
        .select({ display: items.display })
        .from(items)
        .where(eq(items.name, input.name))
        .get();
      const fluid = item
        ? null
        : db
            .select({ display: fluids.display })
            .from(fluids)
            .where(eq(fluids.name, input.name))
            .get();
      if (!item && !fluid) return null;
      const key = `g:${input.name}`;
      return {
        root: key,
        dir: input.dir,
        budgetHit: false,
        nodes: {
          [key]: {
            key,
            type: "good",
            goodKind: fluid ? "fluid" : "item",
            name: input.name,
            display: item?.display ?? fluid?.display ?? null,
            children: [],
            childCount: 0,
            truncated: false,
            closure: { goods: 0, recipes: 0 },
          },
        },
      };
    }
  }

  const adj = g.children[input.dir];
  type Walk = { children: number[]; childCount: number; truncated: boolean };
  const walked = new Map<number, Walk>();
  walked.set(rootId, { children: [], childCount: 0, truncated: false });
  const queue: { id: number; d: number }[] = [{ id: rootId, d: 0 }];
  for (let qi = 0; qi < queue.length; qi++) {
    const { id, d } = queue[qi];
    const rec = walked.get(id)!;
    const kids = adj[id];
    rec.childCount = kids.length;
    for (const k of kids) {
      if (walked.has(k)) {
        rec.children.push(k); // already in the payload (shared node / cycle)
        continue;
      }
      if (d >= depth || walked.size >= budget) {
        rec.truncated = true;
        continue;
      }
      walked.set(k, { children: [], childCount: 0, truncated: false });
      rec.children.push(k);
      queue.push({ id: k, d: d + 1 });
    }
  }

  const walkedIds = [...walked.keys()];
  const closures = closureCountsFor(g, adj, walkedIds);
  const recipeIds = walkedIds.filter((id) => id >= g.goodCount);
  const enabledByName = new Map(
    recipeIds.map((id) => {
      const ri = id - g.goodCount;
      return [g.recipeName[ri], g.recipeEnabled[ri]] as const;
    }),
  );
  const availability = recipeAvailabilities(
    [...enabledByName].map(([name, enabled]) => ({ name, enabled })),
  );
  const nodes: Record<string, DepsNode> = {};
  for (const [id, w] of walked) {
    const key = keyOf(g, id);
    const closure = closures.get(id)!;
    if (id < g.goodCount) {
      nodes[key] = {
        key,
        type: "good",
        goodKind: g.goodKind[id],
        name: g.goodName[id],
        display: g.goodDisplay[id],
        children: w.children.map((c) => keyOf(g, c)),
        childCount: w.childCount,
        truncated: w.truncated,
        closure,
      };
    } else {
      const ri = id - g.goodCount;
      const name = g.recipeName[ri];
      const { avail, unlockedBy } = availability.get(name)!;
      nodes[key] = {
        key,
        type: "recipe",
        name,
        display: g.recipeDisplay[ri],
        children: w.children.map((c) => keyOf(g, c)),
        childCount: w.childCount,
        truncated: w.truncated,
        closure,
        avail: { research: avail.research, needs: avail.needs, turd: avail.turd },
        unlockedBy,
      };
    }
  }

  return {
    root: keyOf(g, rootId),
    dir: input.dir,
    nodes,
    budgetHit: walked.size >= budget,
  };
}

/** Root picker search: goods (items + fluids, via the browser's searchAll) plus
 * recipes, ranked exact/prefix-first the same way. */
export function depsSearch(
  query: string,
  limit = 60,
): { kind: "item" | "fluid" | "recipe"; name: string; display: string | null }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const isExcluded = createExclusionMatcher();
  const goods = searchAll(query, limit, isExcluded).map((row) => ({
    kind: row.kind as "item" | "fluid",
    name: row.name,
    display: row.display,
  }));
  const nq = q.replace(/[-_\s]+/g, " ");
  const rank = (r: { name: string; display: string | null }) => {
    const n = r.name.toLowerCase();
    const d = (r.display ?? "").toLowerCase();
    if (n === q || d === q) return 0;
    if (n.startsWith(q) || d.startsWith(q)) return 1;
    return 2;
  };
  const recipeRows = db
    .select({
      name: recipes.name,
      display: recipes.display,
      category: recipes.category,
      subgroup: recipes.subgroup,
    })
    .from(recipes)
    .where(eq(recipes.hidden, false))
    .all()
    .filter(
      (r) =>
        (r.name
          .replace(/[-_\s]+/g, " ")
          .toLowerCase()
          .includes(nq) ||
          (r.display ?? "").toLowerCase().includes(q)) &&
        !BARREL_CATEGORIES.has(r.category ?? "") &&
        !isExcluded(r.name, r.category, r.subgroup),
    )
    .map((r) => ({ kind: "recipe" as const, name: r.name, display: r.display }));
  return [...goods, ...recipeRows]
    .sort((a, b) => rank(a) - rank(b) || (a.display ?? a.name).localeCompare(b.display ?? b.name))
    .slice(0, limit);
}
