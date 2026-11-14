import { NORMAL_QUALITY, qualityKey, splitQualityKey } from "../lib/quality.ts";
import type { Pin } from "./lp.ts";
import type { TempComponent, TempRecipeDef } from "./temps.ts";

/**
 * Quality (#266) as a PURE transformation of the solver input, in the style of
 * `temps.ts`. The LP core gains only pins over several columns (`members`)
 * for it: a count or capacity pin bounds the sum of a row's columns, a share
 * pin's consumer can be that sum, and a "remaining" share base subtracts a
 * multi-column pin's intake as a term over the column rates when the columns
 * eat different amounts.
 *
 * A block row carries a quality range: one recipe row that runs at every
 * quality from `min` to `max`, with one machine and module setup. This
 * transform gives each level its own LP column (`recipe` at normal,
 * `recipe@rare` above it) so the LP picks each level's rate:
 *   - a column at quality q eats its item ingredients at exactly q
 *     (YAFC-CE `ProductionTableContent.cs:510`). A consumer at q needs exactly
 *     q, so unlike temperatures there are no pools or selectors;
 *   - its item products split over q and the levels above it by the row's
 *     total quality effect (`qualitySplit`). Fluids never carry quality;
 *   - goods are linked per (good, quality): `iron-plate` and
 *     `iron-plate@rare` are separate LP goods (YAFC-CE
 *     `ProductionTable.cs:486,513`);
 *   - goals, made marks and drains already name a (good, quality) key, and a
 *     count or capacity pin on a row bounds the sum of its columns. A share
 *     pin names a quality column, except on a fluid (or fixed-quality fuel),
 *     where it splits the row's summed intake. A share pin at a quality its
 *     row doesn't run at is reported in `ignoredPins`, never dropped silently.
 *
 * A quality loop needs nothing else: recycling recipes are ordinary recipes in
 * the dump, so "craft at normal..epic, recycle at normal..epic, drain the
 * lower-quality output, goal on legendary" is two rows the LP solves like any
 * other cycle.
 *
 * Fuel and its burnt result stay normal (`fixedQuality`): the row's fuel choice
 * is separate from the recipe's quality.
 *
 * When no row runs above normal, no row has a positive quality effect that
 * can upgrade anything, and nothing names a non-normal quality, the input is
 * returned unchanged. That is every Py block: Py has no quality chain.
 */

/** One quality in chain order, with the chances the split needs. */
export type QualityStep = {
  name: string;
  level: number;
  next: string | null;
  /** chance of the first step up per 100% quality effect */
  nextProbability: number;
  /** chance of each further step up after reaching this quality */
  chainProbability: number;
};

/** The quality chain from normal, following `next`. Qualities outside the
 * chain (the engine's hidden `quality-unknown`) are left out. Without a
 * `normal` row (an import from before #265) the chain is normal alone. */
export function qualityLadder(rows: QualityStep[]): QualityStep[] {
  const byName = new Map(rows.map((row) => [row.name, row]));
  const ladder: QualityStep[] = [];
  let cur = byName.get(NORMAL_QUALITY) ?? {
    name: NORMAL_QUALITY,
    level: 0,
    next: null,
    nextProbability: 0,
    chainProbability: 0,
  };
  const seen = new Set<string>();
  while (!seen.has(cur.name)) {
    seen.add(cur.name);
    ladder.push(cur);
    const next = cur.next ? byName.get(cur.next) : undefined;
    if (!next) break;
    cur = next;
  }
  return ladder;
}

/** `quality` capped at `top`, the best quality the research horizon unlocks: a
 * plan can't assume a machine, module or craft at a quality the player can't
 * make yet. Normal, unknown names and undefined pass through. */
export function capQuality<Q extends string | undefined>(
  ladder: QualityStep[],
  top: string,
  quality: Q,
): Q | string {
  if (quality == null) return quality;
  const rank = (name: string) => ladder.findIndex((q) => q.name === name);
  return rank(quality) > rank(top) ? top : quality;
}

