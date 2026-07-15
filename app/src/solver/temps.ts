import type { LpBlockInput, Pin, RecipeDef } from "./lp.ts";

/**
 * Fluid-temperature identity (#110): the full model, as a PURE transformation
 * of the solver input — the LP core is untouched.
 *
 * A real fluid is expanded when an enabled recipe produces it or declares an
 * accepted temperature range. Producer-only blocks expand too so their factory
 * boundary retains exact temperature identity:
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
 *   - fluid goals move to either their selected one-temperature pool or a
 *     full-range pool when no exact temperature is selected;
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
  /** Structured boundary identity. Variants are exact; pools retain the
   * consumer's accepted range. `null` means this good was not temperature
   * expanded (items and temperature-insensitive pseudo-fluids). */
  qualifierOf: (
    good: string,
  ) =>
    | { mode: "exact"; minTemp: number; maxTemp: number }
    | { mode: "range"; minTemp: number | null; maxTemp: number | null }
    | null;
  /** Selector provenance used to turn an exported pool back into the exact
   * temperatures that physically entered it. */
  selectorOf: (recipe: string) => { fluid: string; temperature: number; pool: string } | null;
};

export function expandTemps(
  input: {
    goals: {
      name: string;
      rate: number;
      direction?: "produce" | "consume";
      temperature?: number;
    }[];
    recipes: TempRecipeDef[];
    made: string[];
    pins: Pin[];
    drains?: string[];
  },
  defaultTemp: (fluid: string) => number | null,
): { input: LpBlockInput; fold: TempFold } {
  const { recipes, goals, made, pins } = input;
  const drains = input.drains ?? [];

  // Which fluids expand: an enabled consumer declares a range OR a recipe
  // produces the fluid. Producer-only blocks still need exact identities at
  // their factory boundary; previously those blocks collapsed straight back to
  // the bare fluid and the factory solver could not distinguish temperatures.
  const ranged = new Set<string>();
  for (const r of recipes)
    for (const c of [...r.ingredients, ...r.products])
      if (
        c.kind === "fluid" &&
        !c.name.startsWith("pyops-") &&
        (c.temperature != null ||
          c.minTemp != null ||
          c.maxTemp != null ||
          (r.products.includes(c) && defaultTemp(c.name) != null))
      )
        ranged.add(c.name);
  for (const goal of goals) if (defaultTemp(goal.name) != null) ranged.add(goal.name);

  const baseGoal = <T extends (typeof goals)[number]>(goal: T) => {
    const { temperature: _temperature, ...rest } = goal;
    return rest;
  };

  if (!ranged.size) {
    return {
      input: { goals: goals.map(baseGoal), recipes: recipes as RecipeDef[], made, pins, drains },
      fold: {
        isSynthetic: () => false,
        bare: (g) => g,
        tempOf: () => null,
        qualifierOf: () => null,
        selectorOf: () => null,
      },
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

  // pools: consumer ranges, plus an exact or full-range pool for each goal
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

  const goalPools = new Map<string, string>();
  const outGoals = goals.map((g) => {
    const goal = baseGoal(g);
    if (!ranged.has(g.name)) return goal;
    const lo = g.temperature ?? -Infinity;
    const hi = g.temperature ?? Infinity;
    const pool = poolOf(g.name, lo, hi);
    goalPools.set(g.name, pool);
    return { ...goal, name: pool };
  });

  // selectors: variant → pool for every in-range pairing
  const selNames = new Set<string>();
  const selectors = new Map<string, { fluid: string; temperature: number; pool: string }>();
  for (const [pKey, p] of pools) {
    for (const t of variants.get(p.fluid) ?? []) {
      if (t < p.lo || t > p.hi) continue;
      const name = `${SEL}${pKey}${SEP}${t}`;
      selNames.add(name);
      selectors.set(name, { fluid: p.fluid, temperature: t, pool: pKey });
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
    const goalPool = goalPools.get(m) ?? null;
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
    const goalPool = goalPools.get(m) ?? null;
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
      qualifierOf: (good) => {
        const i = good.indexOf(SEP);
        if (i < 0) return null;
        const rest = good.slice(i + 1);
        if (rest.startsWith("@")) {
          const temperature = Number(rest.slice(1));
          return Number.isFinite(temperature)
            ? { mode: "exact", minTemp: temperature, maxTemp: temperature }
            : null;
        }
        const m = new RegExp(`pool${SEP}(.+?)\\.\\.(.+)$`).exec(rest);
        if (!m) return null;
        const lo = Number(m[1]);
        const hi = Number(m[2]);
        return {
          mode: "range",
          minTemp: Number.isFinite(lo) ? lo : null,
          maxTemp: Number.isFinite(hi) ? hi : null,
        };
      },
      selectorOf: (recipe) => selectors.get(recipe) ?? null,
    },
  };
}
