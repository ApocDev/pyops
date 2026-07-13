import type { LpBlockInput, Pin, RecipeDef } from "./lp.ts";

/**
 * Fluid-temperature identity (#110): the full model, as a PURE transformation
 * of the solver input — the LP core is untouched.
 *
 * A fluid is expanded when some enabled consumer in the block declares an
 * accepted temperature range (otherwise nothing about temperature can matter
 * and the fluid stays a single bare good):
 *   - each producer's output becomes a VARIANT good `F⟨T⟩` (explicit product
 *     temperature, else the fluid's prototype default)
 *   - each distinct consumer range becomes a POOL good; zero-cost SELECTOR
 *     pseudo-recipes convert every in-range variant into the pool, so a range
 *     consumer draws from any mix of acceptable temperatures — range POOLING,
 *     not YAFC's hard per-temperature split
 *   - a `made` mark on the fluid expands to every variant and pool, so "made
 *     here" keeps meaning "my consumption is covered in-block" — now PER
 *     TEMPERATURE: a pool with no in-range producer surfaces as unmade
 *     ("nothing makes F at 4000°"), which is the honest version of the old
 *     interim warning
 *   - goals move to a full-range pool (any temperature satisfies a rate goal);
 *     share pins follow their consumer onto its pool.
 *
 * `fold` maps the solve's synthetic goods/recipes back for display: selector
 * rows vanish, variant/pool flows collapse onto the bare fluid name with a
 * temperature label.
 */

export type TempComponent = {
  kind: string;
  name: string;
  amount: number;
  probability?: number | null;
  temperature?: number | null;
  minTemp?: number | null;
  maxTemp?: number | null;
};
export type TempRecipeDef = {
  name: string;
  energyRequired: number;
  ingredients: TempComponent[];
  products: TempComponent[];
};

const SEP = "\u0001"; // internal-only separator; never rendered
const SEL = `${SEP}sel${SEP}`;

const variantKey = (fluid: string, temp: number) => `${fluid}${SEP}@${temp}`;
const poolKey = (fluid: string, lo: number, hi: number) => `${fluid}${SEP}pool${SEP}${lo}..${hi}`;

export type TempFold = {
  /** selector pseudo-recipes — drop from rows/rates */
  isSynthetic: (recipe: string) => boolean;
  /** synthetic good → the bare fluid name (identity for normal goods) */
  bare: (good: string) => string;
  /** synthetic good → its temperature qualifier for display ("125°", "4000–5000°"), null for normal goods */
  tempOf: (good: string) => string | null;
};

