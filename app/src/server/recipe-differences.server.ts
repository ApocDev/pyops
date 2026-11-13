import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.server.ts";
import {
  craftingMachines,
  fluids,
  items,
  machineCategories,
  recipeIngredients,
  recipes,
} from "../db/schema.ts";
import { createExclusionMatcher } from "../db/queries.server.ts";
import { recipeDifferences, type RecipeVariant } from "../lib/recipe-differences.ts";

/**
 * "What differs" labels (see lib/recipe-differences.ts) for the given recipes,
 * keyed by recipe name. Each recipe is compared against every visible recipe
 * that shares its display name, not just the ones passed in, so a block row
 * reads the same as its Dependencies row. Recipes with a unique name are
 * absent from the map. A fixed handful of bulk reads, whatever the input size.
 */
export function recipeDifferencesFor(
  wanted: readonly { name: string; display: string | null }[],
): Map<string, string> {
  const displays = [...new Set(wanted.flatMap((r) => (r.display ? [r.display] : [])))];
  if (!displays.length) return new Map();

  const isExcluded = createExclusionMatcher();
  const siblings = db
    .select({
      name: recipes.name,
      display: recipes.display,
      category: recipes.category,
      subgroup: recipes.subgroup,
    })
    .from(recipes)
    .where(and(eq(recipes.hidden, false), inArray(recipes.display, displays)))
    .all()
    .filter((r) => !isExcluded(r.name, r.category, r.subgroup));
  const siblingNames = siblings.map((r) => r.name);

  const inputs = new Map<string, string[]>();
  for (const row of db
    .select({
      recipe: recipeIngredients.recipe,
      name: recipeIngredients.name,
      item: items.display,
      fluid: fluids.display,
    })
    .from(recipeIngredients)
    .leftJoin(items, eq(items.name, recipeIngredients.name))
    .leftJoin(fluids, eq(fluids.name, recipeIngredients.name))
    .where(inArray(recipeIngredients.recipe, siblingNames))
    .orderBy(recipeIngredients.recipe, recipeIngredients.idx)
    .all()) {
    const list = inputs.get(row.recipe) ?? [];
    list.push(row.item ?? row.fluid ?? row.name);
    inputs.set(row.recipe, list);
  }

  // a category's base machine: the slowest one that runs it
  const categories = [...new Set(siblings.flatMap((r) => (r.category ? [r.category] : [])))];
  const machine = new Map<string, { display: string; speed: number }>();
  for (const row of categories.length
    ? db
        .select({
          category: machineCategories.category,
          name: craftingMachines.name,
          display: craftingMachines.display,
          speed: craftingMachines.craftingSpeed,
        })
        .from(machineCategories)
        .innerJoin(craftingMachines, eq(craftingMachines.name, machineCategories.machine))
        .where(inArray(machineCategories.category, categories))
        .all()
    : []) {
    const prev = machine.get(row.category);
    if (!prev || row.speed < prev.speed)
      machine.set(row.category, { display: row.display ?? row.name, speed: row.speed });
  }

  const variants: RecipeVariant[] = siblings.map((r) => ({
    name: r.name,
    display: r.display,
    inputs: inputs.get(r.name) ?? [],
    machine: r.category ? machine.get(r.category)?.display : null,
  }));
  const all = recipeDifferences(variants);
  return new Map(
    wanted.flatMap(({ name }) => {
      const label = all.get(name);
      return label ? [[name, label] as const] : [];
    }),
  );
}
