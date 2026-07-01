/**
 * Sub-blocks (#7): named, collapsible groups of recipe rows INSIDE one block.
 * Display-only — the solve is untouched; a group is a view over the flat
 * `recipes[]` order. Invariant: a group's members are CONTIGUOUS in that order
 * (joins move the row adjacent), so a group renders as one span anchored at its
 * first member. Pure module — no React, no db — unit-tested in row-groups.test.ts.
 */

export type RowGroup = { id: number; name: string };
/** recipe name → group id */
export type GroupAssign = Record<string, number>;

/** [first, last] index span of a group's members in `recipes` order, or null. */
export function groupSpan(
  recipes: string[],
  assign: GroupAssign,
  id: number,
): [number, number] | null {
  let first = -1;
  let last = -1;
  recipes.forEach((r, i) => {
    if (assign[r] === id) {
      if (first < 0) first = i;
      last = i;
    }
  });
  return first < 0 ? null : [first, last];
}

/** Members of a group, in `recipes` order. */
export const groupMembers = (recipes: string[], assign: GroupAssign, id: number): string[] =>
  recipes.filter((r) => assign[r] === id);

/** Drop assignments to unknown groups/recipes, drop empty groups, and make every
 * group's members contiguous (anchored at the group's first member). Idempotent —
 * run after hydrate so a hand-edited or drifted doc can't break rendering. */
export function normalizeGroups(
  recipes: string[],
  groups: RowGroup[],
  assign: GroupAssign,
): { recipes: string[]; groups: RowGroup[]; assign: GroupAssign } {
  const ids = new Set(groups.map((g) => g.id));
  const clean: GroupAssign = {};
  for (const [r, g] of Object.entries(assign)) if (ids.has(g) && recipes.includes(r)) clean[r] = g;
  const kept = groups.filter((g) => Object.values(clean).includes(g.id));
  // rebuild the order: walk recipes; the first member of each group pulls the
  // rest of its members in behind it
  const out: string[] = [];
  const emitted = new Set<string>();
  for (const r of recipes) {
    if (emitted.has(r)) continue;
    const g = clean[r];
    if (g == null) {
      out.push(r);
      emitted.add(r);
    } else {
      for (const m of recipes) {
        if (clean[m] === g && !emitted.has(m)) {
          out.push(m);
          emitted.add(m);
        }
      }
    }
  }
  return { recipes: out, groups: kept, assign: clean };
}

/** Join `recipe` to a group: assign it and move it to the end of the group's span
 * (or leave the list untouched if the group has no other members yet). */
export function joinGroup(
  recipes: string[],
  assign: GroupAssign,
  recipe: string,
  groupId: number,
): { recipes: string[]; assign: GroupAssign } {
  const nextAssign = { ...assign, [recipe]: groupId };
  const others = recipes.filter((r) => r !== recipe && nextAssign[r] === groupId);
  if (!others.length) return { recipes, assign: nextAssign };
  const without = recipes.filter((r) => r !== recipe);
  const at = without.indexOf(others[others.length - 1]) + 1;
  return { recipes: [...without.slice(0, at), recipe, ...without.slice(at)], assign: nextAssign };
}

/** Remove `recipe` from its group (its position in the list is unchanged). */
export function leaveGroup(assign: GroupAssign, recipe: string): GroupAssign {
  if (!(recipe in assign)) return assign;
  const next = { ...assign };
  delete next[recipe];
  return next;
}

/** After a row was arrayMove'd to index `i`, decide its group from its new
 * neighbors: strictly inside a span → adopt that group; at the edge of its own
 * old span → keep it; anywhere else → ungrouped. Deterministic and predictable. */
export function resolveGroupAfterMove(
  recipes: string[],
  assign: GroupAssign,
  recipe: string,
): GroupAssign {
  const i = recipes.indexOf(recipe);
  const prev = i > 0 ? assign[recipes[i - 1]] : undefined;
  const next = i < recipes.length - 1 ? assign[recipes[i + 1]] : undefined;
  const own = assign[recipe];
  if (prev != null && prev === next) return { ...assign, [recipe]: prev }; // inside a span
  if (own != null && (prev === own || next === own)) return assign; // still touching own group
  return leaveGroup(assign, recipe);
}

/** Move a whole group's contiguous span so it starts at `targetIdx` (an index in
 * the list WITHOUT the span). Used when the group header itself is dragged. */
export function moveGroupSpan(
  recipes: string[],
  assign: GroupAssign,
  groupId: number,
  targetIdx: number,
): string[] {
  const members = groupMembers(recipes, assign, groupId);
  if (!members.length) return recipes;
  const rest = recipes.filter((r) => assign[r] !== groupId);
  const at = Math.max(0, Math.min(targetIdx, rest.length));
  return [...rest.slice(0, at), ...members, ...rest.slice(at)];
}

export type GroupFlow = { name: string; kind: string; rate: number };
export type GroupNet = {
  inputs: GroupFlow[]; // consumed by the chain beyond what it makes itself
  outputs: GroupFlow[]; // produced beyond what it consumes itself
  machines: number; // summed building count
  powerW: number; // summed electric draw
};

const EPS = 1e-6;

/** Net flows of a group from the solved per-recipe rows: internal intermediates
 * cancel out, leaving what the chain as a whole consumes and produces — the one
 * line a collapsed sub-block shows ("ore in → plates out"). */
export function groupNet(
  rows: Array<{
    recipe: string;
    ingredients: GroupFlow[];
    products: GroupFlow[];
    machine?: { count: number; powerW: number; energySource?: string | null } | null;
  }>,
  members: Set<string>,
): GroupNet {
  const net = new Map<string, { kind: string; rate: number }>();
  let machines = 0;
  let powerW = 0;
  for (const row of rows) {
    if (!members.has(row.recipe)) continue;
    for (const c of row.products) {
      const e = net.get(c.name) ?? { kind: c.kind, rate: 0 };
      e.rate += c.rate;
      net.set(c.name, e);
    }
    for (const c of row.ingredients) {
      const e = net.get(c.name) ?? { kind: c.kind, rate: 0 };
      e.rate -= c.rate;
      net.set(c.name, e);
    }
    if (row.machine) {
      machines += row.machine.count;
      if (row.machine.energySource === "electric") powerW += row.machine.powerW;
    }
  }
  const inputs: GroupFlow[] = [];
  const outputs: GroupFlow[] = [];
  for (const [name, e] of net) {
    if (e.rate > EPS) outputs.push({ name, kind: e.kind, rate: e.rate });
    else if (e.rate < -EPS) inputs.push({ name, kind: e.kind, rate: -e.rate });
  }
  inputs.sort((a, b) => b.rate - a.rate);
  outputs.sort((a, b) => b.rate - a.rate);
  return { inputs, outputs, machines, powerW };
}