export function expandTemps(
  input: {
    goals: { name: string; rate: number; direction?: "produce" | "consume" }[];
    recipes: TempRecipeDef[];
    made: string[];
    pins: Pin[];
    drains?: string[];
  },
  defaultTemp: (fluid: string) => number | null,
): { input: LpBlockInput; fold: TempFold } {
  const { recipes, goals, made, pins } = input;
  const drains = input.drains ?? [];

  // which fluids expand: an enabled consumer declares a range
  const ranged = new Set<string>();
  for (const r of recipes)
    for (const c of r.ingredients)
      if (c.kind === "fluid" && (c.minTemp != null || c.maxTemp != null)) ranged.add(c.name);
  const goalRates = new Map(goals.map((g) => [g.name, g.rate]));

  if (!ranged.size) {
    return {
      input: { goals, recipes: recipes as RecipeDef[], made, pins, drains },
      fold: { isSynthetic: () => false, bare: (g) => g, tempOf: () => null },
    };
  }

  const prodTemp = (c: TempComponent) => c.temperature ?? defaultTemp(c.name) ?? 15;
  // variants each expanded fluid is actually produced at (in-block)
  const variants = new Map<string, Set<number>>();
  for (const r of recipes)
    for (const c of r.products)
      if (c.kind === "fluid" && ranged.has(c.name)) {
        const set = variants.get(c.name) ?? new Set<number>();
        set.add(prodTemp(c));
        variants.set(c.name, set);
      }

  // pools: consumer ranges, plus a full-range pool for goals on expanded fluids
  const pools = new Map<string, { fluid: string; lo: number; hi: number }>();
  const poolOf = (fluid: string, lo: number, hi: number) => {
    const key = poolKey(fluid, lo, hi);
    pools.set(key, { fluid, lo, hi });
    return key;
  };

  const outDefs: TempRecipeDef[] = recipes.map((r) => ({
    ...r,
    products: r.products.map((c) =>
      c.kind === "fluid" && ranged.has(c.name)
        ? { ...c, name: variantKey(c.name, prodTemp(c)) }
        : c,
    ),
    ingredients: r.ingredients.map((c) => {
      if (c.kind !== "fluid" || !ranged.has(c.name)) return c;
      const lo = c.minTemp ?? -Infinity;
      const hi = c.maxTemp ?? Infinity;
      return { ...c, name: poolOf(c.name, lo, hi) };
    }),
  }));

  const outGoals = goals.map((g) =>
    ranged.has(g.name) ? { ...g, name: poolOf(g.name, -Infinity, Infinity) } : g,
  );

  // selectors: variant → pool for every in-range pairing
  const selNames = new Set<string>();
  for (const [pKey, p] of pools) {
    for (const t of variants.get(p.fluid) ?? []) {
      if (t < p.lo || t > p.hi) continue;
      const name = `${SEL}${pKey}${SEP}${t}`;
      selNames.add(name);
      outDefs.push({
        name,
        energyRequired: 0, // ε-cost in the LP keeps it deterministic
        ingredients: [{ kind: "fluid", name: variantKey(p.fluid, t), amount: 1 }],
        products: [{ kind: "fluid", name: pKey, amount: 1 }],
      });
    }
  }

  // made(F) → every variant + every pool of F (goal-pools are covered by the
  // goal constraint itself). Non-expanded marks pass through.
  const outMade: string[] = [];
  for (const m of made) {
    if (!ranged.has(m)) {
      outMade.push(m);
      continue;
    }
    for (const t of variants.get(m) ?? []) outMade.push(variantKey(m, t));
    // every consumer pool needs coverage; the goal constraint subsumes only
    // the goal's own full-range pool
    const goalPool = goalRates.has(m) ? poolKey(m, -Infinity, Infinity) : null;
    for (const [pKey, p] of pools) if (p.fluid === m && pKey !== goalPool) outMade.push(pKey);
  }
  // a goal on an expanded fluid is a pool constraint; its variants still need
  // net ≥ 0 so the goal can't be met by importing variants
  for (const g of goals)
    if (ranged.has(g.name) && g.direction !== "consume" && g.rate >= 0)
      for (const t of variants.get(g.name) ?? []) outMade.push(variantKey(g.name, t));

  // a drained fluid's surplus must vanish per-variant AND per-pool
  const outDrains: string[] = [];
  for (const m of drains) {
    if (!ranged.has(m)) {
      outDrains.push(m);
      continue;
    }
    for (const t of variants.get(m) ?? []) outDrains.push(variantKey(m, t));
    const goalPool = goalRates.has(m) ? poolKey(m, -Infinity, Infinity) : null;
    for (const [pKey, p] of pools) if (p.fluid === m && pKey !== goalPool) outDrains.push(pKey);
  }

  // share pins on an expanded fluid: the consumer now eats its POOL good, but
  // the share's production base must stay the REAL in-range variants — the
  // pool's own producers are demand-driven selectors, which would let the
  // share collapse to 0 = 0.
  const outPins = pins.map((p) => {
    if (p.kind !== "share" || !ranged.has(p.item)) return p;
    const consumer = outDefs.find((d) => d.name === p.recipe);
    const pool = consumer?.ingredients.find(
      (c) => pools.has(c.name) && c.name.startsWith(p.item + SEP),
    );
    if (!pool) return p;
    const range = pools.get(pool.name)!;
    const ofItems = [...(variants.get(p.item) ?? [])]
      .filter((t) => t >= range.lo && t <= range.hi)
      .map((t) => variantKey(p.item, t));
    return { ...p, item: pool.name, ofItems };
  });

  const fmtT = (t: number) => (Number.isFinite(t) ? `${t}` : t > 0 ? "∞" : "-∞");
  return {
    input: {
      goals: outGoals,
      recipes: outDefs as RecipeDef[],
      made: [...new Set(outMade)],
      pins: outPins,
      drains: [...new Set(outDrains)],
    },
    fold: {
      isSynthetic: (recipe) => selNames.has(recipe) || recipe.startsWith(SEL),
      bare: (good) => (good.includes(SEP) ? good.slice(0, good.indexOf(SEP)) : good),
      tempOf: (good) => {
        const i = good.indexOf(SEP);
        if (i < 0) return null;
        const rest = good.slice(i + 1);
        if (rest.startsWith("@")) return `${rest.slice(1)}°`;
        // the second separator sits between pool and the range
        const m = new RegExp(`pool${SEP}(.+?)\\.\\.(.+)$`).exec(rest);
        if (!m) return null;
        const [lo, hi] = [Number(m[1]), Number(m[2])];
        if (!Number.isFinite(lo) && !Number.isFinite(hi)) return null; // any temp
        if (!Number.isFinite(lo)) return `≤${fmtT(hi)}°`;
        if (!Number.isFinite(hi)) return `≥${fmtT(lo)}°`;
        return lo === hi ? `${fmtT(lo)}°` : `${fmtT(lo)}–${fmtT(hi)}°`;
      },
    },
  };
}