/**
 * How one craft's item product splits across qualities: each entry is the
 * expected share that comes out at that quality, and the shares sum to 1.
 *
 * With total quality effect Q (clamped at 0), the chance of at least one step
 * up from `from` is `min(1, Q × from.next_probability)`. Each further step
 * multiplies by the reached quality's `chain_probability`, and the exact-level
 * shares are the differences. Chances past `top` (the best quality the
 * research horizon unlocks) land on `top`. Same as YAFC-CE
 * `ProductionTableContent.cs:548-561`, except that YAFC-CE clamps each
 * cumulative chance to 1 after the chain factor; Factorio clamps only the
 * first step, since `chain_probability` is "the probability of an additional
 * increase after the quality was increased" (QualityPrototype, prototype-api).
 * The two only differ when `Q × next_probability > 1`.
 *
 * Normal with four quality module 3s in 2.1 (Q = 4 × 0.025, next 1, chain
 * 0.1): normal 0.9, uncommon 0.09, rare 0.009, epic 0.0009, legendary 0.0001.
 */
export function qualitySplit(
  ladder: QualityStep[],
  from: string,
  effect: number,
  top: string = ladder.at(-1)?.name ?? NORMAL_QUALITY,
): { quality: string; share: number }[] {
  const start = ladder.findIndex((q) => q.name === from);
  const end = Math.max(
    start,
    ladder.findIndex((q) => q.name === top),
  );
  if (start < 0 || !(effect > 0) || end <= start) return [{ quality: from, share: 1 }];
  // atLeast[k] = chance the product comes out at ladder[start + k] or better
  const atLeast = [1];
  for (let i = start; i < end; i++) {
    const prev = atLeast[atLeast.length - 1];
    atLeast.push(
      i === start
        ? Math.min(1, effect * ladder[i].nextProbability)
        : prev * ladder[i].chainProbability,
    );
  }
  return atLeast.flatMap((chance, k) => {
    const share = chance - (atLeast[k + 1] ?? 0);
    return share > 0 ? [{ quality: ladder[start + k].name, share }] : [];
  });
}

/** A recipe component; `fixedQuality` keeps it at normal whatever the row's
 * quality (a burner's fuel and burnt result). */
export type QualityComponent = TempComponent & { fixedQuality?: boolean };
export type QualityRecipeDef = Omit<TempRecipeDef, "ingredients" | "products"> & {
  ingredients: QualityComponent[];
  products: QualityComponent[];
};

/** How one row runs: the qualities it runs at (a slice of the ladder, low to
 * high) and its total quality effect after the machine's limits. */
export type RowQuality = { levels: string[]; effect: number };

/** A pin as the transform receives it. A share pin names the (good, quality)
 * it splits; its consumer column is the row's run at that quality. */
export type QualityPin = Pin & { quality?: string };

/** A share pin the transform couldn't apply: its row doesn't run at the pin's
 * quality. `locked` means the quality is above the best one the research
 * horizon unlocks (the row's range was capped below it); `range` means the
 * row's range simply leaves it out. The block reports these to the user. */
export type IgnoredPin = {
  recipe: string;
  item: string;
  quality: string | null;
  reason: "range" | "locked";
};

type Goal = {
  name: string;
  rate: number;
  direction?: "produce" | "consume";
  temperature?: number;
  quality?: string;
};

export type QualityFold = {
  /** LP column → its block row and the quality it runs at (null = normal) */
  rowOf: (column: string) => { recipe: string; quality: string | null };
  /** a row's LP columns, low to high */
  columnsOf: (recipe: string) => string[];
  /** LP good → its name and quality (null = normal) */
  goodOf: (good: string) => { name: string; quality: string | null };
};

const identityFold: QualityFold = {
  rowOf: (recipe) => ({ recipe, quality: null }),
  columnsOf: (recipe) => [recipe],
  goodOf: (name) => ({ name, quality: null }),
};

