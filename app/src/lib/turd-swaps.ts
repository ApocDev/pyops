/** Pure helpers for the TURD board: what a recipe swap changes, and how a
 * choice's many near-identical swaps (one per creature/crop tier) collapse into
 * one readable group. Client-safe; the server computes the per-swap lines. */

export type GoodRef = { kind: string; name: string; display: string };

/** One thing a swap changes: craft time, or one ingredient/product amount
 * (`a` = old recipe, `b` = new; 0 means absent on that side). */
export type SwapLine =
  | { kind: "time"; a: number; b: number }
  | { kind: "in" | "out"; good: GoodRef; a: number; b: number };

export type RecipeSide = {
  energyRequired: number | null;
  ingredients: { kind: string; name: string; display: string | null; amount: number }[];
  /** Expected amount per craft (range midpoint × probability). */
  products: { kind: string; name: string; display: string | null; amount: number }[];
};

function sumByGood(rows: RecipeSide["ingredients"]) {
  const out = new Map<string, { good: GoodRef; amount: number }>();
  for (const r of rows) {
    const key = `${r.kind}:${r.name}`;
    const cur = out.get(key);
    if (cur) cur.amount += r.amount;
    else
      out.set(key, {
        good: { kind: r.kind, name: r.name, display: r.display ?? r.name },
        amount: r.amount,
      });
  }
  return out;
}

const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));

function goodLines(kind: "in" | "out", a: RecipeSide["ingredients"], b: RecipeSide["ingredients"]) {
  const before = sumByGood(a);
  const after = sumByGood(b);
  const lines: SwapLine[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const x = before.get(key);
    const y = after.get(key);
    const va = x?.amount ?? 0;
    const vb = y?.amount ?? 0;
    if (!same(va, vb)) lines.push({ kind, good: (y ?? x)!.good, a: va, b: vb });
  }
  return lines;
}

/** Everything that differs between an old recipe and its TURD replacement. */
export function swapLines(from: RecipeSide, to: RecipeSide): SwapLine[] {
  const lines: SwapLine[] = [];
  const ta = from.energyRequired ?? 0;
  const tb = to.energyRequired ?? 0;
  if (!same(ta, tb)) lines.push({ kind: "time", a: ta, b: tb });
  return [
    ...lines,
    ...goodLines("in", from.ingredients, to.ingredients),
    ...goodLines("out", from.products, to.products),
  ];
}

/** A swap line merged across a group: each side as a [min, max] range, plus the
 * relative change range when both sides are present. */
export type MergedLine = {
  kind: SwapLine["kind"];
  good: GoodRef | null;
  a: [number, number];
  b: [number, number];
  ratio: [number, number] | null;
};

export type SwapGroup<C> = { label: string; changes: C[]; lines: MergedLine[] };

/** A recipe display with its "MK 02"-style tier suffix dropped, so the tiers of
 * one building collapse into one group. */
export const swapLabel = (display: string) => display.replace(/\s+MK\s*\d+$/i, "");

// goods match by tier-less display, so tier N's "+1 Bioreactor MK 0N" lines merge
const lineKey = (l: SwapLine) =>
  `${l.kind}:${l.kind === "time" ? "" : `${l.good.kind}/${swapLabel(l.good.display)}`}`;
// direction of a line, so "adds X" and "removes X" never merge into one range
const lineShape = (l: SwapLine) =>
  `${lineKey(l)}:${l.a === 0 ? "add" : l.b === 0 ? "drop" : l.b > l.a ? "up" : "down"}`;

const widen = (r: [number, number] | null, v: number): [number, number] =>
  r ? [Math.min(r[0], v), Math.max(r[1], v)] : [v, v];

/** Collapse a choice's swaps: same tier-less label AND the same set of changes
 * (by tier-less good and direction) form one group, with amounts merged into
 * ranges. A group of one keeps its full recipe name. */
export function groupSwaps<C extends { fromDisplay: string | null; lines: SwapLine[] }>(
  changes: C[],
): SwapGroup<C>[] {
  const groups = new Map<string, { label: string; changes: C[]; byKey: Map<string, MergedLine> }>();
  for (const c of changes) {
    const label = swapLabel(c.fromDisplay ?? "");
    const shape = c.lines.map(lineShape).sort().join("|");
    const key = `${label}\u0000${shape}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { label, changes: [], byKey: new Map() }));
    g.changes.push(c);
    for (const l of c.lines) {
      // by direction too: one swap can drop "Bioreactor MK 01" and add "MK 02",
      // which share a tier-less key but must stay two lines
      const k = lineShape(l);
      const m = g.byKey.get(k);
      const ratio = l.a !== 0 && l.b !== 0 ? l.b / l.a : null;
      if (!m) {
        g.byKey.set(k, {
          kind: l.kind,
          good: l.kind === "time" ? null : l.good,
          a: [l.a, l.a],
          b: [l.b, l.b],
          ratio: ratio == null ? null : [ratio, ratio],
        });
      } else {
        if (l.kind !== "time" && m.good && m.good.name !== l.good.name)
          m.good = { ...m.good, display: swapLabel(m.good.display) };
        m.a = widen(m.a, l.a);
        m.b = widen(m.b, l.b);
        if (ratio != null) m.ratio = widen(m.ratio, ratio);
      }
    }
  }
  return [...groups.values()].map((g) => ({
    label: g.changes.length > 1 ? g.label : (g.changes[0]!.fromDisplay ?? g.label),
    changes: g.changes,
    lines: [...g.byKey.values()],
  }));
}

/** Whether a merged line is an improvement for the player: faster crafts, fewer
 * inputs, more outputs. */
export const lineIsGood = (l: MergedLine) => (l.kind === "out" ? l.b[1] > l.a[1] : l.b[1] < l.a[1]);
