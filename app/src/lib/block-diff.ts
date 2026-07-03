/**
 * Block-doc diff (#85): what changed between two block definitions — goals
 * added/removed/re-rated, recipes added/removed/toggled, per-recipe pick changes
 * (machine/fuel/modules/beacons), disposition and spoil-plan changes. Pure — no
 * db, no React — so the snapshot drawer and its tests share one implementation.
 *
 * Both inputs are assumed normalized (`normalizeBlockData`); callers hold the
 * raw docs (a snapshot payload, the live editor doc) and normalize first.
 * Direction is `from` (the snapshot) → `to` (the current doc): "what changed
 * since this snapshot". Restoring the snapshot reverts exactly these changes.
 */
import type { BeaconConfig, BlockData, Goal } from "../db/schema.ts";

export type GoalChange = { name: string; from: Goal; to: Goal };

/** One recipe row's pick changes. Only recipes present in BOTH docs are
 * compared — an added/removed recipe carries its picks with it. `modules`
 * distinguishes "auto" (no entry) from an explicit list ([] = none). */
export type PickChange = {
  recipe: string;
  machine?: { from: string | null; to: string | null };
  fuel?: { from: string | null; to: string | null };
  modules?: { from: string[] | null; to: string[] | null };
  beacons?: { from: BeaconConfig[]; to: BeaconConfig[] };
};

export type ValueChange<T> = { name: string; from: T | null; to: T | null };

export type BlockDiff = {
  goals: { added: Goal[]; removed: Goal[]; changed: GoalChange[] };
  recipes: {
    added: string[];
    removed: string[];
    /** disabled in `from`, enabled in `to` */
    enabled: string[];
    /** enabled in `from`, disabled in `to` */
    disabled: string[];
  };
  picks: PickChange[];
  dispositions: ValueChange<string>[];
  spoilRates: ValueChange<number>[];
  /** true when nothing above holds a change */
  unchanged: boolean;
};

const sameGoal = (a: Goal, b: Goal) =>
  a.rate === b.rate && a.unit === b.unit && a.stock === b.stock && a.window === b.window;

const sameList = (a: string[] | null, b: string[] | null) =>
  a === b || (a != null && b != null && a.length === b.length && a.every((v, i) => v === b[i]));

/** Compare two normalized block docs. See the module docs for direction. */
export function diffBlockDocs(from: BlockData, to: BlockData): BlockDiff {
  const fromGoals = new Map((from.goals ?? []).map((g) => [g.name, g]));
  const toGoals = new Map((to.goals ?? []).map((g) => [g.name, g]));
  const goals: BlockDiff["goals"] = { added: [], removed: [], changed: [] };
  for (const g of toGoals.values()) if (!fromGoals.has(g.name)) goals.added.push(g);
  for (const g of fromGoals.values()) {
    const t = toGoals.get(g.name);
    if (!t) goals.removed.push(g);
    else if (!sameGoal(g, t)) goals.changed.push({ name: g.name, from: g, to: t });
  }

  const fromRecipes = new Set(from.recipes ?? []);
  const toRecipes = new Set(to.recipes ?? []);
  const fromOff = new Set(from.disabledRecipes ?? []);
  const toOff = new Set(to.disabledRecipes ?? []);
  const recipes: BlockDiff["recipes"] = { added: [], removed: [], enabled: [], disabled: [] };
  for (const r of toRecipes) if (!fromRecipes.has(r)) recipes.added.push(r);
  const shared: string[] = [];
  for (const r of fromRecipes) {
    if (!toRecipes.has(r)) recipes.removed.push(r);
    else {
      shared.push(r);
      if (fromOff.has(r) && !toOff.has(r)) recipes.enabled.push(r);
      if (!fromOff.has(r) && toOff.has(r)) recipes.disabled.push(r);
    }
  }

  const picks: PickChange[] = [];
  for (const r of shared) {
    const p: PickChange = { recipe: r };
    const mFrom = from.machines?.[r] ?? null;
    const mTo = to.machines?.[r] ?? null;
    if (mFrom !== mTo) p.machine = { from: mFrom, to: mTo };
    const fFrom = from.fuels?.[r] ?? null;
    const fTo = to.fuels?.[r] ?? null;
    if (fFrom !== fTo) p.fuel = { from: fFrom, to: fTo };
    const modFrom = from.modules?.[r] ?? null; // null = auto-fill
    const modTo = to.modules?.[r] ?? null;
    if (!sameList(modFrom, modTo)) p.modules = { from: modFrom, to: modTo };
    const bFrom = from.beacons?.[r] ?? [];
    const bTo = to.beacons?.[r] ?? [];
    if (JSON.stringify(bFrom) !== JSON.stringify(bTo)) p.beacons = { from: bFrom, to: bTo };
    if (p.machine || p.fuel || p.modules || p.beacons) picks.push(p);
  }

  const diffMap = <T>(a: Record<string, T> = {}, b: Record<string, T> = {}): ValueChange<T>[] => {
    const out: ValueChange<T>[] = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const from = k in a ? a[k] : null;
      const to = k in b ? b[k] : null;
      if (from !== to) out.push({ name: k, from, to });
    }
    return out;
  };
  const dispositions = diffMap(from.dispositions, to.dispositions);
  const spoilRates = diffMap(from.spoilRates, to.spoilRates);

  const unchanged =
    goals.added.length +
      goals.removed.length +
      goals.changed.length +
      recipes.added.length +
      recipes.removed.length +
      recipes.enabled.length +
      recipes.disabled.length +
      picks.length +
      dispositions.length +
      spoilRates.length ===
    0;

  return { goals, recipes, picks, dispositions, spoilRates, unchanged };
}

/** Every internal name a diff references (goods, recipes, machines, fuels,
 * modules, beacons) — the set the UI needs display names/kinds for. */
export function diffRefNames(diff: BlockDiff): string[] {
  const names = new Set<string>();
  for (const g of [...diff.goals.added, ...diff.goals.removed]) names.add(g.name);
  for (const c of diff.goals.changed) names.add(c.name);
  for (const r of [
    ...diff.recipes.added,
    ...diff.recipes.removed,
    ...diff.recipes.enabled,
    ...diff.recipes.disabled,
  ])
    names.add(r);
  for (const p of diff.picks) {
    names.add(p.recipe);
    for (const v of [p.machine?.from, p.machine?.to, p.fuel?.from, p.fuel?.to]) if (v) names.add(v);
    for (const m of [...(p.modules?.from ?? []), ...(p.modules?.to ?? [])]) names.add(m);
    for (const b of [...(p.beacons?.from ?? []), ...(p.beacons?.to ?? [])]) {
      names.add(b.beacon);
      for (const m of b.modules) names.add(m);
    }
  }
  for (const c of [...diff.dispositions, ...diff.spoilRates]) names.add(c.name);
  return [...names].sort();
}