export function expandQualities<G extends Goal>(
  input: {
    goals: G[];
    recipes: QualityRecipeDef[];
    made: string[];
    pins: QualityPin[];
    drains: string[];
  },
  rows: ReadonlyMap<string, RowQuality>,
  ladder: QualityStep[],
  top?: string,
): {
  input: {
    goals: Omit<G, "quality">[];
    recipes: QualityRecipeDef[];
    made: string[];
    pins: Pin[];
    drains: string[];
  };
  fold: QualityFold;
  ignoredPins: IgnoredPin[];
} {
  const named = new Set(ladder.filter((q) => q.name !== NORMAL_QUALITY).map((q) => q.name));
  const levelsOf = (recipe: string) => rows.get(recipe)?.levels ?? [NORMAL_QUALITY];
  const upgrades = (recipe: string) => {
    const row = rows.get(recipe);
    return (
      !!row &&
      row.effect > 0 &&
      row.levels.some((level) => {
        const i = ladder.findIndex((q) => q.name === level);
        return i >= 0 && i < ladder.length - 1;
      })
    );
  };
  const qualified = (key: string) => splitQualityKey(key, named).quality != null;
  const active =
    input.recipes.some(
      (r) => levelsOf(r.name).some((level) => level !== NORMAL_QUALITY) || upgrades(r.name),
    ) ||
    input.goals.some((g) => g.quality != null && g.quality !== NORMAL_QUALITY) ||
    input.made.some(qualified) ||
    input.drains.some(qualified) ||
    input.pins.some((p) => p.quality != null && p.quality !== NORMAL_QUALITY);
  const stripGoal = (goal: G): Omit<G, "quality"> => {
    if (!("quality" in goal)) return goal;
    const { quality: _quality, ...rest } = goal;
    return rest;
  };
  if (!active) {
    return {
      input: {
        goals: input.goals.map(stripGoal),
        recipes: input.recipes,
        made: input.made,
        pins: input.pins.map(({ quality: _quality, ...pin }) => pin as Pin),
        drains: input.drains,
      },
      fold: identityFold,
      ignoredPins: [],
    };
  }

  const rowOfColumn = new Map<string, { recipe: string; quality: string | null }>();
  const columns = new Map<string, string[]>();
  const recipes = input.recipes.flatMap((def) => {
    const row = rows.get(def.name);
    return levelsOf(def.name).map((level): QualityRecipeDef => {
      const column = qualityKey(def.name, level);
      rowOfColumn.set(column, {
        recipe: def.name,
        quality: level === NORMAL_QUALITY ? null : level,
      });
      columns.set(def.name, [...(columns.get(def.name) ?? []), column]);
      const split = qualitySplit(ladder, level, row?.effect ?? 0, top);
      return {
        ...def,
        name: column,
        ingredients: def.ingredients.map((c) =>
          c.kind === "item" && !c.fixedQuality ? { ...c, name: qualityKey(c.name, level) } : c,
        ),
        products: def.products.flatMap((c) =>
          c.kind === "item" && !c.fixedQuality
            ? split.map(({ quality, share }) => ({
                ...c,
                name: qualityKey(c.name, quality),
                amount: c.amount * share,
              }))
            : [c],
        ),
      };
    });
  });

  const rank = (name: string) => ladder.findIndex((q) => q.name === name);
  const ignoredPins: IgnoredPin[] = [];
  const pins = input.pins.flatMap(({ quality, ...pin }): Pin[] => {
    if (pin.kind === "share") {
      // a fluid (or fixed-quality fuel) is the same good in every column, so
      // the share is of the row's summed intake
      const shared = input.recipes
        .find((r) => r.name === pin.recipe)
        ?.ingredients.some((c) => c.name === pin.item && (c.kind !== "item" || c.fixedQuality));
      const cols = columns.get(pin.recipe);
      if (shared && cols) {
        return [
          cols.length === 1
            ? { ...pin, recipe: cols[0] }
            : { ...pin, recipe: cols[0], members: cols },
        ];
      }
      const column = qualityKey(pin.recipe, quality);
      if (!rowOfColumn.has(column)) {
        // the row doesn't run at that quality: report it rather than solve as
        // if the pin weren't there. A pin on a row that left the block is
        // dropped quietly, as it is without quality.
        if (cols) {
          const level = quality ?? NORMAL_QUALITY;
          ignoredPins.push({
            recipe: pin.recipe,
            item: pin.item,
            quality: level === NORMAL_QUALITY ? null : level,
            reason: top != null && rank(level) > rank(top) ? "locked" : "range",
          });
        }
        return [];
      }
      return [{ ...pin, recipe: column, item: qualityKey(pin.item, quality) }];
    }
    const cols = columns.get(pin.recipe);
    if (!cols) return [pin];
    return [
      cols.length === 1 ? { ...pin, recipe: cols[0] } : { ...pin, recipe: cols[0], members: cols },
    ];
  });

  return {
    input: {
      goals: input.goals.map((goal) => ({
        ...stripGoal(goal),
        name: qualityKey(goal.name, goal.quality),
      })),
      recipes,
      made: input.made,
      pins,
      drains: input.drains,
    },
    fold: {
      rowOf: (column) => rowOfColumn.get(column) ?? { recipe: column, quality: null },
      columnsOf: (recipe) => columns.get(recipe) ?? [recipe],
      goodOf: (good) => splitQualityKey(good, named),
    },
    ignoredPins,
  };
}
