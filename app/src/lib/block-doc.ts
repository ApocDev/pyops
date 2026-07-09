/**
 * Block-doc recipe-set surgery (#12): swap a block's recipe list while keeping
 * every other gesture (goals, made marks, icon, groups) and pruning the
 * per-recipe config of recipes that leave — a removed recipe must not haunt the
 * doc as an orphaned machine pick, module loadout, pin, or group membership.
 *
 * Pure module (no db, no React) — usable from the server apply path
 * (`setBlockRecipesFn`) and unit-testable in isolation, like `lib/goals.ts`.
 */
import type { BlockData, Goal } from "../db/schema.ts";

function pruneRecord<V>(
  rec: Record<string, V> | undefined,
  keep: ReadonlySet<string>,
): Record<string, V> | undefined {
  if (!rec) return undefined;
  const out: Record<string, V> = {};
  for (const [k, v] of Object.entries(rec)) if (keep.has(k)) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

/** Return a copy of the doc with `recipes` as the new complete recipe list.
 * Per-recipe config (machines, fuels, modules, beacons, reactor layouts, pins,
 * disabled flags, sub-block membership) survives for recipes that stay and is
 * dropped for recipes that leave; empty maps/arrays are dropped entirely so the
 * doc stays lean. Goals and `made` marks are untouched — they're the user's
 * gestures, and the solver flags any that end up producer-less. */
export function withRecipeSet<T extends Partial<BlockData>>(doc: T, recipes: string[]): T {
  const keep = new Set(recipes);
  const next: T = { ...doc, recipes: [...recipes] };
  next.machines = pruneRecord(doc.machines, keep);
  next.fuels = pruneRecord(doc.fuels, keep);
  next.modules = pruneRecord(doc.modules, keep);
  next.beacons = pruneRecord(doc.beacons, keep);
  next.reactorLayouts = pruneRecord(doc.reactorLayouts, keep);
  next.recipeGroups = pruneRecord(doc.recipeGroups, keep);
  const disabled = (doc.disabledRecipes ?? []).filter((r) => keep.has(r));
  next.disabledRecipes = disabled.length ? disabled : undefined;
  const pins = (doc.pins ?? []).filter((p) => keep.has(p.recipe));
  next.pins = pins.length ? pins : undefined;
  // drop sub-block groups that lost every member
  const liveGroups = new Set(Object.values(next.recipeGroups ?? {}));
  const rowGroups = (doc.rowGroups ?? []).filter((g) => liveGroups.has(g.id));
  next.rowGroups = rowGroups.length ? rowGroups : undefined;
  // strip the keys we intentionally emptied (undefined values still show up in JSON diffs)
  for (const k of [
    "machines",
    "fuels",
    "modules",
    "beacons",
    "reactorLayouts",
    "recipeGroups",
    "disabledRecipes",
    "pins",
    "rowGroups",
  ] as const) {
    if (next[k] === undefined) delete next[k];
  }
  return next;
}

function pickRecipeValue<V>(rec: Record<string, V> | undefined, recipe: string): V | undefined {
  return rec && recipe in rec ? rec[recipe] : undefined;
}

/** Split one recipe out of a block doc into a new one-recipe block doc. The
 * caller provides the extracted block's goals, usually from the selected row's
 * current solved product rates. Per-row configuration for the recipe moves with
 * it; the source doc is the normal recipe-set prune plus any extracted products
 * removed from `goals`/`made` when no remaining recipe still produces them. */
export function extractRecipeToBlockDocs<T extends Partial<BlockData>>(
  doc: T,
  recipe: string,
  goals: Goal[],
  producedByRemaining: readonly string[] = [],
): { source: T; extracted: BlockData } {
  const productNames = new Set(goals.map((g) => g.name));
  const stillProduced = new Set(producedByRemaining);
  const source = withRecipeSet(
    {
      ...doc,
      goals: (doc.goals ?? []).filter(
        (g) => !productNames.has(g.name) || stillProduced.has(g.name),
      ),
      made: doc.made?.filter((name) => !productNames.has(name) || stillProduced.has(name)),
    },
    (doc.recipes ?? []).filter((name) => name !== recipe),
  );
  if (source.made?.length === 0) delete source.made;

  const extracted: BlockData = {
    goals: goals.map((g) => ({ ...g })),
    recipes: [recipe],
  };
  const machine = pickRecipeValue(doc.machines, recipe);
  if (machine) extracted.machines = { [recipe]: machine };
  const fuel = pickRecipeValue(doc.fuels, recipe);
  if (fuel) extracted.fuels = { [recipe]: fuel };
  const modules = pickRecipeValue(doc.modules, recipe);
  if (modules) extracted.modules = { [recipe]: [...modules] };
  const beacons = pickRecipeValue(doc.beacons, recipe);
  if (beacons?.length)
    extracted.beacons = { [recipe]: beacons.map((b) => ({ ...b, modules: [...b.modules] })) };
  const reactorLayout = pickRecipeValue(doc.reactorLayouts, recipe);
  if (reactorLayout) extracted.reactorLayouts = { [recipe]: { ...reactorLayout } };
  const pins = (doc.pins ?? []).filter((p) => p.recipe === recipe);
  if (pins.length) extracted.pins = pins.map((p) => ({ ...p }));
  return { source, extracted };
}
