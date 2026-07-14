/**
 * Query layer over the imported Factorio reference data.
 * Server-side, synchronous (better-sqlite3). The recipe browser and the block
 * solver read the world through these functions.
 *
 * Note: "unlocked for my force" is runtime/mod state (not in the static dump) —
 * here we expose `enabled` (start-enabled) + tech-unlock data; the live overlay
 * comes later via the mod bridge.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, ne, sql, type AnyColumn } from "drizzle-orm";
import { db } from "./index.server.ts";
import {
  recipes,
  recipeIngredients,
  recipeProducts,
  items,
  fluids,
  craftingMachines,
  machineCategories,
  machineFuelCategories,
  miningDrills,
  techUnlocks,
  technologies,
  techIngredients,
  techPrerequisites,
  turdSelections,
  turdReplacements,
  modules,
  beacons,
  belts,
  loaders,
  inserters,
  techProductivityBonuses,
  techStackBonuses,
  modulePresets,
  blocks,
  blockFlows,
  blockMachines,
  builtMachines,
  productionStats,
  blockGroups,
  meta,
  costAnalysis,
  type BlockData,
  type BeaconConfig,
} from "./schema.ts";
import { stripRichText } from "../lib/factorio-text.ts";
import { computeEffects } from "../server/effects.ts";
import type {
  BeltProto,
  InserterProto,
  LoaderProto,
  LogisticsContext,
  StackBonuses,
} from "../lib/logistics.ts";
import {
  placedBeltStack,
  beltsForRate,
  loadersForRate,
  insertersForRate,
  inserterHandStack,
} from "../lib/logistics.ts";
import { goalNames, normalizeBlockData, primaryRate } from "../lib/goals.ts";
import { prodScaledAmount } from "../lib/productivity.ts";
import { wholeMachines } from "../lib/machine-count.ts";
import {
  bumpSolveGeneration,
  currentSolveGeneration,
  isSolveFingerprintForGeneration,
  stampSolveFingerprint,
} from "./solve-generation.server.ts";

const recipeSummary = {
  name: recipes.name,
  display: recipes.display,
  kind: recipes.kind,
  category: recipes.category,
  subgroup: recipes.subgroup,
  energyRequired: recipes.energyRequired,
  enabled: recipes.enabled,
  hidden: recipes.hidden,
  allowProductivity: recipes.allowProductivity,
  mainProduct: recipes.mainProduct,
};
type RecipeSummaryRow = Pick<
  typeof recipes.$inferSelect,
  | "name"
  | "display"
  | "kind"
  | "category"
  | "subgroup"
  | "energyRequired"
  | "enabled"
  | "hidden"
  | "allowProductivity"
  | "mainProduct"
>;

/** A recipe with its ordered ingredients + products — for display and the solver. */
/** Localized name of an item or fluid (for recipe components). */
function compDisplay(kind: string, name: string): string | null {
  const row =
    kind === "fluid"
      ? db.select({ d: fluids.display }).from(fluids).where(eq(fluids.name, name)).get()
      : db.select({ d: items.display }).from(items).where(eq(items.name, name)).get();
  return row?.d ?? null;
}

export function getRecipe(name: string) {
  const recipe = db.select().from(recipes).where(eq(recipes.name, name)).get();
  if (!recipe) return null;
  const ingredients = db
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipe, name))
    .orderBy(recipeIngredients.idx)
    .all()
    .map((c) => ({ ...c, display: compDisplay(c.kind, c.name) }));
  const products = db
    .select()
    .from(recipeProducts)
    .where(eq(recipeProducts.recipe, name))
    .orderBy(recipeProducts.idx)
    .all()
    .map((c) => ({ ...c, display: compDisplay(c.kind, c.name) }));
  return { ...recipe, ingredients, products };
}

function componentDisplays(rows: { kind: string; name: string }[]): Map<string, string | null> {
  const itemNames = [...new Set(rows.filter((r) => r.kind !== "fluid").map((r) => r.name))];
  const fluidNames = [...new Set(rows.filter((r) => r.kind === "fluid").map((r) => r.name))];
  const out = new Map<string, string | null>();
  if (itemNames.length)
    for (const r of db
      .select({ name: items.name, display: items.display })
      .from(items)
      .where(inArray(items.name, itemNames))
      .all())
      out.set(`item:${r.name}`, r.display);
  if (fluidNames.length)
    for (const r of db
      .select({ name: fluids.name, display: fluids.display })
      .from(fluids)
      .where(inArray(fluids.name, fluidNames))
      .all())
      out.set(`fluid:${r.name}`, r.display);
  return out;
}

function recipesByName(names: string[]) {
  const uniq = [...new Set(names)].filter((n) => n);
  const out = new Map<string, NonNullable<ReturnType<typeof getRecipe>>>();
  if (!uniq.length) return out;

  const recipeRows = db.select().from(recipes).where(inArray(recipes.name, uniq)).all();
  const ingRows = db
    .select()
    .from(recipeIngredients)
    .where(inArray(recipeIngredients.recipe, uniq))
    .orderBy(recipeIngredients.recipe, recipeIngredients.idx)
    .all();
  const prodRows = db
    .select()
    .from(recipeProducts)
    .where(inArray(recipeProducts.recipe, uniq))
    .orderBy(recipeProducts.recipe, recipeProducts.idx)
    .all();
  const displays = componentDisplays([...ingRows, ...prodRows]);

  const ingredientsByRecipe = new Map<string, (typeof ingRows)[number][]>();
  for (const row of ingRows) {
    const list = ingredientsByRecipe.get(row.recipe) ?? [];
    list.push(row);
    ingredientsByRecipe.set(row.recipe, list);
  }
  const productsByRecipe = new Map<string, (typeof prodRows)[number][]>();
  for (const row of prodRows) {
    const list = productsByRecipe.get(row.recipe) ?? [];
    list.push(row);
    productsByRecipe.set(row.recipe, list);
  }

  for (const recipe of recipeRows) {
    out.set(recipe.name, {
      ...recipe,
      ingredients: (ingredientsByRecipe.get(recipe.name) ?? []).map((c) => ({
        ...c,
        display: displays.get(`${c.kind}:${c.name}`) ?? null,
      })),
      products: (productsByRecipe.get(recipe.name) ?? []).map((c) => ({
        ...c,
        display: displays.get(`${c.kind}:${c.name}`) ?? null,
      })),
    });
  }
  return out;
}

function machinesForRecipes(recipeNames: string[]) {
  const uniq = [...new Set(recipeNames)].filter((n) => n);
  const out = new Map<string, ReturnType<typeof machinesForRecipe>>();
  if (!uniq.length) return out;

  const recipeCats = db
    .select({ recipe: recipes.name, category: recipes.category })
    .from(recipes)
    .where(inArray(recipes.name, uniq))
    .all();
  const categories = [
    ...new Set(recipeCats.map((r) => r.category).filter((c): c is string => !!c)),
  ];
  if (!categories.length) {
    for (const r of recipeCats) out.set(r.recipe, []);
    return out;
  }

  const machineRows = db
    .select({
      category: machineCategories.category,
      name: craftingMachines.name,
      display: craftingMachines.display,
      kind: craftingMachines.kind,
      craftingSpeed: craftingMachines.craftingSpeed,
      tileWidth: craftingMachines.tileWidth,
      tileHeight: craftingMachines.tileHeight,
      moduleSlots: craftingMachines.moduleSlots,
      energyUsageW: craftingMachines.energyUsageW,
      energySource: craftingMachines.energySource,
      pollutionPerMin: craftingMachines.pollutionPerMin,
      allowedEffects: craftingMachines.allowedEffects,
      allowedModuleCategories: craftingMachines.allowedModuleCategories,
      neighbourBonus: craftingMachines.neighbourBonus,
      burnsFluid: craftingMachines.burnsFluid,
      fluidFuelFilter: craftingMachines.fluidFuelFilter,
      fluidFuelPerSec: craftingMachines.fluidFuelPerSec,
      fluidFuelEnergyJ: craftingMachines.fluidFuelEnergyJ,
    })
    .from(machineCategories)
    .innerJoin(craftingMachines, eq(craftingMachines.name, machineCategories.machine))
    .where(inArray(machineCategories.category, categories))
    .all();
  const machineNames = [...new Set(machineRows.map((m) => m.name))];
  const fuelByMachine = new Map<string, string[]>();
  if (machineNames.length)
    for (const f of db
      .select({
        machine: machineFuelCategories.machine,
        category: machineFuelCategories.fuelCategory,
      })
      .from(machineFuelCategories)
      .where(inArray(machineFuelCategories.machine, machineNames))
      .all()) {
      const list = fuelByMachine.get(f.machine) ?? [];
      list.push(f.category);
      fuelByMachine.set(f.machine, list);
    }

  const byCategory = new Map<string, ReturnType<typeof machinesForRecipe>>();
  for (const row of machineRows) {
    const { category, ...machine } = row;
    const list = byCategory.get(category) ?? [];
    list.push({ ...machine, fuelCategories: fuelByMachine.get(machine.name) ?? [] });
    byCategory.set(category, list);
  }
  for (const r of recipeCats)
    out.set(r.recipe, r.category ? (byCategory.get(r.category) ?? []) : []);
  return out;
}

/** Recipes that OUTPUT the given item/fluid (the candidate recipes for making X). */
export function recipesProducing(name: string) {
  return db
    .selectDistinct(recipeSummary)
    .from(recipeProducts)
    .innerJoin(recipes, eq(recipes.name, recipeProducts.recipe))
    .where(eq(recipeProducts.name, name))
    .all();
}

function recipesProducingByGoods(names: string[]): Map<string, RecipeSummaryRow[]> {
  const uniq = [...new Set(names)].filter((n) => n);
  const out = new Map<string, RecipeSummaryRow[]>();
  for (const name of uniq) out.set(name, []);
  if (!uniq.length) return out;
  const rows = db
    .selectDistinct({
      good: recipeProducts.name,
      ...recipeSummary,
    })
    .from(recipeProducts)
    .innerJoin(recipes, eq(recipes.name, recipeProducts.recipe))
    .where(inArray(recipeProducts.name, uniq))
    .all();
  for (const { good, ...recipe } of rows) {
    const list = out.get(good) ?? [];
    list.push(recipe);
    out.set(good, list);
  }
  return out;
}

/** Recipes that CONSUME the given item/fluid (downstream uses). */
export function recipesConsuming(name: string) {
  return db
    .selectDistinct(recipeSummary)
    .from(recipeIngredients)
    .innerJoin(recipes, eq(recipes.name, recipeIngredients.recipe))
    .where(eq(recipeIngredients.name, name))
    .all();
}

function recipesConsumingByGoods(names: string[]): Map<string, RecipeSummaryRow[]> {
  const uniq = [...new Set(names)].filter((n) => n);
  const out = new Map<string, RecipeSummaryRow[]>();
  for (const name of uniq) out.set(name, []);
  if (!uniq.length) return out;
  const rows = db
    .selectDistinct({
      good: recipeIngredients.name,
      ...recipeSummary,
    })
    .from(recipeIngredients)
    .innerJoin(recipes, eq(recipes.name, recipeIngredients.recipe))
    .where(inArray(recipeIngredients.name, uniq))
    .all();
  for (const { good, ...recipe } of rows) {
    const list = out.get(good) ?? [];
    list.push(recipe);
    out.set(good, list);
  }
  return out;
}

export type BuildCost = {
  buildings: { name: string; display: string; count: number; recipe: string | null }[];
  materials: { name: string; kind: string; display: string; amount: number }[];
};
/** One-time material cost to CONSTRUCT a set of buildings (the "build the stuff to
 * build the stuff" requirement, #38): for each building item, the direct ingredients
 * of its primary build recipe × the (ceil'd) building count. This is why e.g. steel
 * is needed for a science block even though no science recipe consumes it. Direct
 * ingredients only — producing those materials' own sub-chain is the factory
 * ledger's job. */
export function buildCost(buildings: { name: string; count: number }[]): BuildCost {
  const materials = new Map<string, { kind: string; amount: number }>();
  const used: BuildCost["buildings"] = [];
  const disp = (name: string) => getItem(name)?.display ?? getFluid(name)?.display ?? name;
  for (const b of buildings) {
    const count = Math.ceil(b.count - 1e-6);
    if (count <= 0) continue;
    const crafts = recipesProducing(b.name);
    const pick = crafts.find((r) => r.enabled) ?? crafts[0] ?? null; // prefer a base recipe
    const def = pick ? getRecipe(pick.name) : null;
    used.push({ name: b.name, display: disp(b.name), count, recipe: pick?.name ?? null });
    if (!def) continue;
    const per = def.products.find((p) => p.name === b.name)?.amount ?? 1; // buildings per craft
    if (per <= 0) continue;
    for (const ing of def.ingredients) {
      const cur = materials.get(ing.name) ?? { kind: ing.kind, amount: 0 };
      cur.amount += (ing.amount * count) / per;
      materials.set(ing.name, cur);
    }
  }
  return {
    buildings: used,
    materials: [...materials]
      .map(([name, v]) => ({ name, kind: v.kind, display: disp(name), amount: v.amount }))
      .sort((a, b) => (a.display < b.display ? -1 : 1)),
  };
}

/** Crafting machines that can run a recipe, matched by its category — with the
 * power + fuel-category info the block view needs to size buildings and fuel. */
export function machinesForRecipe(recipeName: string) {
  const r = db
    .select({ category: recipes.category })
    .from(recipes)
    .where(eq(recipes.name, recipeName))
    .get();
  if (!r?.category) return [];
  const machines = db
    .select({
      name: craftingMachines.name,
      display: craftingMachines.display,
      kind: craftingMachines.kind,
      craftingSpeed: craftingMachines.craftingSpeed,
      tileWidth: craftingMachines.tileWidth,
      tileHeight: craftingMachines.tileHeight,
      moduleSlots: craftingMachines.moduleSlots,
      energyUsageW: craftingMachines.energyUsageW,
      energySource: craftingMachines.energySource,
      pollutionPerMin: craftingMachines.pollutionPerMin,
      allowedEffects: craftingMachines.allowedEffects,
      allowedModuleCategories: craftingMachines.allowedModuleCategories,
      neighbourBonus: craftingMachines.neighbourBonus,
      burnsFluid: craftingMachines.burnsFluid,
      fluidFuelFilter: craftingMachines.fluidFuelFilter,
      fluidFuelPerSec: craftingMachines.fluidFuelPerSec,
      fluidFuelEnergyJ: craftingMachines.fluidFuelEnergyJ,
    })
    .from(machineCategories)
    .innerJoin(craftingMachines, eq(craftingMachines.name, machineCategories.machine))
    .where(eq(machineCategories.category, r.category))
    .all();
  return machines.map((m) => ({
    ...m,
    fuelCategories: db
      .select({ c: machineFuelCategories.fuelCategory })
      .from(machineFuelCategories)
      .where(eq(machineFuelCategories.machine, m.name))
      .all()
      .map((x) => x.c),
  }));
}

/** Solid fuels valid for a set of fuel categories (for the fuel picker).
 * Fluid burners don't pick from a list: unfiltered ones draw from the shared
 * pyops-fluid-fuel pool, filtered ones are pinned to `fluidFuelEntry` (#25). */
export function fuelsForCategories(categories: string[]) {
  if (!categories.length) return [];
  return db
    .select({
      name: items.name,
      display: items.display,
      fuelValueJ: items.fuelValueJ,
      kind: sql<string>`'item'`,
      burntResult: items.burntResult,
    })
    .from(items)
    .where(and(isNotNull(items.fuelValueJ), inArray(items.fuelCategory, categories)))
    .orderBy(items.fuelValueJ)
    .all()
    .filter((f) => !isExcluded(f.name)); // EE / user-excluded fuels
}

/** A single fluid in fuel-entry shape — the pinned fuel of a FILTERED fluid
 * burner (energy_source.fluid_box.filter, e.g. Py's oil/gas powerplants).
 * Null when the fluid is unknown or carries no fuel value (burning a fluid
 * never leaves a burnt result — none in the dump has one). */
export function fluidFuelEntry(name: string) {
  const f = db
    .select({
      name: fluids.name,
      display: fluids.display,
      fuelValueJ: fluids.fuelValueJ,
      kind: sql<string>`'fluid'`,
      burntResult: sql<string | null>`NULL`,
    })
    .from(fluids)
    .where(and(eq(fluids.name, name), isNotNull(fluids.fuelValueJ)))
    .get();
  return f ?? null;
}

/** Which of the given machines are buildable under the current research horizon —
 * a machine is available if any recipe that crafts its item is reached (enabled,
 * or its unlock tech researched / its science packs produced). In FUTURE mode the
 * caller doesn't restrict; this answers the NOW question. Reuses computeAvail so
 * machine eligibility matches recipe eligibility exactly. */
export function availableMachines(machineNames: string[]): Set<string> {
  const uniq = [...new Set(machineNames)].filter((name) => name);
  if (!uniq.length) return new Set();
  const craftsByMachine = recipesProducingByGoods(uniq);
  const craftRows = [
    ...new Map(
      [...craftsByMachine.values()].flat().map((recipe) => [recipe.name, recipe]),
    ).values(),
  ];
  const h = getResearchHorizon();
  const selections = getTurdSelections();
  const locks = recipeLockStatesByRecipe(
    craftRows.map((recipe) => recipe.name),
    new Set(selections.values()),
  );
  const availability = computeAvailByRecipe(craftRows, locks, h, selections);
  const out = new Set<string>();
  for (const name of uniq) {
    const ok = (craftsByMachine.get(name) ?? []).some(
      (recipe) => availability.get(recipe.name)?.availableNow,
    );
    if (ok) out.add(name);
  }
  return out;
}

/** Which of the given items are UNLOCKED in the current horizon — an item is
 * available if some recipe producing it is reached. In NOW mode this is the
 * strict buildableNow (no unmade TURD pick); in target/future, availableNow.
 * Generic over any item set: drives the agent's module auto-fill (so it only
 * places modules you can actually have) and `logisticsForGood`'s belt/loader/
 * inserter tier gating (belt/loader/inserter entities are themselves crafted
 * items). See [[turd-planning-model]] for the buildableNow vs availableNow
 * split. */
export function unlockedItems(names: string[]): Set<string> {
  const uniq = [...new Set(names)].filter((name) => name);
  if (!uniq.length) return new Set();
  const h = getResearchHorizon();
  // FUTURE mode plans against the whole tech tree — anything producible is fair
  // game (availableNow would wrongly exclude not-yet-researched tiers).
  if (h.mode === "future") return obtainableGoods(uniq);
  const selections = getTurdSelections();
  const now = h.mode === "now";
  const recipesByGood = recipesProducingByGoods(uniq);
  const recipeRows = [
    ...new Map([...recipesByGood.values()].flat().map((recipe) => [recipe.name, recipe])).values(),
  ];
  const locks = recipeLockStatesByRecipe(
    recipeRows.map((recipe) => recipe.name),
    new Set(selections.values()),
  );
  const availability = computeAvailByRecipe(recipeRows, locks, h, selections);
  const out = new Set<string>();
  for (const name of uniq) {
    const ok = (recipesByGood.get(name) ?? []).some((recipe) => {
      const a = availability.get(recipe.name);
      return a && (now ? a.buildableNow : a.availableNow);
    });
    if (ok) out.add(name);
  }
  return out;
}

/** Machines that can run a recipe, enriched with availability for the building
 * picker: whether the machine is buildable at game start, which techs unlock it
 * (its tier signal — e.g. smelters-mk04), and whether it's available right now. */
type MachineOption = ReturnType<typeof machinesForRecipe>[number] & {
  startEnabled: boolean;
  unlockedBy: { tech: string; display: string | null }[];
  unlockedNow: boolean;
  availableNow: boolean;
  favorite: boolean;
};

/** Whether the recipe exists in the synced save right now, independent of the
 * broader planning horizon. TURD recipes count only when their branch is the
 * selected one; stale researched-tech data must not resurrect another branch. */
function isRecipeUnlockedNow(
  enabled: boolean,
  unlocks: RecipeLockState,
  researched: ReadonlySet<string>,
): boolean {
  return (
    enabled ||
    unlocks.some((unlock) => (unlock.isTurdSub ? unlock.turdSelected : researched.has(unlock.tech)))
  );
}

/** Request-scoped machine enrichment for several recipe candidates. */
export function machineOptionsForRecipes(recipeNames: string[]): Map<string, MachineOption[]> {
  const uniq = [...new Set(recipeNames)].filter((name) => name);
  const out = new Map<string, MachineOption[]>();
  for (const name of uniq) out.set(name, []);
  if (!uniq.length) return out;

  const machinesByRecipe = machinesForRecipes(uniq);
  const machineNames = [
    ...new Set([...machinesByRecipe.values()].flat().map((machine) => machine.name)),
  ];
  const craftsByMachine = recipesProducingByGoods(machineNames);
  const craftRows = [
    ...new Map(
      [...craftsByMachine.values()].flat().map((recipe) => [recipe.name, recipe]),
    ).values(),
  ];
  const selections = getTurdSelections();
  const locksByRecipe = recipeLockStatesByRecipe(
    craftRows.map((recipe) => recipe.name),
    new Set(selections.values()),
  );
  const researched = syncedResearchedTechs();
  const availability = computeAvailByRecipe(
    craftRows,
    locksByRecipe,
    getResearchHorizon(),
    selections,
  );
  const categories = new Map(
    db
      .select({ name: recipes.name, category: recipes.category })
      .from(recipes)
      .where(inArray(recipes.name, uniq))
      .all()
      .map((recipe) => [recipe.name, recipe.category]),
  );
  const favorites = getFavoriteMachines();

  for (const recipeName of uniq) {
    const category = categories.get(recipeName);
    const favorite = category ? (favorites[category] ?? null) : null;
    out.set(
      recipeName,
      (machinesByRecipe.get(recipeName) ?? []).map((machine) => {
        const crafts = craftsByMachine.get(machine.name) ?? [];
        const unlockedBy = dedupeBy(
          crafts.flatMap((recipe) =>
            (locksByRecipe.get(recipe.name) ?? []).map((unlock) => ({
              tech: unlock.tech,
              display: unlock.display,
            })),
          ),
          (unlock) => unlock.tech,
        );
        return {
          ...machine,
          startEnabled: crafts.some((recipe) => recipe.enabled),
          unlockedBy,
          unlockedNow: crafts.some((recipe) =>
            isRecipeUnlockedNow(recipe.enabled, locksByRecipe.get(recipe.name) ?? [], researched),
          ),
          availableNow: crafts.some((recipe) => availability.get(recipe.name)?.availableNow),
          favorite: machine.name === favorite,
        };
      }),
    );
  }
  return out;
}

export function machineOptionsForRecipe(recipeName: string) {
  return machineOptionsForRecipes([recipeName]).get(recipeName) ?? [];
}
function dedupeBy<T>(arr: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ── Modules & beacons ──────────────────────────────────────────────────────── */

export type ModuleRow = typeof modules.$inferSelect;

export function getModules(names: string[]): Map<string, ModuleRow> {
  if (!names.length) return new Map();
  return new Map(
    db
      .select()
      .from(modules)
      .where(inArray(modules.name, Array.from(new Set(names))))
      .all()
      .map((m) => [m.name, m]),
  );
}

export type BeaconRow = typeof beacons.$inferSelect;

export function getBeacons(names: string[]): Map<string, BeaconRow> {
  if (!names.length) return new Map();
  return new Map(
    db
      .select()
      .from(beacons)
      .where(inArray(beacons.name, Array.from(new Set(names))))
      .all()
      .map((b) => [b.name, b]),
  );
}

/** Module eligibility, two independent gates. The *category* gate is per host
 * slots: a Py creature building only takes its creature modules, a beacon has
 * its own category list. The *effect* gate is about who receives the effect —
 * every beneficial effect the module provides must be allowed by the receiver
 * (negative side effects never block insertion). Null lists = no restriction. */
function categoryAllowed(m: ModuleRow, cats: string[] | null | undefined): boolean {
  return !cats?.length || cats.includes(m.category ?? "");
}
function effectsAllowed(m: ModuleRow, fx: string[] | null | undefined): boolean {
  if (!fx?.length) return true;
  if (m.effSpeed > 0 && !fx.includes("speed")) return false;
  if (m.effProductivity > 0 && !fx.includes("productivity")) return false;
  if (m.effConsumption < 0 && !fx.includes("consumption")) return false;
  return true;
}

/** The HAND-PLACEABLE modules that fit a machine's slots — what you actually put in
 * this building. Py's creature buildings lock their slots to their own module
 * category (e.g. a Vrauk paddock only takes 'vrauks' modules → the Vrauk speed
 * modules). Hidden modules are excluded: those are Py's TURD modules, delivered by
 * the always-on hidden T.U.R.D. beacon (1:1, no slot cost), not placed by hand.
 * EE/user-excluded modules are excluded too; they are not planner-usable choices.
 * See turdChoices for a choice's module. */
export function modulesFittingMachine(machineName: string) {
  const m = db.select().from(craftingMachines).where(eq(craftingMachines.name, machineName)).get();
  if (!m) return [];
  return db
    .select()
    .from(modules)
    .where(eq(modules.hidden, false))
    .orderBy(modules.category, modules.tier, modules.name)
    .all()
    .filter(
      (mod) =>
        !isExcluded(mod.name, mod.category) &&
        categoryAllowed(mod, m.allowedModuleCategories) &&
        effectsAllowed(mod, m.allowedEffects),
    )
    .map((mod) => ({
      name: mod.name,
      display: mod.display ?? mod.name,
      category: mod.category,
      speed: mod.effSpeed,
      productivity: mod.effProductivity,
      consumption: mod.effConsumption,
    }));
}

/** The TURD modules of a sub-tech that would actually apply to a machine — its slot
 * category must accept the module's category, and per-tier -mk0N modules match the
 * machine's own -mk0N tier (mirrors the live TURD-beacon insertion). */
function turdModulesForMachine(
  sub: string,
  machine: {
    name: string;
    allowedModuleCategories: string[] | null;
  },
): ModuleRow[] {
  return turdModulesOf(sub).filter((mod) => {
    if (!machine.allowedModuleCategories?.includes(mod.category ?? "")) return false;
    const tier = /-mk0(\d)$/.exec(mod.name);
    return !tier || machine.name.endsWith(`-mk0${tier[1]}`);
  });
}

const avgAmount = (c: {
  amount: number | null;
  amountMin?: number | null;
  amountMax?: number | null;
}) =>
  c.amount ?? (c.amountMin != null && c.amountMax != null ? (c.amountMin + c.amountMax) / 2 : 0);

/** "What-if" throughput for ONE recipe under a specific loadout — a tiny single-
 * building plan the assistant can use to judge whether a TURD or a module fill is
 * worth it. Resolves the machine, validates the hand-placed modules against its
 * slot rules, optionally applies a TURD choice's beacon module, then reports the
 * effective speed/productivity/energy multipliers and the resulting per-second
 * inputs/outputs and power PER BUILDING (plus buildings needed for a target rate).
 * Productivity scales only non-ignored outputs; speed scales crafts/sec; the TURD
 * module is applied via the hidden beacon at no slot cost (see [[modulesFittingMachine]]). */
export function computeRecipeScenario(opts: {
  recipe: string;
  machine?: string;
  modules?: string[];
  fill?: string;
  beacons?: BeaconConfig[];
  turd?: string;
  targetRate?: number;
}) {
  const r = getRecipe(opts.recipe);
  if (!r) return { error: `no recipe '${opts.recipe}'` };
  const machineList = machinesForRecipe(opts.recipe)
    .slice()
    .sort((a, b) => (b.craftingSpeed ?? 0) - (a.craftingSpeed ?? 0));
  if (!machineList.length) return { error: `recipe '${opts.recipe}' has no crafting machine` };
  const machine = opts.machine ? machineList.find((m) => m.name === opts.machine) : machineList[0];
  if (!machine) return { error: `machine '${opts.machine}' can't craft '${opts.recipe}'` };

  const slots = machine.moduleSlots ?? 0;
  const wanted = (opts.modules ?? (opts.fill ? Array(slots).fill(opts.fill) : [])).slice(0, slots);
  // validate each requested hand module against the machine's slot rules
  const wantRows = getModules([...new Set(wanted)]);
  const rejected: { name: string; reason: string }[] = [];
  const validSlots = wanted.filter((name) => {
    const mod = wantRows.get(name);
    if (!mod) return void rejected.push({ name, reason: "unknown module" });
    if (mod.hidden)
      return void rejected.push({ name, reason: "hidden (TURD/beacon module, not hand-placed)" });
    if (!categoryAllowed(mod, machine.allowedModuleCategories))
      return void rejected.push({
        name,
        reason: `category '${mod.category}' not accepted (slots take ${JSON.stringify(machine.allowedModuleCategories ?? "any")})`,
      });
    if (!effectsAllowed(mod, machine.allowedEffects))
      return void rejected.push({ name, reason: "effect not allowed by this machine" });
    if (mod.effProductivity > 0 && !r.allowProductivity)
      return void rejected.push({ name, reason: "recipe doesn't allow productivity" });
    return true;
  });

  const turdModules = opts.turd ? turdModulesForMachine(opts.turd, machine) : [];
  const moduleDb = getModules(validSlots);
  const beaconCfgs = (opts.beacons ?? []).filter((b) => b.count > 0);
  const beaconDb = getBeacons(beaconCfgs.map((b) => b.beacon));

  // research-driven productivity (#92) — same bonuses computeBlock applies
  const rp = productivityBonuses();
  const fx = computeEffects(
    r.allowProductivity,
    validSlots,
    beaconCfgs,
    moduleDb,
    beaconDb,
    turdModules,
    {
      recipeProd: rp.recipes.get(r.name) ?? 0,
      miningProd: r.kind === "mining" ? rp.mining : 0,
      maxProductivity: r.maximumProductivity,
    },
  );

  const craftsPerSec = (machine.craftingSpeed * fx.speedMult) / (r.energyRequired || 0.5);
  const outputs = r.products.map((p) => ({
    good: p.name,
    display: p.display ?? p.name,
    // productivity scales only the non-ignored part of each product (#93)
    perSec:
      craftsPerSec *
      prodScaledAmount(avgAmount(p), fx.prodMult, p.ignoredByProductivity) *
      (p.probability ?? 1),
  }));
  const inputs = r.ingredients.map((c) => ({
    good: c.name,
    display: c.display ?? c.name,
    perSec: craftsPerSec * (c.amount ?? 0),
  }));
  const powerW = (machine.energyUsageW ?? 0) * fx.consMult + fx.beaconPowerPerMachineW;

  const mainName = r.mainProduct ?? r.products[0]?.name ?? null;
  const mainRate = outputs.find((o) => o.good === mainName)?.perSec ?? outputs[0]?.perSec ?? 0;

  return {
    recipe: r.name,
    display: r.display ?? r.name,
    machine: {
      name: machine.name,
      display: machine.display ?? machine.name,
      craftingSpeed: machine.craftingSpeed,
      moduleSlots: slots,
      allowedModuleCategories: machine.allowedModuleCategories ?? null,
      allowedEffects: machine.allowedEffects ?? null,
    },
    modulesPlaced: validSlots,
    rejectedModules: rejected.length ? rejected : undefined,
    turd: opts.turd
      ? {
          sub: opts.turd,
          modulesApplied: turdModules.map((m) => m.name),
          applied: turdModules.length > 0,
        }
      : null,
    beacons: beaconCfgs.length ? beaconCfgs : undefined,
    effects: {
      speedPct: Math.round(fx.speedBonus * 1000) / 10,
      productivityPct: Math.round(fx.prodBonus * 1000) / 10,
      energyPct: Math.round(fx.consBonus * 1000) / 10,
      speedMult: Math.round(fx.speedMult * 1000) / 1000,
      prodMult: Math.round(fx.prodMult * 1000) / 1000,
      energyMult: Math.round(fx.consMult * 1000) / 1000,
    },
    perBuilding: {
      craftsPerSec: Math.round(craftsPerSec * 1000) / 1000,
      outputs: outputs.map((o) => ({ ...o, perSec: Math.round(o.perSec * 1000) / 1000 })),
      inputs: inputs.map((i) => ({ ...i, perSec: Math.round(i.perSec * 1000) / 1000 })),
      powerKW: Math.round(powerW / 10) / 100,
    },
    target:
      opts.targetRate && mainRate > 0
        ? {
            good: mainName,
            rate: opts.targetRate,
            buildingsNeeded: Math.round((opts.targetRate / mainRate) * 100) / 100,
          }
        : undefined,
  };
}

/** Everything the module/beacon picker needs for one recipe row: the chosen
 * machine's slots, modules that fit those slots, the placeable beacon variants,
 * and the modules that fit each beacon (machine + beacon restrictions both apply
 * since the beacon transmits its effects into the machine). */

/** Every hand-placeable module, one table scan. Hidden modules are TURD
 * internals — game-inserted, never hand-placed — and EE/user-excluded modules
 * are not planner-usable. block-compute fetches this once per solve and filters
 * per row, instead of paying modulePickerData's full-table rescan for every
 * recipe. */
export function placeableModules() {
  return db
    .select()
    .from(modules)
    .where(eq(modules.hidden, false))
    .orderBy(modules.category, modules.tier, modules.name)
    .all()
    .filter((mod) => !isExcluded(mod.name, mod.category));
}

/** The picker's placement rules for one (machine, recipe) pair, as a reusable
 * predicate — single source of truth shared by modulePickerData and the
 * per-solve suggestion pools, so a template/suggestion can never place a
 * module the picker wouldn't offer. */
export function modulePlacementFilter(
  machine: { allowedModuleCategories: string[] | null; allowedEffects: string[] | null },
  recipe: { allowedModuleCategories: string[] | null; allowProductivity: boolean },
): (mod: ModuleRow) => boolean {
  return (mod) =>
    categoryAllowed(mod, machine.allowedModuleCategories) &&
    categoryAllowed(mod, recipe.allowedModuleCategories) &&
    effectsAllowed(mod, machine.allowedEffects) &&
    (mod.effProductivity <= 0 || recipe.allowProductivity);
}

export function modulePickerData(recipeName: string, machineName: string) {
  const r = db
    .select({
      allowProductivity: recipes.allowProductivity,
      allowedModuleCategories: recipes.allowedModuleCategories,
    })
    .from(recipes)
    .where(eq(recipes.name, recipeName))
    .get();
  const m = db.select().from(craftingMachines).where(eq(craftingMachines.name, machineName)).get();
  if (!r || !m) return null;

  const allModules = placeableModules();
  const beaconRows = db
    .select()
    .from(beacons)
    .where(eq(beacons.hidden, false))
    .orderBy(beacons.name)
    .all()
    .filter((b) => !isExcluded(b.name));
  const unlocked = unlockedItems([
    ...allModules.map((mod) => mod.name),
    ...beaconRows.map((b) => b.name),
  ]);
  const withUnlock = <T extends { name: string }>(row: T): T & { unlocked: boolean } => ({
    ...row,
    unlocked: unlocked.has(row.name),
  });
  const prodOk = (mod: ModuleRow) => mod.effProductivity <= 0 || r.allowProductivity;
  const machineModules = allModules.filter(modulePlacementFilter(m, r)).map(withUnlock);

  const beaconList = beaconRows.map((b) => ({
    name: b.name,
    display: b.display,
    distributionEffectivity: b.distributionEffectivity,
    moduleSlots: b.moduleSlots,
    energyUsageW: b.energyUsageW,
    profile: b.profile,
    unlocked: unlocked.has(b.name),
    // fits the beacon's slots, and its transmitted effects are usable by machine+recipe
    modules: allModules
      .filter(
        (mod) =>
          categoryAllowed(mod, b.allowedModuleCategories) &&
          effectsAllowed(mod, b.allowedEffects) &&
          effectsAllowed(mod, m.allowedEffects) &&
          prodOk(mod),
      )
      .map((mod) => mod.name),
  }));

  // flat index of every module referenced by any beacon (for display/effects lookup)
  const beaconModuleNames = new Set(beaconList.flatMap((b) => b.modules));
  const beaconModules = allModules.filter((mod) => beaconModuleNames.has(mod.name)).map(withUnlock);

  return {
    machine: { name: m.name, display: m.display, moduleSlots: m.moduleSlots },
    allowProductivity: r.allowProductivity,
    modules: machineModules,
    beacons: beaconList,
    beaconModules,
  };
}

/* ── TURD (Pyanodon tech upgrades) ──────────────────────────────────────────
 * Master techs are flagged is_turd. The dump-time yafc integration turns each
 * selectable sub-upgrade into a technology whose prerequisites are
 * [master, turd-select-<name>]; its unlock effects are the recipes (incl. the
 * hidden TURD module recipes) that choice grants. */

/** Sub-techs of several masters, resolved in two set-oriented reads. */
function turdSubTechsByMaster(masterNames: string[]): Map<string, string[]> {
  const uniq = [...new Set(masterNames)].filter(Boolean);
  const out = new Map(uniq.map((master) => [master, [] as string[]]));
  if (!uniq.length) return out;
  const candidates = db
    .select({ master: techPrerequisites.prerequisite, sub: techPrerequisites.technology })
    .from(techPrerequisites)
    .where(inArray(techPrerequisites.prerequisite, uniq))
    .all();
  const candidateSubs = [...new Set(candidates.map((row) => row.sub))];
  if (!candidateSubs.length) return out;
  const gated = new Set(
    db
      .select({ sub: techPrerequisites.technology, gate: techPrerequisites.prerequisite })
      .from(techPrerequisites)
      .where(inArray(techPrerequisites.technology, candidateSubs))
      .all()
      .filter((row) => row.gate === `turd-select-${row.sub}`)
      .map((row) => row.sub),
  );
  for (const row of candidates) if (gated.has(row.sub)) out.get(row.master)?.push(row.sub);
  return out;
}

function turdSubTechs(masterName: string): string[] {
  return turdSubTechsByMaster([masterName]).get(masterName) ?? [];
}

function turdModulesBySub(subTechs: string[]) {
  const uniq = [...new Set(subTechs)].filter(Boolean);
  const out = new Map(uniq.map((sub) => [sub, [] as (typeof modules.$inferSelect)[]]));
  if (!uniq.length) return out;
  const predicate = sql.join(
    uniq.map(
      (sub) =>
        sql`(${modules.name} = ${sub + "-module"} OR ${modules.name} LIKE ${sub + "-module-mk0%"})`,
    ),
    sql` OR `,
  );
  const rows = db.select().from(modules).where(predicate).all();
  for (const row of rows) {
    const sub = uniq.find(
      (candidate) =>
        row.name === `${candidate}-module` || row.name.startsWith(`${candidate}-module-mk0`),
    );
    if (sub) out.get(sub)!.push(row);
  }
  return out;
}

function turdMasterRowsBySub(subTechs: string[]) {
  const uniq = [...new Set(subTechs)].filter(Boolean);
  const masterNameBySub = new Map<string, string>();
  if (!uniq.length)
    return {
      masterNameBySub,
      masterRows: new Map<string, { name: string; display: string | null }>(),
    };
  for (const row of db
    .select({ sub: techPrerequisites.technology, prerequisite: techPrerequisites.prerequisite })
    .from(techPrerequisites)
    .where(inArray(techPrerequisites.technology, uniq))
    .all()) {
    if (!row.prerequisite.startsWith("turd-select-") && !masterNameBySub.has(row.sub))
      masterNameBySub.set(row.sub, row.prerequisite);
  }
  const masterNames = [...new Set(masterNameBySub.values())];
  const masterRows = masterNames.length
    ? new Map(
        db
          .select({ name: technologies.name, display: technologies.display })
          .from(technologies)
          .where(inArray(technologies.name, masterNames))
          .all()
          .map((row) => [row.name, row]),
      )
    : new Map<string, { name: string; display: string | null }>();
  return { masterNameBySub, masterRows };
}

/** Every TURD upgrade with its selectable sub-techs, the modules/recipes each
 * grants, and the current selection. */
export function listTurdUpgrades() {
  const masters = db
    .select()
    .from(technologies)
    .where(eq(technologies.isTurd, true))
    .orderBy(technologies.name)
    .all();
  const details = turdDetailsForMasters(masters);
  const scienceRows = masters.length
    ? db
        .select({
          technology: techIngredients.technology,
          name: techIngredients.name,
          amount: techIngredients.amount,
        })
        .from(techIngredients)
        .where(
          inArray(
            techIngredients.technology,
            masters.map((master) => master.name),
          ),
        )
        .all()
    : [];
  const scienceDisplays = componentDisplays(
    scienceRows.map((row) => ({ kind: "item", name: row.name })),
  );
  const scienceByMaster = new Map<string, { name: string; amount: number; display: string }[]>();
  for (const row of scienceRows) {
    const list = scienceByMaster.get(row.technology) ?? [];
    list.push({
      name: row.name,
      amount: row.amount,
      display: scienceDisplays.get(`item:${row.name}`) ?? row.name,
    });
    scienceByMaster.set(row.technology, list);
  }
  return details.map((detail) => ({
    name: detail.master,
    display: detail.masterDisplay,
    description: detail.description,
    science: scienceByMaster.get(detail.master) ?? [],
    subTechs: detail.choices.map(({ selected: _selected, ...choice }) => choice),
    selected: detail.selected,
  }));
}

/** One selectable TURD branch, fully described: the recipes it swaps (old→new) or
 * newly unlocks, its always-on modules, and its localised description. Shared by
 * the /turd board, the assistant's turdChoices tool, and recipeInfo. */
export type TurdChange = {
  from: string | null; // the base recipe this branch replaces, or null for a pure new unlock
  fromDisplay: string | null;
  to: string; // the recipe the branch grants
  toDisplay: string;
  // true when `to` crafts a building (a crafting machine). The choice's module is
  // inserted INTO that building to boost what it produces — it does NOT apply to the
  // building's own construction recipe, so throughput math must skip the bonus here.
  buildsBuilding: boolean;
};

function turdDetailsForMasters(masterRows: (typeof technologies.$inferSelect)[]) {
  const subTechsByMaster = turdSubTechsByMaster(masterRows.map((master) => master.name));
  const subTechs = [...new Set([...subTechsByMaster.values()].flat())];
  if (!subTechs.length) return [];
  const selections = getTurdSelections();
  const techRows = new Map(
    db
      .select()
      .from(technologies)
      .where(inArray(technologies.name, subTechs))
      .all()
      .map((tech) => [tech.name, tech]),
  );
  const modulesBySub = turdModulesBySub(subTechs);
  const moduleNamesBySub = new Map(
    [...modulesBySub].map(([sub, rows]) => [sub, new Set(rows.map((mod) => mod.name))]),
  );
  const unlockRows = db
    .select({ sub: techUnlocks.technology, recipe: techUnlocks.recipe })
    .from(techUnlocks)
    .where(inArray(techUnlocks.technology, subTechs))
    .all();
  const unlocksBySub = new Map<string, string[]>();
  for (const row of unlockRows) {
    if (moduleNamesBySub.get(row.sub)?.has(row.recipe)) continue;
    const list = unlocksBySub.get(row.sub) ?? [];
    list.push(row.recipe);
    unlocksBySub.set(row.sub, list);
  }
  const replacementRows = db
    .select()
    .from(turdReplacements)
    .where(inArray(turdReplacements.subTech, subTechs))
    .all();
  const oldBySubAndNew = new Map(
    replacementRows.map((row) => [`${row.subTech}\u0000${row.newRecipe}`, row.oldRecipe]),
  );
  const unlockRecipes = [...new Set([...unlocksBySub.values()].flat())];
  const recipeNames = [
    ...new Set([...unlockRecipes, ...replacementRows.map((row) => row.oldRecipe)]),
  ];
  const recipeDisplays = recipeNames.length
    ? new Map(
        db
          .select({ name: recipes.name, display: recipes.display })
          .from(recipes)
          .where(inArray(recipes.name, recipeNames))
          .all()
          .map((recipe) => [recipe.name, recipe.display]),
      )
    : new Map<string, string | null>();
  const buildingRecipes = unlockRecipes.length
    ? new Set(
        db
          .selectDistinct({ recipe: recipeProducts.recipe })
          .from(recipeProducts)
          .innerJoin(craftingMachines, eq(craftingMachines.name, recipeProducts.name))
          .where(inArray(recipeProducts.recipe, unlockRecipes))
          .all()
          .map((row) => row.recipe),
      )
    : new Set<string>();
  const buildChoice = (sub: string) => {
    const tech = techRows.get(sub);
    const mods = modulesBySub.get(sub) ?? [];
    const unlocks = unlocksBySub.get(sub) ?? [];
    const changes: TurdChange[] = unlocks.map((to) => {
      const from = oldBySubAndNew.get(`${sub}\u0000${to}`) ?? null;
      return {
        from,
        fromDisplay: from ? (recipeDisplays.get(from) ?? from) : null,
        to,
        toDisplay: recipeDisplays.get(to) ?? to,
        buildsBuilding: buildingRecipes.has(to),
      };
    });
    return {
      name: sub,
      display: tech?.display ?? sub,
      description: stripRichText(tech?.description),
      unlocks,
      changes,
      modules: mods.map((mod) => ({
        name: mod.name,
        effSpeed: mod.effSpeed,
        effProductivity: mod.effProductivity,
        effConsumption: mod.effConsumption,
      })),
    };
  };
  return masterRows.flatMap((master) => {
    const subs = subTechsByMaster.get(master.name) ?? [];
    if (!subs.length) return [];
    const selected = selections.get(master.name) ?? null;
    return [
      {
        master: master.name,
        masterDisplay: master.display ?? master.name,
        description: stripRichText(master.description),
        selected,
        choices: subs.map((sub) => {
          const choice = buildChoice(sub);
          return { ...choice, selected: choice.name === selected };
        }),
      },
    ];
  });
}

/** Full detail for one TURD master: every mutually-exclusive branch it offers,
 * each branch's description + changes + modules, and the current selection. Unlike
 * turdOpportunities/turdConsistency (which key off recipe *replacements*), this
 * walks the tech-prerequisite graph, so it also surfaces branches that unlock a
 * BRAND-NEW recipe rather than swapping an existing one. Returns null for a
 * non-TURD tech or a master with no selectable choices. */
export function turdMasterDetail(masterName: string) {
  const m = db.select().from(technologies).where(eq(technologies.name, masterName)).get();
  if (!m?.isTurd) return null;
  return turdDetailsForMasters([m])[0] ?? null;
}

/** Resolve TURD masters from a master tech name (or its sub-tech), a recipe, or a
 * good, and return full detail for each. Drives the assistant's turdChoices tool. */
export function turdChoicesLookup(opts: { master?: string; recipe?: string; good?: string }) {
  const direct = opts.master
    ? db.select().from(technologies).where(eq(technologies.name, opts.master)).get()
    : null;
  const goodRecipes: string[] = [];
  if (opts.good) {
    const seen = new Set<string>();
    for (const row of db
      .select({ recipe: recipeProducts.recipe })
      .from(recipeProducts)
      .where(eq(recipeProducts.name, opts.good))
      .all()) {
      if (!seen.has(row.recipe)) goodRecipes.push(row.recipe);
      seen.add(row.recipe);
    }
    for (const row of db
      .select({ recipe: recipeIngredients.recipe })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.name, opts.good))
      .all()) {
      if (!seen.has(row.recipe)) goodRecipes.push(row.recipe);
      seen.add(row.recipe);
    }
  }
  const recipeOrder = [...new Set([...(opts.recipe ? [opts.recipe] : []), ...goodRecipes])];
  const locksByRecipe = recipeLockStatesByRecipe(recipeOrder);
  const replacements = recipeOrder.length
    ? db
        .select()
        .from(turdReplacements)
        .where(inArray(turdReplacements.oldRecipe, recipeOrder))
        .all()
    : [];
  const replacementSubs = [...new Set(replacements.map((row) => row.subTech))];
  const possibleDirectSub = opts.master && !direct?.isTurd ? [opts.master] : [];
  const { masterNameBySub } = turdMasterRowsBySub([...possibleDirectSub, ...replacementSubs]);
  const masters = new Set<string>();
  if (opts.master) {
    if (direct?.isTurd) masters.add(opts.master);
    else {
      const master = masterNameBySub.get(opts.master); // maybe they passed a sub-tech name
      if (master) masters.add(master);
    }
  }
  const replacementsByRecipe = new Map<string, typeof replacements>();
  for (const row of replacements) {
    const rows = replacementsByRecipe.get(row.oldRecipe) ?? [];
    rows.push(row);
    replacementsByRecipe.set(row.oldRecipe, rows);
  }
  const appendRecipeMasters = (recipe: string) => {
    for (const unlock of locksByRecipe.get(recipe) ?? [])
      if (unlock.isTurdSub && unlock.master) masters.add(unlock.master);
    for (const row of replacementsByRecipe.get(recipe) ?? []) {
      const master = masterNameBySub.get(row.subTech);
      if (master) masters.add(master);
    }
  };
  if (opts.recipe) appendRecipeMasters(opts.recipe);
  for (const recipe of goodRecipes) appendRecipeMasters(recipe);
  if (!masters.size) return [];
  const rows = db
    .select()
    .from(technologies)
    .where(inArray(technologies.name, [...masters]))
    .all();
  const rowsByName = new Map(rows.map((row) => [row.name, row]));
  return turdDetailsForMasters(
    [...masters]
      .map((master) => rowsByName.get(master))
      .filter((row): row is typeof technologies.$inferSelect => !!row?.isTurd),
  );
}

/** The hidden modules a sub-tech's choice inserts (named <sub>-module[-mk0N]). */
function turdModulesOf(subTech: string) {
  return db
    .select()
    .from(modules)
    .where(
      sql`${modules.name} = ${subTech + "-module"} OR ${modules.name} LIKE ${subTech + "-module-mk0%"}`,
    )
    .all();
}

/** The master upgrade a TURD sub-tech belongs to (its non-gate prerequisite). */
function turdMasterOf(subTech: string): { name: string; display: string | null } | null {
  const pre = db
    .select({ prerequisite: techPrerequisites.prerequisite })
    .from(techPrerequisites)
    .where(eq(techPrerequisites.technology, subTech))
    .all()
    .map((r) => r.prerequisite)
    .find((p) => !p.startsWith("turd-select-"));
  if (!pre) return null;
  const t = db.select().from(technologies).where(eq(technologies.name, pre)).get();
  return { name: pre, display: t?.display ?? pre };
}

/** Which of these recipes are REPLACED by a currently-selected TURD choice —
 * in-game the old recipe disappears once the path is picked. */
export function turdSuperseded(recipeNames: string[]) {
  if (!recipeNames.length) return new Map<string, never>();
  const selected = new Set(getTurdSelections().values());
  if (!selected.size) return new Map<string, never>();
  const rows = db
    .select()
    .from(turdReplacements)
    .where(inArray(turdReplacements.oldRecipe, Array.from(new Set(recipeNames))))
    .all()
    .filter((r) => selected.has(r.subTech));
  return new Map(
    rows.map((r) => {
      const sub = db.select().from(technologies).where(eq(technologies.name, r.subTech)).get();
      const master = turdMasterOf(r.subTech);
      const newR = db.select().from(recipes).where(eq(recipes.name, r.newRecipe)).get();
      return [
        r.oldRecipe,
        {
          subTech: r.subTech,
          subDisplay: sub?.display ?? r.subTech,
          masterDisplay: master?.display ?? null,
          newRecipe: r.newRecipe,
          newDisplay: newR?.display ?? r.newRecipe,
        },
      ];
    }),
  );
}

/** TURD upgrades RELEVANT to a plan (a sub-choice would replace one of the plan's
 * recipes) that are available to pick RIGHT NOW (master researched) but NOT yet
 * picked. Drives the agent's end-of-plan "TURD opportunities" advice — surfaced,
 * never applied. Picked masters are locked (skipped); masters that still need
 * research are omitted (not available now). See [[turd-planning-model]]. */
export function turdOpportunities(planRecipes: string[]) {
  const planSet = new Set(planRecipes);
  if (!planSet.size) return [];
  const h = getResearchHorizon();
  const selections = getTurdSelections();
  const relevantReplacements = db
    .select()
    .from(turdReplacements)
    .where(inArray(turdReplacements.oldRecipe, [...planSet]))
    .all();
  const { masterNameBySub, masterRows } = turdMasterRowsBySub(
    relevantReplacements.map((row) => row.subTech),
  );
  // subs whose OLD recipe the plan uses → group under their (unpicked) master
  const byMaster = new Map<string, { display: string | null; replaced: Set<string> }>();
  for (const r of relevantReplacements) {
    const masterName = masterNameBySub.get(r.subTech);
    if (!masterName || selections.has(masterName)) continue; // picked = locked in stone
    const master = masterRows.get(masterName);
    const e = byMaster.get(masterName) ?? {
      display: master?.display ?? masterName,
      replaced: new Set<string>(),
    };
    e.replaced.add(r.oldRecipe);
    byMaster.set(masterName, e);
  }
  const subTechsByMaster = turdSubTechsByMaster([...byMaster.keys()]);
  const subTechs = [...new Set([...subTechsByMaster.values()].flat())];
  const replacementRows = subTechs.length
    ? db.select().from(turdReplacements).where(inArray(turdReplacements.subTech, subTechs)).all()
    : [];
  const replacementsBySub = new Map<string, typeof replacementRows>();
  for (const row of replacementRows) {
    const list = replacementsBySub.get(row.subTech) ?? [];
    list.push(row);
    replacementsBySub.set(row.subTech, list);
  }
  const probeByMaster = new Map<string, string>();
  for (const masterName of byMaster.keys()) {
    const probe = (subTechsByMaster.get(masterName) ?? [])
      .flatMap((sub) => replacementsBySub.get(sub) ?? [])
      .map((row) => row.newRecipe)[0];
    if (probe) probeByMaster.set(masterName, probe);
  }
  const recipeNames = [
    ...new Set([
      ...replacementRows.flatMap((row) => [row.oldRecipe, row.newRecipe]),
      ...relevantReplacements.map((row) => row.oldRecipe),
    ]),
  ];
  const recipeRows = recipeNames.length
    ? db
        .select({ name: recipes.name, display: recipes.display, enabled: recipes.enabled })
        .from(recipes)
        .where(inArray(recipes.name, recipeNames))
        .all()
    : [];
  const recipeByName = new Map(recipeRows.map((recipe) => [recipe.name, recipe]));
  const probeNames = [...new Set(probeByMaster.values())];
  const locksByRecipe = recipeLockStatesByRecipe(probeNames);
  const availability = computeAvailByRecipe(
    probeNames.map((name) => ({ name, enabled: recipeByName.get(name)?.enabled ?? false })),
    locksByRecipe,
    h,
    selections,
  );
  const techRows = subTechs.length
    ? new Map(
        db
          .select({ name: technologies.name, display: technologies.display })
          .from(technologies)
          .where(inArray(technologies.name, subTechs))
          .all()
          .map((tech) => [tech.name, tech]),
      )
    : new Map<string, { name: string; display: string | null }>();
  const modulesBySub = turdModulesBySub(subTechs);
  const recDisplay = (name: string) => recipeByName.get(name)?.display ?? name;
  const out = [];
  for (const [masterName, info] of byMaster) {
    const subs = subTechsByMaster.get(masterName) ?? [];
    // pickable-now gate: probe one branch recipe — reached AND turd 'pickable'
    // (master undecided) means it's a free choice the user could make right now.
    const probe = probeByMaster.get(masterName);
    if (!probe) continue;
    const avail = availability.get(probe)!;
    if (!avail.availableNow || avail.turd?.state !== "pickable") continue; // not pickable now
    const options = subs.map((sub) => {
      const tech = techRows.get(sub);
      const reps = replacementsBySub.get(sub) ?? [];
      return {
        sub,
        display: tech?.display ?? sub,
        replaces: reps.slice(0, 6).map((rp) => ({
          recipe: recDisplay(rp.oldRecipe),
          with: recDisplay(rp.newRecipe),
        })),
        moreReplacements: reps.length > 6 ? reps.length - 6 : undefined,
        modules: (modulesBySub.get(sub) ?? []).map((m) => ({
          name: m.name,
          speed: m.effSpeed,
          productivity: m.effProductivity,
          consumption: m.effConsumption,
        })),
      };
    });
    out.push({
      master: masterName,
      masterDisplay: info.display,
      wouldReplace: [...info.replaced].map(recDisplay),
      options,
    });
  }
  return out;
}

export function getTurdSelections(): Map<string, string> {
  return new Map(
    db
      .select()
      .from(turdSelections)
      .all()
      .map((s) => [s.masterTech, s.subTech]),
  );
}

export function setTurdSelection(masterTech: string, subTech: string | null): boolean {
  const current = getTurdSelections().get(masterTech) ?? null;
  if (current === subTech) return false;
  // Advance first: a failure after this point leaves projections conservatively
  // stale, never falsely current under a changed global solve context.
  bumpSolveGeneration();
  if (subTech == null) {
    db.delete(turdSelections).where(eq(turdSelections.masterTech, masterTech)).run();
  } else {
    db.insert(turdSelections)
      .values({ masterTech, subTech })
      .onConflictDoUpdate({
        target: turdSelections.masterTech,
        set: { subTech, updatedAt: new Date() },
      })
      .run();
  }
  return true;
}

/** Replace ALL TURD selections with a pushed set (from the game bridge). Only
 * (master, sub) pairs that exist in our model are applied; unknown ones are
 * reported (a name mismatch between runtime and the dumped data). To avoid wiping
 * good data on a total mismatch, a non-empty push that matches NOTHING is treated
 * as a mismatch and left alone. Reports whether anything actually changed so the
 * caller can skip a needless re-solve. */
export function setTurdSelectionsBulk(selections: Record<string, string>): {
  applied: number;
  changed: boolean;
  mismatch: boolean;
  unknown: { master: string; sub: string }[];
} {
  const valid: { master: string; sub: string }[] = [];
  const unknown: { master: string; sub: string }[] = [];
  for (const [master, sub] of Object.entries(selections)) {
    const isMaster =
      db
        .select({ n: sql<number>`count(*)` })
        .from(technologies)
        .where(and(eq(technologies.name, master), eq(technologies.isTurd, true)))
        .get()!.n > 0;
    if (isMaster && turdSubTechs(master).includes(sub)) valid.push({ master, sub });
    else unknown.push({ master, sub });
  }
  const mismatch = Object.keys(selections).length > 0 && valid.length === 0;

  const before = getTurdSelections();
  const after = new Map(valid.map((v) => [v.master, v.sub]));
  const changed =
    !mismatch && (before.size !== after.size || [...after].some(([m, s]) => before.get(m) !== s));

  if (!mismatch && changed) {
    bumpSolveGeneration();
    db.transaction((tx) => {
      tx.delete(turdSelections).run();
      for (const { master, sub } of valid)
        tx.insert(turdSelections).values({ masterTech: master, subTech: sub }).run();
    });
  }
  return { applied: valid.length, changed, mismatch, unknown };
}

/** All hidden TURD modules granted by the CURRENT selections — what computeBlock
 * applies to matching machines (category + mk-tier match). */
export function activeTurdModules(): ModuleRow[] {
  const selected = [...getTurdSelections().values()];
  return selected.flatMap((sub) => turdModulesOf(sub));
}

/* Module/beacon presets (saved loadouts). Name order is also the auto-apply
 * precedence: the FIRST compatible default preset wins (see
 * server/module-presets.server.ts). */
export function listModulePresets() {
  return db.select().from(modulePresets).orderBy(modulePresets.name).all();
}
export function saveModulePreset(
  name: string,
  moduleList: string[],
  beaconList: BeaconConfig[],
  icon: string | null = null,
) {
  return db
    .insert(modulePresets)
    .values({ name, modules: moduleList, beacons: beaconList, icon })
    .returning({ id: modulePresets.id })
    .get().id;
}
export function deleteModulePreset(id: number) {
  db.delete(modulePresets).where(eq(modulePresets.id, id)).run();
}
/** Mark/unmark a preset as a default for new rows; returns its name (null if
 * the id vanished). Multiple defaults may coexist — compatibility decides. */
export function setModulePresetDefault(id: number, isDefault: boolean): string | null {
  const row = db
    .update(modulePresets)
    .set({ isDefault })
    .where(eq(modulePresets.id, id))
    .returning({ name: modulePresets.name })
    .get();
  return row?.name ?? null;
}

/* ── User blocks (persistence) ──────────────────────────────────────────────── */

/** A block's health for the sidebar/tabs, derived without re-solving:
 *  - `error` (red): a referenced recipe/good vanished (broken), or the last solve
 *    was infeasible — the block won't work as-is.
 *  - `warn` (amber): a declared goal has no recipe making it yet (unfinished), or
 *    the last solve was relaxed/underdetermined — fixable, not broken.
 *  - `ok`: last solve clean and every goal has a producer. */
export type BlockHealth = "ok" | "warn" | "error";

export function listBlocks() {
  const rows = db
    .select({
      id: blocks.id,
      name: blocks.name,
      iconKind: blocks.iconKind,
      iconName: blocks.iconName,
      electricityW: blocks.electricityW,
      pollutionPerMin: blocks.pollutionPerMin,
      solveStatus: blocks.solveStatus,
      dataFingerprint: blocks.dataFingerprint,
      enabled: blocks.enabled, // whole-block toggle (#73) — for sidebar dimming
      groupId: blocks.groupId,
      updatedAt: blocks.updatedAt,
      data: blocks.data,
    })
    .from(blocks)
    .orderBy(blocks.sortOrder, blocks.name)
    .all();
  const documents = rows.map((row) => normalizeBlockData(row.data as BlockData));
  const solveGeneration = currentSolveGeneration();
  const referencedRecipes = [
    ...new Set(documents.flatMap((document) => document.recipes ?? []).filter(Boolean)),
  ];
  const referencedGoods = [...new Set(documents.flatMap((document) => goalNames(document)))];
  // Health is derived from `data` against the CURRENT reference data (so an item
  // migration shows up immediately, no re-solve) plus the persisted last solve
  // status. Query only references named by saved block documents instead of
  // scanning the entire Factorio data set; `data` stays server-side and only the
  // verdict is exposed.
  const recipeNames = new Set(
    referencedRecipes.length
      ? db
          .select({ n: recipes.name })
          .from(recipes)
          .where(inArray(recipes.name, referencedRecipes))
          .all()
          .map((r) => r.n)
      : [],
  );
  const goodNames = new Set([
    ...(referencedGoods.length
      ? db
          .select({ n: items.name })
          .from(items)
          .where(inArray(items.name, referencedGoods))
          .all()
          .map((r) => r.n)
      : []),
    ...(referencedGoods.length
      ? db
          .select({ n: fluids.name })
          .from(fluids)
          .where(inArray(fluids.name, referencedGoods))
          .all()
          .map((r) => r.n)
      : []),
  ]);
  // recipe → its product good names, for the "no recipe in the block makes this
  // goal" check (one scan of recipe_products, grouped).
  const productsByRecipe = new Map<string, Set<string>>();
  const referencedProducts = referencedRecipes.length
    ? db
        .select({ recipe: recipeProducts.recipe, name: recipeProducts.name })
        .from(recipeProducts)
        .where(inArray(recipeProducts.recipe, referencedRecipes))
        .all()
    : [];
  for (const p of referencedProducts) {
    let set = productsByRecipe.get(p.recipe);
    if (!set) productsByRecipe.set(p.recipe, (set = new Set()));
    set.add(p.name);
  }
  // recipe → its ingredient good names, for the "can this recipe reach a goal?"
  // check that mirrors the solver's unused-recipe pinning.
  const ingredientsByRecipe = new Map<string, Set<string>>();
  const referencedIngredients = referencedRecipes.length
    ? db
        .select({ recipe: recipeIngredients.recipe, name: recipeIngredients.name })
        .from(recipeIngredients)
        .where(inArray(recipeIngredients.recipe, referencedRecipes))
        .all()
    : [];
  for (const p of referencedIngredients) {
    let set = ingredientsByRecipe.get(p.recipe);
    if (!set) ingredientsByRecipe.set(p.recipe, (set = new Set()));
    set.add(p.name);
  }
  return rows.map(({ data: _data, dataFingerprint, solveStatus, ...b }, index) => {
    const d = documents[index];
    const stale = !isSolveFingerprintForGeneration(dataFingerprint, solveGeneration);
    const blockRecipes = d.recipes ?? [];
    const broken =
      blockRecipes.some((r) => !recipeNames.has(r)) || goalNames(d).some((g) => !goodNames.has(g));
    // A goal is "unmet" when it still exists but nothing in the block satisfies
    // it. Direction depends on the goal: a produce goal (rate ≥ 0, incl.
    // keep-in-stock) needs a recipe that MAKES it; a SINK goal (rate < 0,
    // "consume N/s" — e.g. a kerogen-disposal block) needs a recipe that
    // CONSUMES it. Flagging a sink by "no producer" is wrong — it never has one.
    const makesInBlock = new Set<string>();
    const consumesInBlock = new Set<string>();
    for (const r of blockRecipes) {
      for (const p of productsByRecipe.get(r) ?? []) makesInBlock.add(p);
      for (const i of ingredientsByRecipe.get(r) ?? []) consumesInBlock.add(i);
    }
    const seenGoal = new Set<string>();
    const unmadeGoals: string[] = [];
    for (const g of d.goals ?? []) {
      if (!g.name || seenGoal.has(g.name) || !goodNames.has(g.name)) continue;
      seenGoal.add(g.name);
      const satisfied = (g.rate ?? 0) < 0 ? consumesInBlock.has(g.name) : makesInBlock.has(g.name);
      if (!satisfied) unmadeGoals.push(g.name);
    }
    // NB: a made mark with no producer is NOT a health problem (#91 nitpick) — it
    // degrades silently to an import in the solve, so it doesn't tint the block.
    const health: BlockHealth =
      broken || solveStatus === "infeasible" || solveStatus === "error"
        ? "error"
        : stale ||
            unmadeGoals.length > 0 ||
            // stale pre-v2 statuses: the block re-solves (and re-caches) on open
            solveStatus === "relaxed" ||
            solveStatus === "underdetermined"
          ? "warn"
          : "ok";
    return {
      ...b,
      broken,
      stale,
      health,
      unmadeGoals,
      // for the delete-block confirm (#83): what the deletion would destroy
      recipeCount: blockRecipes.length,
      goalCount: goalNames(d).length,
    };
  });
}

/* Folders (block groups). */
export function listGroups() {
  return db.select().from(blockGroups).orderBy(blockGroups.sortOrder, blockGroups.name).all();
}
export function createGroup(name: string) {
  return db.insert(blockGroups).values({ name }).returning({ id: blockGroups.id }).get().id;
}
export function renameGroup(id: number, name: string) {
  db.update(blockGroups).set({ name }).where(eq(blockGroups.id, id)).run();
}
/** Re-parent a folder (null = top level). Returns false without changing anything if
 * the move would create a cycle (the new parent is the folder itself or one of its
 * descendants). */
export function setGroupParent(id: number, parentId: number | null): boolean {
  if (parentId === id) return false;
  if (parentId != null) {
    const parentOf = new Map(
      db
        .select({ id: blockGroups.id, parentId: blockGroups.parentId })
        .from(blockGroups)
        .all()
        .map((g) => [g.id, g.parentId]),
    );
    for (let cur: number | null | undefined = parentId; cur != null; cur = parentOf.get(cur))
      if (cur === id) return false; // parentId is a descendant of id → cycle
  }
  db.update(blockGroups).set({ parentId }).where(eq(blockGroups.id, id)).run();
  return true;
}
export function deleteGroup(id: number) {
  // Children move up one level to this folder's parent (blocks via groupId, subfolders
  // via parentId) rather than all dumping to the root.
  const parent =
    db
      .select({ parentId: blockGroups.parentId })
      .from(blockGroups)
      .where(eq(blockGroups.id, id))
      .get()?.parentId ?? null;
  db.transaction((tx) => {
    tx.update(blocks).set({ groupId: parent }).where(eq(blocks.groupId, id)).run();
    tx.update(blockGroups).set({ parentId: parent }).where(eq(blockGroups.parentId, id)).run();
    tx.delete(blockGroups).where(eq(blockGroups.id, id)).run();
  });
}
export function setBlockGroup(blockId: number, groupId: number | null) {
  db.update(blocks).set({ groupId }).where(eq(blocks.id, blockId)).run();
}
/** Toggle a whole block on/off (#73). Disabled blocks still open and solve for
 * editing but are excluded from every factory-wide rollup and dimmed in the sidebar. */
export function setBlockEnabled(blockId: number, enabled: boolean) {
  db.update(blocks).set({ enabled }).where(eq(blocks.id, blockId)).run();
}
/** Persist a manual block order: write sort_order = position for each id (pass a
 * group's blocks in the desired order). listBlocks reads sort_order first. */
export function setBlockOrder(ids: number[]) {
  const positions = new Map(ids.map((id, index) => [id, index]));
  if (!positions.size) return;
  const cases = sql.join(
    [...positions].map(([id, index]) => sql`WHEN ${id} THEN ${index}`),
    sql` `,
  );
  db.run(sql`
    UPDATE blocks
    SET sort_order = CASE id ${cases} ELSE sort_order END
    WHERE id IN (${sql.join([...positions.keys()], sql`, `)})
  `);
}
/** Persist a manual folder order (block_groups.sort_order = position). */
export function setGroupOrder(ids: number[]) {
  const positions = new Map(ids.map((id, index) => [id, index]));
  if (!positions.size) return;
  const cases = sql.join(
    [...positions].map(([id, index]) => sql`WHEN ${id} THEN ${index}`),
    sql` `,
  );
  db.run(sql`
    UPDATE block_groups
    SET sort_order = CASE id ${cases} ELSE sort_order END
    WHERE id IN (${sql.join([...positions.keys()], sql`, `)})
  `);
}

export function getBlock(id: number) {
  const row = db.select().from(blocks).where(eq(blocks.id, id)).get() ?? null;
  // Migrate the legacy { target, rate, extraGoals } shape on read so every consumer
  // (editor hydrate, re-solve, scale tools) sees the current goals[] model.
  return row ? { ...row, data: normalizeBlockData(row.data) } : null;
}

/** Cached solved I/O for one block (the last-saved flows). */
export function getBlockFlows(id: number) {
  return db
    .select({
      item: blockFlows.item,
      kind: blockFlows.kind,
      role: blockFlows.role,
      rate: blockFlows.rate,
    })
    .from(blockFlows)
    .where(eq(blockFlows.blockId, id))
    .all();
}

/** Whether a recipe still exists in the current reference data (for staleness). */
export function recipeExists(name: string): boolean {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(recipes)
      .where(eq(recipes.name, name))
      .get()!.n > 0
  );
}

/** Whether a good (item OR fluid) still exists — for goal staleness. */
export function goodExists(name: string): boolean {
  if (db.select({ n: items.name }).from(items).where(eq(items.name, name)).get()) return true;
  return !!db.select({ n: fluids.name }).from(fluids).where(eq(fluids.name, name)).get();
}

/** A block's references that no longer exist in the current reference data: the
 * recipes it runs and the goal goods (target + co-products) it produces. A block
 * with any of these is "broken" — it must not be re-solved (the missing recipe
 * would be silently dropped and the block would re-solve to wrong rates). */
export function blockMissingRefs(data: BlockData): { recipes: string[]; goods: string[] } {
  return {
    recipes: [...new Set(data.recipes ?? [])].filter((r) => !recipeExists(r)),
    goods: goalNames(normalizeBlockData(data)).filter((g) => !goodExists(g)),
  };
}

/** Compact content signature of one recipe AS IT EXISTS NOW — its kind/category/
 * timing/productivity flag plus its ingredient and product rows. Changes whenever
 * a mod update alters the recipe in place (not just when it's added/removed). */
function recipeSignature(name: string): string {
  const r = db
    .select({
      kind: recipes.kind,
      category: recipes.category,
      energyRequired: recipes.energyRequired,
      enabled: recipes.enabled,
      allowProductivity: recipes.allowProductivity,
    })
    .from(recipes)
    .where(eq(recipes.name, name))
    .get();
  if (!r) return "!"; // gone — a distinct, stable marker
  const ings = db
    .select({
      kind: recipeIngredients.kind,
      name: recipeIngredients.name,
      amount: recipeIngredients.amount,
      minTemp: recipeIngredients.minTemp,
      maxTemp: recipeIngredients.maxTemp,
    })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipe, name))
    .orderBy(recipeIngredients.idx)
    .all();
  const prods = db
    .select({
      kind: recipeProducts.kind,
      name: recipeProducts.name,
      amount: recipeProducts.amount,
      amountMin: recipeProducts.amountMin,
      amountMax: recipeProducts.amountMax,
      probability: recipeProducts.probability,
      temperature: recipeProducts.temperature,
      ignoredByProductivity: recipeProducts.ignoredByProductivity,
    })
    .from(recipeProducts)
    .where(eq(recipeProducts.recipe, name))
    .orderBy(recipeProducts.idx)
    .all();
  return JSON.stringify([r, ings, prods]);
}

/** Per-block fingerprint over the CURRENT definitions of the prototypes a block
 * references (its recipes + goal goods), not the global enabled-mod-name hash. So
 * an in-place mod update or a vanished recipe registers as staleness for exactly
 * the blocks that touch it, instead of being invisible. Stored on the block at
 * save time; a mismatch on a later check means the block's own inputs changed. */
/** Bumped when solver semantics change — folded into the reference fingerprint
 * so every cache from an older solver reads stale and re-solves on first touch. */
const SOLVER_VERSION = "sv4";

export function blockReferenceFingerprint(data: BlockData): string {
  const parts: string[] = [`S ${SOLVER_VERSION}`];
  for (const name of [...new Set(data.recipes ?? [])].sort())
    parts.push(`R ${name} ${recipeSignature(name)}`);
  for (const g of goalNames(normalizeBlockData(data)).sort())
    parts.push(`G ${g} ${goodExists(g) ? "1" : "0"}`);
  const content = createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
  return stampSolveFingerprint(content);
}

export function deleteBlock(id: number) {
  db.delete(blockFlows).where(eq(blockFlows.blockId, id)).run();
  db.delete(blockMachines).where(eq(blockMachines.blockId, id)).run();
  db.delete(blocks).where(eq(blocks.id, id)).run();
}

export type BlockFlow = { item: string; kind: string; role: string; rate: number };
export type BlockMachine = { machine: string; recipe: string; count: number };
/** Insert or update a block + replace its cached I/O flows (one transaction).
 *
 * Passing `null` for `flows`/`machines`/`electricityW` PRESERVES the existing
 * cached values rather than overwriting them — used when a block is broken (a
 * referenced recipe/good vanished): its input doc + fingerprint are persisted,
 * but the last-good solved I/O is kept so the factory aggregates don't go wrong
 * and re-enabling the mod restores the block unchanged. */
export function saveBlockRow(
  input: {
    id?: number | null;
    name: string;
    iconKind: string | null;
    iconName: string | null;
    data: BlockData;
    electricityW: number | null;
    pollutionPerMin?: number | null;
    dataFingerprint?: string | null;
    solveStatus?: string | null;
    /** IIS cards from an infeasible solve; null clears (solved); undefined keeps */
    solveDiagnosis?: unknown[] | null;
  },
  flows: BlockFlow[] | null,
  machines: BlockMachine[] | null = [],
): number {
  return db.transaction((tx) => {
    let id = input.id ?? undefined;
    const values = {
      name: input.name,
      iconKind: input.iconKind,
      iconName: input.iconName,
      data: input.data,
      // null = keep the current electricity figure (broken block, cache preserved)
      ...(input.electricityW != null ? { electricityW: input.electricityW } : {}),
      ...(input.pollutionPerMin != null ? { pollutionPerMin: input.pollutionPerMin } : {}),
      // undefined = leave the stored status untouched (broken block); null clears it
      ...(input.solveStatus !== undefined ? { solveStatus: input.solveStatus } : {}),
      ...(input.solveDiagnosis !== undefined
        ? { solveDiagnosis: input.solveDiagnosis as never }
        : {}),
      ...(input.dataFingerprint !== undefined ? { dataFingerprint: input.dataFingerprint } : {}),
    };
    if (id != null) {
      tx.update(blocks)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(blocks.id, id))
        .run();
    } else {
      id = tx.insert(blocks).values(values).returning({ id: blocks.id }).get().id;
    }
    if (flows != null) {
      tx.delete(blockFlows).where(eq(blockFlows.blockId, id)).run();
      if (flows.length)
        tx.insert(blockFlows)
          .values(flows.map((f) => ({ blockId: id!, ...f })))
          .run();
    }
    if (machines != null) {
      tx.delete(blockMachines).where(eq(blockMachines.blockId, id)).run();
      if (machines.length)
        tx.insert(blockMachines)
          .values(machines.map((m) => ({ blockId: id!, ...m })))
          .run();
    }
    return id;
  });
}

/** Every block with its current target rate and cached boundary flows — the input
 * to the factory-level what-if solve (each block becomes a fixed-ratio super-recipe). */
export function blocksWithFlows(): {
  id: number;
  name: string;
  rate: number;
  priority?: number;
  goals: { name: string; rate: number; stock?: boolean }[];
  flows: (BlockFlow & { priority?: number })[];
}[] {
  const bs = db
    .select()
    .from(blocks)
    .where(eq(blocks.enabled, true)) // disabled blocks (#73) sit out the factory what-if
    .orderBy(blocks.sortOrder, blocks.name)
    .all();
  const flowsByBlock = enabledFlowsByBlock();
  return bs.map((b) => {
    const data = normalizeBlockData(b.data);
    const blockPriority = data.supplyPriority ?? 0;
    return {
      id: b.id,
      name: b.name,
      rate: primaryRate(data),
      goals: data.goals.map((goal) => ({
        name: goal.name,
        rate: goal.rate,
        ...(goal.stock != null ? { stock: true } : {}),
      })),
      priority: blockPriority,
      flows: (flowsByBlock.get(b.id) ?? []).map((flow) => ({
        ...flow,
        priority: data.supplyPriorities?.[flow.item] ?? blockPriority,
      })),
    };
  });
}

/** Aggregate net production across all blocks — the factory over/under view. */
/** Existing blocks with what each produces (primary), has spare (byproducts),
 * and imports — the factory context the planner consults to reuse blocks. */
export function factoryBlocks() {
  const bs = db
    .select({ id: blocks.id, name: blocks.name })
    .from(blocks)
    .where(eq(blocks.enabled, true)) // disabled blocks (#73) don't count factory-wide
    .orderBy(blocks.sortOrder, blocks.name)
    .all();
  const flowsByBlock = enabledFlowsByBlock();
  return bs.map((b) => {
    const flows = flowsByBlock.get(b.id) ?? [];
    const pick = (roles: string[]) =>
      flows
        .filter((f) => roles.includes(f.role))
        .map((f) => ({
          item: f.item,
          kind: f.kind,
          rate: f.rate,
          // stock-goal refill demand (#38), not continuous throughput
          ...(f.role === "stock" ? { stock: true as const } : {}),
        }));
    return {
      id: b.id,
      name: b.name,
      makes: pick(["primary", "stock"]),
      byproducts: pick(["byproduct"]),
      imports: pick(["import"]),
    };
  });
}

/** Load cached flows for every enabled block in one statement. Keeping the
 * enabled filter in SQLite avoids both N+1 reads and an unbounded IN-list. */
function enabledFlowsByBlock(): Map<number, BlockFlow[]> {
  const rows = db
    .select({
      blockId: blockFlows.blockId,
      item: blockFlows.item,
      kind: blockFlows.kind,
      role: blockFlows.role,
      rate: blockFlows.rate,
    })
    .from(blockFlows)
    .innerJoin(blocks, eq(blockFlows.blockId, blocks.id))
    .where(eq(blocks.enabled, true))
    .all();
  const grouped = new Map<number, BlockFlow[]>();
  for (const { blockId, ...flow } of rows) {
    const flows = grouped.get(blockId) ?? [];
    flows.push(flow);
    grouped.set(blockId, flows);
  }
  return grouped;
}

/** Spoilage: what a good rots into and how fast. A fast-spoiling good can't be
 * imported from a distant block — it must be built local. null = doesn't spoil. */
export function goodSpoilage(name: string): { into: string; seconds: number } | null {
  const it = db
    .select({ s: items.spoilResult, t: items.spoilTicks })
    .from(items)
    .where(eq(items.name, name))
    .get();
  if (it?.s) return { into: it.s, seconds: Math.round((it.t ?? 0) / 60) };
  return null;
}

/** Spoil-time cutoff (seconds): a good that rots faster than this can't realistically
 * be imported across the factory — build it local. User setting; default 5 min. */
export function spoilImportCutoff(): number {
  const v = db
    .select({ v: meta.value })
    .from(meta)
    .where(eq(meta.key, "spoil_import_cutoff_sec"))
    .get()?.v;
  return v ? Number(v) : 300;
}

/** Existing blocks that IMPORT a good — potential sinks to route a byproduct to. */
export function blockImporters(good: string): { blockId: number; blockName: string }[] {
  return db
    .select({ blockId: blockFlows.blockId, name: blocks.name })
    .from(blockFlows)
    .innerJoin(blocks, eq(blocks.id, blockFlows.blockId))
    .where(and(eq(blockFlows.item, good), eq(blockFlows.role, "import"), eq(blocks.enabled, true)))
    .all()
    .map((r) => ({ blockId: r.blockId, blockName: r.name }));
}

/** Drill-down for one good in the factory view: which blocks produce it (primary
 * or byproduct) and which consume it (import), each with its per-second rate.
 * Drives "click a resource → see who makes/uses it + make a new block for it". */
export function blocksForGood(good: string) {
  const rows = db
    .select({
      blockId: blockFlows.blockId,
      name: blocks.name,
      iconKind: blocks.iconKind,
      iconName: blocks.iconName,
      role: blockFlows.role,
      rate: blockFlows.rate,
    })
    .from(blockFlows)
    .innerJoin(blocks, eq(blocks.id, blockFlows.blockId))
    .where(and(eq(blockFlows.item, good), eq(blocks.enabled, true)))
    .all();
  const shape = (r: (typeof rows)[number]) => ({
    blockId: r.blockId,
    blockName: r.name,
    iconKind: r.iconKind,
    iconName: r.iconName,
    role: r.role,
    rate: r.rate,
  });
  return {
    good,
    display: getItem(good)?.display ?? getFluid(good)?.display ?? null,
    producers: rows
      .filter((r) => r.role === "primary" || r.role === "stock" || r.role === "byproduct")
      .map(shape),
    consumers: rows.filter((r) => r.role === "import").map(shape),
  };
}

/** Which goods in a block's import list are produced by some OTHER enabled
 * block. Batched for the block editor so it never issues one query per chip. */
export function producedGoodsOutsideBlock(goods: string[], blockId: number): string[] {
  const unique = [...new Set(goods)];
  if (unique.length === 0) return [];
  return db
    .selectDistinct({ item: blockFlows.item })
    .from(blockFlows)
    .innerJoin(blocks, eq(blocks.id, blockFlows.blockId))
    .where(
      and(
        inArray(blockFlows.item, unique),
        inArray(blockFlows.role, ["primary", "stock", "byproduct"]),
        ne(blockFlows.blockId, blockId),
        eq(blocks.enabled, true),
      ),
    )
    .all()
    .map((row) => row.item);
}

/** Factory coherence: the block-to-block wiring. Every good that crosses a block
 * boundary, grouped into (a) LINKS — produced by some block AND imported by
 * another (an internal seam, with the per-good production vs consumption balance),
 * (b) UNSOURCED — imported but no block produces it (a raw to supply, or a block
 * you still need to build), and (c) SURPLUS — produced but no block consumes it
 * (a final output, or waste to route). Drives the wiring view. */
export function factoryCoherence() {
  const rows = db
    .select({
      blockId: blockFlows.blockId,
      blockName: blocks.name,
      item: blockFlows.item,
      kind: blockFlows.kind,
      role: blockFlows.role,
      rate: blockFlows.rate,
    })
    .from(blockFlows)
    .innerJoin(blocks, eq(blocks.id, blockFlows.blockId))
    .where(eq(blocks.enabled, true)) // disabled blocks (#73) don't wire into coherence
    .all();

  type End = { blockId: number; blockName: string; rate: number; role: string };
  const goods = new Map<string, { kind: string; producers: End[]; consumers: End[] }>();
  for (const r of rows) {
    const g = goods.get(r.item) ?? { kind: r.kind, producers: [], consumers: [] };
    const end = { blockId: r.blockId, blockName: r.blockName, rate: r.rate, role: r.role };
    if (r.role === "import") g.consumers.push(end);
    else g.producers.push(end); // primary | byproduct
    goods.set(r.item, g);
  }

  const sum = (xs: End[]) => xs.reduce((s, x) => s + x.rate, 0);
  const links = [];
  const unsourced = [];
  const surplus = [];
  for (const [good, g] of goods) {
    const produced = +sum(g.producers).toFixed(3);
    const consumed = +sum(g.consumers).toFixed(3);
    const base = {
      good,
      display: getItem(good)?.display ?? getFluid(good)?.display ?? null,
      kind: g.kind,
      producers: g.producers.sort((a, b) => b.rate - a.rate),
      consumers: g.consumers.sort((a, b) => b.rate - a.rate),
      produced,
      consumed,
      net: +(produced - consumed).toFixed(3),
    };
    if (g.producers.length && g.consumers.length) links.push(base);
    else if (g.consumers.length)
      unsourced.push({ ...base, craftable: recipesProducing(good).length > 0 });
    else surplus.push(base);
  }
  links.sort((a, b) => a.net - b.net); // worst shortfalls first
  unsourced.sort((a, b) => b.consumed - a.consumed);
  surplus.sort((a, b) => b.produced - a.produced);
  return { links, unsourced, surplus };
}

/** Electricity pseudo-good name (see synthesize.ts's ELECTRICITY const) —
 * literal here rather than a shared import, matching the local-constant style
 * already used in coherence-audit.server.ts (AUDIT_FREE) and
 * agent-tools.server.ts (POWER_PSEUDO). */
const ELECTRICITY = "pyops-electricity";

/** Factory-wide ELECTRIC power rollup (#129), per enabled block: cached
 * consumption (`electricityW` — the same cache the Factory page's header sums,
 * see routes/factory.tsx's totalPowerW — no re-solve) and generation.
 *
 * A block's net PRODUCTION of the `pyops-electricity` pseudo-good is already
 * tracked in `block_flows` from its last real solve — a `kind: "generating"`
 * recipe (turbine/generator/solar-panel/burner-generator, see synthesize.ts)
 * nets a positive export there as a PRODUCER-end row (role "primary" / "stock"
 * / "byproduct" — never "import"). So a generator block is identifiable today
 * with no new convention: just read the flow that already exists. Flow rates
 * for this pseudo-good are stored in MW (1 unit = 1 MJ); electricityW is
 * Watts, so generation is scaled ×1e6 to match.
 *
 * consumesW and generatesW are computed INDEPENDENTLY per block (electricityW
 * is gross internal machine draw; generatesW is the net declared/exported
 * production) — a block can be nonzero in both (e.g. a reactor block that
 * draws power for its own auxiliary machines while its reactor recipe nets a
 * declared export). Do not net them per block; only the factory-wide totals
 * are meaningful to compare. */
export function factoryPower(): {
  blockId: number;
  name: string;
  consumesW: number;
  generatesW: number;
}[] {
  const bs = db
    .select({ id: blocks.id, name: blocks.name, electricityW: blocks.electricityW })
    .from(blocks)
    .where(eq(blocks.enabled, true)) // disabled blocks (#73) don't count factory-wide
    .orderBy(blocks.sortOrder, blocks.name)
    .all();
  const gen = new Map<number, number>();
  for (const f of db
    .select({ blockId: blockFlows.blockId, role: blockFlows.role, rate: blockFlows.rate })
    .from(blockFlows)
    .innerJoin(blocks, eq(blocks.id, blockFlows.blockId))
    .where(and(eq(blockFlows.item, ELECTRICITY), eq(blocks.enabled, true)))
    .all()) {
    if (f.role === "import") continue; // consumer end — not generation
    gen.set(f.blockId, (gen.get(f.blockId) ?? 0) + f.rate * 1e6); // MW -> W
  }
  return bs.map((b) => ({
    blockId: b.id,
    name: b.name,
    consumesW: b.electricityW ?? 0,
    generatesW: gen.get(b.id) ?? 0,
  }));
}

/** Fuel options for a recipe's burner machines, each with its ash (burntResult)
 * and energy. null when the recipe runs on electric machines (no fuel choice). */
export function fuelOptionsForRecipe(recipeName: string) {
  const burners = machinesForRecipe(recipeName).filter((m) => m.fuelCategories.length > 0);
  if (!burners.length) return null;
  const cats = Array.from(new Set(burners.flatMap((m) => m.fuelCategories)));
  const fuels = fuelsForCategories(cats).map((f) => ({
    fuel: f.name,
    ash: f.burntResult ?? null, // ash-producing if non-null
    mj: f.fuelValueJ ? +(f.fuelValueJ / 1e6).toFixed(2) : null,
  }));
  return { categories: cats, fuels };
}

/** good -> existing blocks that already output it (primary or byproduct) — the
 * reuse/seam signal: if a block already makes a good, import it from there. */
export function goodSuppliers(): Map<
  string,
  { blockId: number; blockName: string; role: string }[]
> {
  const rows = db
    .select({
      item: blockFlows.item,
      role: blockFlows.role,
      blockId: blockFlows.blockId,
      name: blocks.name,
    })
    .from(blockFlows)
    .innerJoin(blocks, eq(blocks.id, blockFlows.blockId))
    .where(
      and(inArray(blockFlows.role, ["primary", "stock", "byproduct"]), eq(blocks.enabled, true)),
    )
    .all();
  const m = new Map<string, { blockId: number; blockName: string; role: string }[]>();
  for (const r of rows) {
    const arr = m.get(r.item) ?? [];
    arr.push({ blockId: r.blockId, blockName: r.name, role: r.role });
    m.set(r.item, arr);
  }
  return m;
}

export function factoryTotals() {
  return db
    .select({
      item: blockFlows.item,
      kind: blockFlows.kind,
      role: blockFlows.role,
      rate: sql<number>`sum(${blockFlows.rate})`,
    })
    .from(blockFlows)
    .innerJoin(blocks, eq(blocks.id, blockFlows.blockId)) // ignore orphans from deleted blocks
    .where(eq(blocks.enabled, true)) // disabled blocks (#73) don't count factory-wide
    .groupBy(blockFlows.item, blockFlows.role)
    .all()
    .map((r) => ({ ...r, display: compDisplay(r.kind, r.item) }));
}

/* ── Built machines (live count from the game) vs. what blocks require ────────── */

/** Replace the stored built-machine counts with a fresh snapshot from the game.
 * Authoritative — drops anything not in the snapshot. Reports whether it changed
 * (so the caller can skip needless re-renders) and how many entries landed. */
export function setBuiltMachines(entries: { machine: string; recipe: string; count: number }[]): {
  applied: number;
  total: number;
  changed: boolean;
} {
  // merge any duplicate (machine, recipe) pairs and drop empties
  const merged = new Map<string, { name: string; recipe: string; count: number }>();
  for (const e of entries) {
    const count = Math.max(0, Math.round(e.count));
    if (count <= 0) continue;
    const recipe = e.recipe ?? "";
    const key = `${e.machine} ${recipe}`;
    const cur = merged.get(key);
    if (cur) cur.count += count;
    else merged.set(key, { name: e.machine, recipe, count });
  }
  const rows = [...merged.values()];
  const before = builtKeyMap();
  const after = new Map(rows.map((r) => [`${r.name} ${r.recipe}`, r.count]));
  const changed = before.size !== after.size || [...after].some(([k, c]) => before.get(k) !== c);
  if (changed) {
    db.transaction((tx) => {
      tx.delete(builtMachines).run();
      if (rows.length) tx.insert(builtMachines).values(rows).run();
    });
  }
  return { applied: rows.length, total: rows.reduce((s, r) => s + r.count, 0), changed };
}

/** Built rows keyed `name recipe` (space-joined; prototype names are kebab-case,
 * so no collision) → count (for change detection). */
function builtKeyMap(): Map<string, number> {
  return new Map(
    db
      .select()
      .from(builtMachines)
      .all()
      .map((m) => [`${m.name} ${m.recipe}`, m.count]),
  );
}

function recipeDisplayName(name: string): string {
  if (name === "") return "";
  return (
    db.select({ d: recipes.display }).from(recipes).where(eq(recipes.name, name)).get()?.d ?? name
  );
}

/** Per-machine required (across blocks) vs. built (from the game), broken down by
 * the RECIPE each machine runs. When the game reports a recipe for a machine's
 * built units (assemblers, active furnaces) we compare per recipe — so furnaces
 * smelting the wrong thing count as short. When it doesn't (mining drills, labs,
 * idle furnaces → empty recipe), we fall back to a machine-level total. `short`
 * is the whole machines you still need to place. Sorted worst-deficit first. */
export function machineSufficiency() {
  const reqRows = db
    .select({
      machine: blockMachines.machine,
      recipe: blockMachines.recipe,
      required: sql<number>`sum(${blockMachines.count})`,
    })
    .from(blockMachines)
    .innerJoin(blocks, eq(blocks.id, blockMachines.blockId)) // ignore orphans
    .where(eq(blocks.enabled, true)) // disabled blocks (#73) require no machines
    .groupBy(blockMachines.machine, blockMachines.recipe)
    .all();
  const builtRows = db.select().from(builtMachines).all();

  const names = new Set<string>([
    ...reqRows.map((r) => r.machine),
    ...builtRows.map((b) => b.name),
  ]);
  return [...names]
    .map((machine) => {
      const req = reqRows.filter((r) => r.machine === machine);
      const built = builtRows.filter((b) => b.name === machine);
      const requiredTotal = req.reduce((s, r) => s + r.required, 0);
      const builtTotal = built.reduce((s, b) => s + b.count, 0);
      // recipe-aware only when the game gave us a recipe for some built unit
      const recipeAware = built.some((b) => b.recipe !== "");
      const unassignedBuilt = built.filter((b) => b.recipe === "").reduce((s, b) => s + b.count, 0);

      let recipeRows: {
        recipe: string;
        display: string;
        required: number;
        built: number | null;
        short: number;
      }[];
      let short: number;
      if (recipeAware) {
        const keys = new Set<string>([
          ...req.map((r) => r.recipe),
          ...built.filter((b) => b.recipe !== "").map((b) => b.recipe),
        ]);
        keys.delete(""); // the empty-recipe required bucket folds into machine total below
        recipeRows = [...keys]
          .map((recipe) => {
            const required = req.find((r) => r.recipe === recipe)?.required ?? 0;
            const have = built.find((b) => b.recipe === recipe)?.count ?? 0;
            return {
              recipe,
              display: recipeDisplayName(recipe),
              required,
              built: have,
              short: Math.max(0, Math.ceil(required - have - 1e-6)),
            };
          })
          .sort((a, b) => b.short - a.short || b.required - a.required);
        short = recipeRows.reduce((s, r) => s + r.short, 0);
      } else {
        recipeRows = req
          .map((r) => ({
            recipe: r.recipe,
            display: recipeDisplayName(r.recipe),
            required: r.required,
            built: null,
            short: 0,
          }))
          .sort((a, b) => b.required - a.required);
        short = Math.max(0, Math.ceil(requiredTotal - builtTotal - 1e-6));
      }

      return {
        machine,
        display:
          db
            .select({ d: craftingMachines.display })
            .from(craftingMachines)
            .where(eq(craftingMachines.name, machine))
            .get()?.d ?? machine,
        requiredTotal,
        builtTotal,
        recipeAware,
        unassignedBuilt,
        short,
        recipes: recipeRows,
      };
    })
    .filter((m) => m.requiredTotal > 1e-6 || m.builtTotal > 0)
    .sort((a, b) => b.short - a.short || b.requiredTotal - a.requiredTotal);
}

/** Per-machine built-vs-required rows for a SET of required rows, reusing
 * machineSufficiency's exact-match / machine-total-fallback split (see its
 * comment above) but returning a FLAT per-recipe list instead of a per-machine
 * tree — blockBuildStatus wants "per recipe" rows (#123), not a nested
 * breakdown. `built`/`missing` come back `null` on a row whose machine type
 * never reports a recipe in built_machines (boilers/generators/reactors/
 * offshore-pumps — see mod/control.lua's RECIPE_TYPES) — those rows are instead
 * rolled into `machineFallback`, one entry per such machine, comparing its
 * TOTAL required (across all its recipe rows here) against its TOTAL built. */
function withBuiltStatus(
  reqRows: { machine: string; recipe: string; required: number }[],
  builtRows: { name: string; recipe: string; count: number }[],
): {
  recipes: {
    recipe: string;
    machine: string;
    required: number;
    built: number | null;
    missing: number | null;
  }[];
  machineFallback: {
    machine: string;
    requiredTotal: number;
    builtTotal: number;
    missing: number;
  }[];
  totalMissing: number;
} {
  const machines = new Set(reqRows.map((r) => r.machine));
  const recipes: {
    recipe: string;
    machine: string;
    required: number;
    built: number | null;
    missing: number | null;
  }[] = [];
  const machineFallback: {
    machine: string;
    requiredTotal: number;
    builtTotal: number;
    missing: number;
  }[] = [];
  let totalMissing = 0;
  for (const machine of machines) {
    const rows = reqRows.filter((r) => r.machine === machine);
    const built = builtRows.filter((b) => b.name === machine);
    const recipeAware = built.some((b) => b.recipe !== "");
    if (recipeAware) {
      for (const r of rows) {
        const have = built.find((b) => b.recipe === r.recipe)?.count ?? 0;
        const missing = Math.max(0, r.required - have);
        recipes.push({ recipe: r.recipe, machine, required: r.required, built: have, missing });
        totalMissing += missing;
      }
    } else {
      const requiredTotal = rows.reduce((s, r) => s + r.required, 0);
      const builtTotal = built.reduce((s, b) => s + b.count, 0);
      const missing = Math.max(0, requiredTotal - builtTotal);
      for (const r of rows)
        recipes.push({
          recipe: r.recipe,
          machine,
          required: r.required,
          built: null,
          missing: null,
        });
      machineFallback.push({ machine, requiredTotal, builtTotal, missing });
      totalMissing += missing;
    }
  }
  return { recipes, machineFallback, totalMissing };
}

/** Built-vs-required MACHINE status for ONE block (or, with no id, every
 * ENABLED block currently under-built) — #123. Unlike machineSufficiency
 * (which sums the REQUIRED side across every block to answer "how many
 * total"), this scopes the required side to a single block's block_machines
 * rows: "what's left to build for THIS block." Built counts are still the
 * same force-wide built_machines snapshot — two blocks sharing the exact
 * same (machine, recipe) will each independently compare against the same
 * built count (a real limitation of the data model, not fixed here).
 * `required` is a WHOLE-BUILDING count (ceiled from block_machines' solved
 * fractional count — same source submitBlock's `buildings` field reports,
 * before this tool's own ceiling). Passing `blockId` always returns that
 * block, even fully-built or disabled (a deliberate ask); with no id, only
 * enabled blocks with `totalMissing > 0` come back, worst-missing first
 * (mirrors every other factory-wide rollup's enabled-only convention).
 * `limit` bounds the no-id listing mode only (ignored when `blockId` is
 * given) — each block also carries its own nested `recipes`/`machineFallback`
 * arrays, so an unbounded listing grows as blocks x recipes-per-block. */
export function blockBuildStatus(
  blockId?: number,
  limit?: number,
): {
  blockId: number;
  block: string;
  enabled: boolean;
  totalMissing: number;
  recipes: {
    recipe: string;
    machine: string;
    required: number;
    built: number | null;
    missing: number | null;
  }[];
  machineFallback?: {
    machine: string;
    requiredTotal: number;
    builtTotal: number;
    missing: number;
  }[];
}[] {
  const bs =
    blockId != null
      ? db
          .select({ id: blocks.id, name: blocks.name, enabled: blocks.enabled })
          .from(blocks)
          .where(eq(blocks.id, blockId))
          .all()
      : db
          .select({ id: blocks.id, name: blocks.name, enabled: blocks.enabled })
          .from(blocks)
          .where(eq(blocks.enabled, true))
          .orderBy(blocks.sortOrder, blocks.name)
          .all();
  if (!bs.length) return [];

  const builtRows = db.select().from(builtMachines).all();
  const result = bs.map((b) => {
    const reqRows = db
      .select({
        machine: blockMachines.machine,
        recipe: blockMachines.recipe,
        count: blockMachines.count,
      })
      .from(blockMachines)
      .where(eq(blockMachines.blockId, b.id))
      .all()
      .map((r) => ({ machine: r.machine, recipe: r.recipe, required: wholeMachines(r.count) }));
    const { recipes, machineFallback, totalMissing } = withBuiltStatus(reqRows, builtRows);
    recipes.sort((x, y) => (y.missing ?? 0) - (x.missing ?? 0) || y.required - x.required);
    return {
      blockId: b.id,
      block: b.name,
      enabled: b.enabled,
      totalMissing,
      recipes,
      ...(machineFallback.length ? { machineFallback } : {}),
    };
  });

  if (blockId != null) return result;
  const worst = result
    .filter((r) => r.totalMissing > 0)
    .sort((a, b) => b.totalMissing - a.totalMissing);
  return limit != null ? worst.slice(0, limit) : worst;
}

/* ── Live production statistics (actual rates from the game) ──────────────────── */

/** Replace the stored production stats with a fresh per-second snapshot from the
 * game. Returns how many entries landed (stats change every push, so we always
 * rewrite). */
export function setProductionStats(
  entries: { name: string; kind: string; produced: number; consumed: number }[],
): { applied: number } {
  const clean = entries
    .filter((e) => typeof e.name === "string" && (e.produced > 1e-6 || e.consumed > 1e-6))
    .map((e) => ({
      name: e.name,
      kind: e.kind === "fluid" ? "fluid" : "item",
      produced: e.produced,
      consumed: e.consumed,
    }));
  db.transaction((tx) => {
    tx.delete(productionStats).run();
    if (clean.length) tx.insert(productionStats).values(clean).run();
  });
  return { applied: clean.length };
}

/** Actual production/consumption rates keyed by good name. */
export function getProductionStats() {
  return db.select().from(productionStats).all();
}

/** Actual produced/consumed rates for specific goods, resolved with kind/display —
 * the batch-lookup form of getProductionStats, keyed to the assistant's
 * productionStats tool. setProductionStats always replaces the FULL snapshot and
 * drops near-zero rows before inserting (see its comment), so once any sync has
 * landed, a good's absence from productionStats means ~0 produced AND ~0 consumed
 * — not "unknown". The only real unknown is whether a sync has EVER landed at
 * all; callers should pair this with metaAll().stats_synced_at. */
export function productionStatsFor(goods: string[]): {
  name: string;
  display: string | null;
  kind: "item" | "fluid" | null;
  produced: number;
  consumed: number;
}[] {
  const uniq = [...new Set(goods)];
  if (!uniq.length) return [];
  const itemRows = db
    .select({ name: items.name, display: items.display })
    .from(items)
    .where(inArray(items.name, uniq))
    .all();
  const fluidRows = db
    .select({ name: fluids.name, display: fluids.display })
    .from(fluids)
    .where(inArray(fluids.name, uniq))
    .all();
  const itemMap = new Map(itemRows.map((r) => [r.name, r.display]));
  const fluidMap = new Map(fluidRows.map((r) => [r.name, r.display]));
  const statMap = new Map(
    db
      .select()
      .from(productionStats)
      .where(inArray(productionStats.name, uniq))
      .all()
      .map((s) => [s.name, s]),
  );
  return uniq.map((name) => {
    const isItem = itemMap.has(name);
    const isFluid = !isItem && fluidMap.has(name);
    const s = statMap.get(name);
    return {
      name,
      display: isItem ? (itemMap.get(name) ?? null) : isFluid ? (fluidMap.get(name) ?? null) : null,
      kind: isItem
        ? "item"
        : isFluid
          ? "fluid"
          : ((s?.kind as "item" | "fluid" | undefined) ?? null),
      produced: s?.produced ?? 0,
      consumed: s?.consumed ?? 0,
    };
  });
}

/** The factory ledger (planned per-item produced/consumed/net) joined with the
 * live actual production/consumption from the game. Items appear if they're
 * planned (in any block flow) or actually flowing in-game. `actualProduced` is
 * null when no live stats exist for the good. */
export function factoryProductionComparison() {
  const planned = factoryTotals(); // {item, kind, role, rate, display}
  const actual = new Map(getProductionStats().map((s) => [s.name, s]));

  const byItem = new Map<
    string,
    { kind: string; display: string | null; plannedProduced: number; plannedConsumed: number }
  >();
  for (const f of planned) {
    const e = byItem.get(f.item) ?? {
      kind: f.kind,
      display: f.display,
      plannedProduced: 0,
      plannedConsumed: 0,
    };
    if (f.role === "import") e.plannedConsumed += f.rate;
    else e.plannedProduced += f.rate;
    byItem.set(f.item, e);
  }
  // include goods the game makes that no block plans yet
  for (const [name, s] of actual)
    if (!byItem.has(name))
      byItem.set(name, {
        kind: s.kind,
        display: compDisplay(s.kind, name),
        plannedProduced: 0,
        plannedConsumed: 0,
      });

  return [...byItem.entries()].map(([item, e]) => {
    const a = actual.get(item);
    return {
      item,
      kind: e.kind,
      display: e.display,
      plannedProduced: e.plannedProduced,
      plannedConsumed: e.plannedConsumed,
      actualProduced: a ? a.produced : null,
      actualConsumed: a ? a.consumed : null,
    };
  });
}

/** Technologies that unlock a recipe. */
export function techsUnlocking(recipeName: string): string[] {
  return db
    .select({ technology: techUnlocks.technology })
    .from(techUnlocks)
    .where(eq(techUnlocks.recipe, recipeName))
    .all()
    .map((r) => r.technology);
}

/** Unlocking technologies for a recipe, each with its science-pack cost (the tier signal). */
export function recipeUnlocks(recipeName: string) {
  return db
    .select({ name: techUnlocks.technology })
    .from(techUnlocks)
    .where(eq(techUnlocks.recipe, recipeName))
    .all()
    .map((t) => ({
      tech: t.name,
      display:
        db
          .select({ d: technologies.display })
          .from(technologies)
          .where(eq(technologies.name, t.name))
          .get()?.d ?? null,
      science: db
        .select({ name: techIngredients.name, amount: techIngredients.amount })
        .from(techIngredients)
        .where(eq(techIngredients.technology, t.name))
        .all()
        .map((s) => ({ ...s, display: compDisplay("item", s.name) ?? s.name })),
    }));
}

export function getItem(name: string) {
  return db.select().from(items).where(eq(items.name, name)).get() ?? null;
}

/** Module rows by name — display + per-effect values. Powers the module-loadout
 * hover card so it can show what each module contributes, not just a total. */
export function moduleInfo(names: string[]) {
  if (!names.length) return [];
  return db
    .select({
      name: modules.name,
      display: modules.display,
      category: modules.category,
      effSpeed: modules.effSpeed,
      effProductivity: modules.effProductivity,
      effConsumption: modules.effConsumption,
    })
    .from(modules)
    .where(inArray(modules.name, names))
    .all();
}

export function getFluid(name: string) {
  return db.select().from(fluids).where(eq(fluids.name, name)).get() ?? null;
}

/** Detail for a placeable entity icon — crafting machine, mining drill, or beacon
 * (and its item facts, since most entities are also items). Powers the EntityCard
 * hover. Returns thin data if the name is only an item (or unknown). */
export function entityDetail(name: string) {
  const machine =
    db.select().from(craftingMachines).where(eq(craftingMachines.name, name)).get() ?? null;
  const drill = db.select().from(miningDrills).where(eq(miningDrills.name, name)).get() ?? null;
  const beacon = db.select().from(beacons).where(eq(beacons.name, name)).get() ?? null;
  const item = getItem(name);
  const categories = machine
    ? db
        .select({ c: machineCategories.category })
        .from(machineCategories)
        .where(eq(machineCategories.machine, name))
        .all()
        .map((r) => r.c)
    : [];
  return {
    name,
    display: machine?.display ?? beacon?.display ?? item?.display ?? name,
    machine: machine
      ? {
          kind: machine.kind,
          craftingSpeed: machine.craftingSpeed,
          moduleSlots: machine.moduleSlots,
          energyUsageW: machine.energyUsageW,
          energySource: machine.energySource,
          categories,
        }
      : null,
    drill: drill
      ? {
          miningSpeed: drill.miningSpeed,
          moduleSlots: drill.moduleSlots,
          energyUsageW: drill.energyUsageW,
          energySource: drill.energySource,
        }
      : null,
    beacon: beacon
      ? {
          distributionEffectivity: beacon.distributionEffectivity,
          moduleSlots: beacon.moduleSlots,
          energyUsageW: beacon.energyUsageW,
        }
      : null,
    item: item
      ? {
          stackSize: item.stackSize,
          fuelValueJ: item.fuelValueJ,
          fuelCategory: item.fuelCategory,
        }
      : null,
    cost: goodCosts([name]).get(name) ?? null,
  };
}

/** All spoilable items → name→spoil-time-in-ticks (60 ticks/sec). Drives the
 * stopwatch overlay the icon layer paints on any spoilable item, everywhere. */
export function spoilables(): Record<string, number> {
  const rows = db
    .select({ name: items.name, ticks: items.spoilTicks })
    .from(items)
    .where(isNotNull(items.spoilTicks))
    .all();
  const out: Record<string, number> = {};
  for (const r of rows) if (r.ticks != null) out[r.name] = r.ticks;
  return out;
}

/** Classify a bare name into item / fluid / recipe (+ display) so prose refs can
 * render with the right icon and hover. Item-first: names shared by an item and a
 * recipe (e.g. iron-plate) resolve to the item. Pass `prefer: "recipe"` when the
 * caller KNOWS the name is a recipe ref (#113 — Py names recipes after their main
 * product, so recipe `coal-gas` would otherwise resolve to the fluid's display).
 * Returns null for unknown names. */
export function classifyRef(
  name: string,
  prefer?: "recipe",
): { kind: "item" | "fluid" | "recipe" | "technology"; display: string } | null {
  if (prefer === "recipe") {
    const r = db.select({ d: recipes.display }).from(recipes).where(eq(recipes.name, name)).get();
    if (r) return { kind: "recipe", display: r.d ?? name };
  }
  const it = db.select({ d: items.display }).from(items).where(eq(items.name, name)).get();
  if (it) return { kind: "item", display: it.d ?? name };
  const fl = db.select({ d: fluids.display }).from(fluids).where(eq(fluids.name, name)).get();
  if (fl) return { kind: "fluid", display: fl.d ?? name };
  const r = db.select({ d: recipes.display }).from(recipes).where(eq(recipes.name, name)).get();
  if (r) return { kind: "recipe", display: r.d ?? name };
  // Technologies resolve LAST so a good/recipe of the same name keeps priority —
  // lets the assistant chip a research name (`electronics`) as an icon too.
  const t = db
    .select({ d: technologies.display })
    .from(technologies)
    .where(eq(technologies.name, name))
    .get();
  if (t) return { kind: "technology", display: t.d ?? name };
  return null;
}

/** Item/fluid kind + display for a caller-supplied set of goods. Unlike repeated
 * `classifyRef` calls, this stays at two statements as the set grows. Items win
 * over fluids when an internal name exists in both namespaces. Unknown names
 * retain the editor's historical item fallback. */
export function goodInfo(
  names: string[],
): Record<string, { kind: "item" | "fluid"; display: string }> {
  const uniq = [...new Set(names)];
  const out: Record<string, { kind: "item" | "fluid"; display: string }> = {};
  if (!uniq.length) return out;
  for (const row of db
    .select({ name: items.name, display: items.display })
    .from(items)
    .where(inArray(items.name, uniq))
    .all())
    out[row.name] = { kind: "item", display: row.display ?? row.name };
  for (const row of db
    .select({ name: fluids.name, display: fluids.display })
    .from(fluids)
    .where(inArray(fluids.name, uniq))
    .all())
    out[row.name] ??= { kind: "fluid", display: row.display ?? row.name };
  for (const name of uniq) out[name] ??= { kind: "item", display: name };
  return out;
}

/* ── Exclusions: glob patterns over name / subgroup / category ──────────────── */

// Always-on: Editor-Extensions creative content (uncraftable — map-editor only).
// Matches ee- names AND ee-* subgroups AND the ee-testing-tool recipe category.
const DEFAULT_EXCLUDE_GLOBS = ["ee-*", "ee-testing-tool"];

function globToRegex(glob: string): RegExp {
  const esc = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${esc}$`, "i");
}

/** User exclusion globs (meta key "excluded": {globs:[]}). Patterns use * and ?,
 * matched against a good's name/subgroup or a recipe's name/category — so
 * "py-alienlife-*" (a mod family via subgroup), "ee-*", or an exact name all work. */
export function getExclusions(): { globs: string[] } {
  try {
    const raw = db.select({ v: meta.value }).from(meta).where(eq(meta.key, "excluded")).get()?.v;
    const j = raw ? (JSON.parse(raw) as { globs?: string[] }) : {};
    return { globs: j.globs ?? [] };
  } catch {
    return { globs: [] };
  }
}
export function setExclusions(x: { globs?: string[] }) {
  metaSet("excluded", JSON.stringify({ globs: x.globs ?? [] }));
}

let _exclCache: { source: string; globs: RegExp[] } | null = null;
function exclusionGlobs(): RegExp[] {
  // SQLite remains authoritative: read the current value before reusing the
  // compiled regexes. Keying by the value itself makes project switches,
  // external writes and same-path project recreation safe without an
  // invalidation registry.
  const userGlobs = getExclusions().globs;
  const source = JSON.stringify(userGlobs);
  if (_exclCache?.source !== source) {
    _exclCache = {
      source,
      globs: [...DEFAULT_EXCLUDE_GLOBS, ...userGlobs].map(globToRegex),
    };
  }
  return _exclCache.globs;
}
function matchesExclusion(globs: RegExp[], ...fields: (string | null | undefined)[]): boolean {
  return fields.some((f) => f != null && globs.some((g) => g.test(f)));
}
/** Snapshot the SQLite-owned exclusion policy once for one larger operation. */
export function createExclusionMatcher() {
  const globs = exclusionGlobs();
  return (...fields: (string | null | undefined)[]) => matchesExclusion(globs, ...fields);
}
/** True if any exclusion glob matches any of the given fields (name/subgroup/category). */
export function isExcluded(...fields: (string | null | undefined)[]): boolean {
  return matchesExclusion(exclusionGlobs(), ...fields);
}

/* ── Logistics (belts / loaders / inserters) for the throughput display (#21) ─── */

/** Belt, loader and inserter prototypes for the logistics picker, ordered by
 * throughput. EE/excluded entities are filtered out. */
export function logisticsOptions(): {
  belts: BeltProto[];
  loaders: LoaderProto[];
  inserters: InserterProto[];
} {
  const beltRows = db
    .select({ name: belts.name, display: belts.display, speed: belts.speed })
    .from(belts)
    .all()
    .filter((b) => !isExcluded(b.name))
    .sort((a, b) => a.speed - b.speed);
  const loaderRows = db
    .select({ name: loaders.name, display: loaders.display, speed: loaders.speed })
    .from(loaders)
    .all()
    .filter((l) => !isExcluded(l.name))
    .sort((a, b) => a.speed - b.speed);
  const allInserters = db
    .select()
    .from(inserters)
    .all()
    .filter((i) => !isExcluded(i.name))
    .map((i) => ({
      name: i.name,
      display: i.display,
      rotationSpeed: i.rotationSpeed,
      extensionSpeed: i.extensionSpeed,
      pickupX: i.pickupX,
      pickupY: i.pickupY,
      dropX: i.dropX,
      dropY: i.dropY,
      bulk: i.bulk,
      baseStackBonus: i.baseStackBonus,
      maxBeltStackSize: i.maxBeltStackSize,
    }));
  // Py's Crane mod ships per-upgrade-tier entities (crane-mk3, crane-mk3u1…u8) that
  // are throughput-identical, so collapse to one option per (display + kinematics)
  // signature, preferring the canonical entity (no trailing "uN" upgrade suffix).
  const sig = (i: (typeof allInserters)[number]) =>
    [
      i.display ?? i.name,
      i.rotationSpeed,
      i.extensionSpeed,
      i.pickupX,
      i.pickupY,
      i.dropX,
      i.dropY,
      Number(i.bulk),
      i.baseStackBonus,
      i.maxBeltStackSize,
    ].join("|");
  const isUpgradeVariant = (name: string) => /u\d+$/.test(name);
  const bySig = new Map<string, (typeof allInserters)[number]>();
  for (const i of allInserters) {
    const cur = bySig.get(sig(i));
    // keep a canonical (non-upgrade) name over an upgrade variant; else the shorter.
    if (
      !cur ||
      (isUpgradeVariant(cur.name) && !isUpgradeVariant(i.name)) ||
      (isUpgradeVariant(cur.name) === isUpgradeVariant(i.name) && i.name.length < cur.name.length)
    ) {
      bySig.set(sig(i), i);
    }
  }
  const inserterRows = [...bySig.values()].sort(
    // hand stack first (bulk capacity), then swing speed — a stable, sensible order
    (a, b) =>
      Number(a.bulk) - Number(b.bulk) ||
      a.rotationSpeed - b.rotationSpeed ||
      (a.display ?? a.name).localeCompare(b.display ?? b.name),
  );
  return { belts: beltRows, loaders: loaderRows, inserters: inserterRows };
}

/** Rocket-lift weight per item (for launches/min), keyed by name. `null` = the item
 * has no weight set in the data (the caller substitutes `default_item_weight`). */
export function itemWeights(names: string[]): Record<string, number | null> {
  const uniq = [...new Set(names)];
  const out: Record<string, number | null> = {};
  if (!uniq.length) return out;
  for (const r of db
    .select({ name: items.name, weight: items.weight })
    .from(items)
    .where(inArray(items.name, uniq))
    .all())
    out[r.name] = r.weight ?? null;
  return out;
}

/** Current belt / inserter / bulk-inserter stack-size bonuses, summed over the
 * tech in effect under the research horizon: everything in FUTURE mode, live
 * research + the pack gate in NOW, the tier's pack gate for a target — the same
 * reachability the solver uses for recipe availability. */
export function stackBonuses(): StackBonuses {
  const h = getResearchHorizon();
  const out: StackBonuses = { belt: 0, inserter: 0, bulkInserter: 0 };
  for (const r of db.select().from(techStackBonuses).all()) {
    if (h.mode !== "future" && !techReachedByScience(r.technology, h)) continue;
    if (r.effect === "belt") out.belt += r.modifier;
    else if (r.effect === "inserter") out.inserter += r.modifier;
    else if (r.effect === "bulk-inserter") out.bulkInserter += r.modifier;
  }
  return out;
}

export type ProductivityBonuses = {
  /** summed mining-drill-productivity-bonus (all mining recipes; uncapped in-game) */
  mining: number;
  /** summed change-recipe-productivity per target recipe */
  recipes: Map<string, number>;
};
/** Research-driven flat productivity in effect under the research horizon (#92):
 * mining productivity and Factorio 2.0 `change-recipe-productivity` techs. Gated
 * exactly like stackBonuses / machine availability — everything in FUTURE mode,
 * live research + the pack gate in NOW, the tier's pack gate for a target. In NOW
 * mode, a bridge-synced save can provide exact force mining and recipe-productivity
 * scalars, which capture repeatable/dynamic bonuses instead of counting each tech
 * name once. */
export function productivityBonuses(): ProductivityBonuses {
  const h = getResearchHorizon();
  const out: ProductivityBonuses = { mining: 0, recipes: new Map() };
  const m = metaAll();
  const liveMining = h.mode === "now" ? Number(m.research_mining_productivity_bonus ?? NaN) : NaN;
  const hasLiveMining = Number.isFinite(liveMining);
  const liveRecipes = h.mode === "now" ? parseRecipeProductivityBonuses(m) : null;
  for (const r of db.select().from(techProductivityBonuses).all()) {
    if (h.mode !== "future" && !techReachedByScience(r.technology, h)) continue;
    if (r.recipe === "") {
      if (!hasLiveMining) out.mining += r.modifier;
    } else if (!liveRecipes)
      out.recipes.set(r.recipe, (out.recipes.get(r.recipe) ?? 0) + r.modifier);
  }
  if (hasLiveMining) out.mining = liveMining;
  if (liveRecipes) out.recipes = liveRecipes;
  return out;
}

export function syncedRecipeProductivityBonusCount(): number | null {
  return parseRecipeProductivityBonuses()?.size ?? null;
}

function parseRecipeProductivityBonuses(m = metaAll()): Map<string, number> | null {
  const raw = m.research_recipe_productivity_bonuses;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed).filter(
      (e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]) && e[1] !== 0,
    );
    return new Map(entries);
  } catch {
    return null;
  }
}

/** The full logistics context — prefs (with defaults applied), research bonuses,
 * prototype options, and rocket constants. Shared by the web `logisticsContextFn`
 * and the in-game summary payload so both size against the same picks. */
export function logisticsContext(): LogisticsContext {
  const m = metaAll();
  const options = logisticsOptions();
  return {
    prefs: {
      showBelts: m.logistics_show_belts === "1",
      showInserters: m.logistics_show_inserters === "1",
      showRockets: m.logistics_rockets === "1",
      belt: m.logistics_belt || (options.belts[0]?.name ?? ""),
      mover: m.logistics_mover || (options.inserters[0]?.name ?? ""),
      moverKind: m.logistics_mover_kind === "loader" ? "loader" : "inserter",
      stacking: m.logistics_stacking !== "0", // default on
      overrideStack:
        m.logistics_stack_override != null && m.logistics_stack_override !== ""
          ? Number(m.logistics_stack_override)
          : null,
    },
    bonuses: stackBonuses(),
    options,
    rocketLiftWeight: Number(m.rocket_lift_weight ?? 1_000_000),
    defaultItemWeight: Number(m.default_item_weight ?? 100),
  };
}

export type LogisticsForGood =
  | { good: string; display: string; kind: "fluid"; rate: number; note: string }
  | {
      good: string;
      display: string;
      kind: "item";
      rate: number;
      beltStack: number; // effective placed-stack from current research (belts + loaders)
      bonuses: StackBonuses;
      belts: { belt: string; display: string | null; count: number; saturation: number }[];
      inserters: { inserter: string; display: string | null; handStack: number; count: number }[];
      loaders: { loader: string; display: string | null; count: number }[];
      note?: string;
    };

/** Belts + inserters/loaders to move ONE good at ONE rate, gated to entities
 * UNLOCKED under the research horizon (same `unlockedItems` gating as
 * `availableMachines` — belt/loader/inserter entities are themselves crafted
 * items). Unlike the block editor's manual belt/mover PICKER
 * (`logisticsOptions`/`components/logistics-menu.tsx`, which shows every
 * tier unfiltered), this answers "what CAN carry this rate right now" — every
 * unlocked belt tier's whole-belt count + saturation (how full the built belts
 * run — the direct "can one yellow belt feed this?" answer), and every
 * unlocked inserter/loader's whole-device count to move the rate through one
 * feed point. Stack sizes reflect the researched belt/inserter/bulk-inserter
 * bonuses (`stackBonuses`), the same math `resolveLogistics`/`rowLogistics`
 * use for the block editor's per-row readout (#21) — evaluated across every
 * unlocked tier instead of the user's one selected pick. Fluids short-circuit
 * to a note: pipe throughput isn't modelled (#126). */
export function logisticsForGood(good: string, rate: number): LogisticsForGood | { error: string } {
  const item = getItem(good);
  const fluid = getFluid(good);
  if (!item && !fluid) return { error: `no good '${good}'` };
  const display = item?.display ?? fluid?.display ?? good;
  if (!item) {
    return {
      good,
      display,
      kind: "fluid",
      rate,
      note: "fluid — pipe throughput isn't modelled; belts/inserters/loaders apply to items only",
    };
  }

  const options = logisticsOptions();
  const bonuses = stackBonuses();
  const names = [...options.belts, ...options.loaders, ...options.inserters].map((o) => o.name);
  const unlocked = unlockedItems(names);
  const placedStack = placedBeltStack(bonuses.belt, true);

  const belts = options.belts
    .filter((b) => unlocked.has(b.name))
    .map((b) => {
      const need = beltsForRate(rate, b, placedStack);
      const count = Math.max(0, Math.ceil(need - 1e-9));
      return {
        belt: b.name,
        display: b.display,
        count,
        saturation: count > 0 ? Number((need / count).toFixed(3)) : 0,
      };
    });

  const loaders = options.loaders
    .filter((l) => unlocked.has(l.name))
    .map((l) => {
      const need = loadersForRate(rate, l, placedStack);
      return { loader: l.name, display: l.display, count: Math.max(0, Math.ceil(need - 1e-9)) };
    });

  const inserters = options.inserters
    .filter((i) => unlocked.has(i.name))
    .map((i) => {
      const handStack = inserterHandStack(i, bonuses);
      const need = insertersForRate(rate, i, handStack);
      return {
        inserter: i.name,
        display: i.display,
        handStack,
        count: Math.max(0, Math.ceil(need - 1e-9)),
      };
    });

  const notes = [
    belts.length === 0 && "no belt tier is unlocked yet under the current research horizon",
    inserters.length === 0 &&
      loaders.length === 0 &&
      "no inserter or loader is unlocked yet under the current research horizon",
  ].filter((x): x is string => !!x);

  return {
    good,
    display,
    kind: "item",
    rate,
    beltStack: placedStack,
    bonuses,
    belts,
    inserters,
    loaders,
    ...(notes.length ? { note: notes.join("; ") } : {}),
  };
}

/* ── Research / TURD availability horizon (plan for now vs future) ───────────── */

export type ResearchHorizon = {
  // now = current science; future = anything; target = up to a target good's tech tier
  mode: "now" | "future" | "target";
  packs: Set<string>; // science packs you have / produce (or, for target, up to its tier)
  researched: Set<string>; // explicitly-completed techs (mod-fed later; mock for now)
  target: string | null; // the target good (mode = target)
  targetTech: string | null; // the tech that unlocks the target (mode = target)
};

/** A tech's own direct prerequisites (one level). Shared by techPrereqClosure
 * and orderTechSteps. */
function directPrereqs(tech: string): string[] {
  return db
    .select({ p: techPrerequisites.prerequisite })
    .from(techPrerequisites)
    .where(eq(techPrerequisites.technology, tech))
    .all()
    .map((r) => r.p);
}

/** Every tech in a tech's prerequisite closure — the tech itself plus all ancestors. */
function techPrereqClosure(root: string): Set<string> {
  const seen = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const t = stack.pop()!;
    if (seen.has(t)) continue;
    seen.add(t);
    for (const p of directPrereqs(t)) if (!seen.has(p)) stack.push(p);
  }
  return seen;
}

/** Union of the science packs every tech in the set costs. */
function packsForTechs(techs: Set<string>): Set<string> {
  if (!techs.size) return new Set();
  return new Set(
    db
      .select({ n: techIngredients.name })
      .from(techIngredients)
      .where(inArray(techIngredients.technology, [...techs]))
      .all()
      .map((r) => r.n),
  );
}

/** A tech's full prerequisite closure (techs + the union of their science
 * packs). This deliberately reads SQLite on each operation: reference data can
 * be replaced in-process by a data sync, so a process-wide closure cache would
 * need a second invalidation contract beside the database. Hot block solves use
 * createBlockSolveContext's request-scoped bulk graph below. */
function techClosure(tech: string): { techs: Set<string>; packs: Set<string> } {
  const techs = techPrereqClosure(tech);
  return { techs, packs: packsForTechs(techs) };
}

/** Science packs still missing to reach `tech` under the horizon: the packs of
 * its prerequisite closure MINUS what's already researched, minus what the
 * horizon supplies. Empty = reachable. Checking the tech's OWN cost alone was
 * wrong — a tech gated purely through prerequisites has an empty own cost (e.g.
 * TURD-unlocked `neuron`), so it vacuously read as reachable at any tier; and in
 * NOW mode a researched prerequisite shouldn't demand its pack again. */
function reachMissingPacks(tech: string, h: ResearchHorizon): string[] {
  if (h.researched.has(tech)) return [];
  const { techs, packs } = techClosure(tech);
  // researched techs are prerequisite-closed, so dropping them from the closure
  // prunes their (already-done) subtrees; only the unresearched frontier's packs
  // must be supplied. Target mode has no researched set → the full closure.
  const relevant = h.researched.size ? packsForTechs(setDiff(techs, h.researched)) : packs;
  return [...relevant].filter((p) => !h.packs.has(p));
}

function setDiff(a: Set<string>, b: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const x of a) if (!b.has(x)) out.add(x);
  return out;
}

/** Every tech that unlocks at least one of the given recipes, ranked by tier
 * (fewest distinct science packs in ITS OWN prerequisite closure, ties by
 * name — cheapest/lowest route first). Shared by unlockTechForGood (single
 * best) and researchPath (best + alternates). */
function rankUnlockTechs(
  recipeNames: string[],
): { tech: string; display: string | null; tier: number }[] {
  if (!recipeNames.length) return [];
  const techNames = db
    .selectDistinct({ t: techUnlocks.technology })
    .from(techUnlocks)
    .where(inArray(techUnlocks.recipe, recipeNames))
    .all()
    .map((r) => r.t);
  if (!techNames.length) return [];
  const ranked = techNames
    .map((t) => ({ tech: t, tier: packsForTechs(techPrereqClosure(t)).size }))
    .sort((a, b) => a.tier - b.tier || a.tech.localeCompare(b.tech));
  const disp = techDisplays(ranked.map((r) => r.tech));
  return ranked.map((r) => ({ ...r, display: disp.get(r.tech) ?? null }));
}

/** The technology that first lets you make a good: among the techs unlocking a
 * recipe that produces it, the lowest-tier one (fewest distinct science packs in
 * its prerequisite closure, ties broken by name). null if it's start-craftable or
 * nothing unlocks it. */
export function unlockTechForGood(good: string): { tech: string; display: string | null } | null {
  const ranked = rankUnlockTechs(recipesProducing(good).map((r) => r.name));
  return ranked.length
    ? { tech: ranked[0].tech, display: ranked[0].display ?? ranked[0].tech }
    : null;
}

export type ResearchPathTurdGate = {
  subTech: string;
  subTechDisplay: string;
  master: string | null;
  masterDisplay: string | null;
  state: "pickable" | "blocked";
};

/** Prereqs-first (topological) order of the NOT-yet-researched tech closure
 * reaching `root`. Stops recursing at a researched tech (its subtree is done —
 * researched techs are prerequisite-closed, see reachMissingPacks) and at a
 * turd-select-* gate (not a science step — surfaced separately when the
 * branch isn't already ACTIVE; verified against the real dump that these
 * gates have zero prerequisites and zero science cost of their own). */
function orderTechSteps(
  root: string,
  researched: ReadonlySet<string>,
  selections: Map<string, string>,
): { steps: string[]; turdGatesNeeded: ResearchPathTurdGate[] } {
  const steps: string[] = [];
  const turdGatesNeeded: ResearchPathTurdGate[] = [];
  const visited = new Set<string>();
  const visit = (t: string) => {
    if (visited.has(t)) return;
    visited.add(t);
    if (t.startsWith("turd-select-")) {
      const sub = t.slice("turd-select-".length);
      const master = turdMasterOf(sub);
      const state = turdStateFor(sub, master?.name ?? null, selections);
      if (state !== "active") {
        turdGatesNeeded.push({
          subTech: sub,
          subTechDisplay: techDisplays([sub]).get(sub) ?? sub,
          master: master?.name ?? null,
          masterDisplay: master?.display ?? null,
          state,
        });
      }
      return;
    }
    if (researched.has(t)) return;
    for (const p of directPrereqs(t)) visit(p);
    steps.push(t);
  };
  visit(root);
  return { steps, turdGatesNeeded };
}

export type ResearchPathStep = {
  tech: string;
  display: string;
  packs: { name: string; amount: number }[]; // this tech's OWN unit.ingredients
};

export type ResearchPathResult = {
  ok: boolean;
  target: string;
  targetKind: "technology" | "recipe" | "good" | null;
  targetDisplay: string;
  targetTech: string | null;
  targetTechDisplay: string | null;
  alreadyUnlocked: boolean;
  alternateRoutes: { tech: string; display: string }[];
  steps: ResearchPathStep[]; // not-yet-researched closure, dependency order, target LAST
  totalPacks: { name: string; amount: number }[]; // summed across `steps`
  turdGatesNeeded: ResearchPathTurdGate[];
  error?: string;
};

/** Prerequisite closure + science cost to unlock a TARGET (a technology, a
 * recipe, or an item/fluid good — resolved in that priority). Always reads
 * the REAL researched-tech state synced from the connected save (or marked
 * manually in Settings) — independent of the current planning-horizon mode,
 * which governs recipe *availability*, not what's already done. See
 * `syncedResearchedTechs`. */
export function researchPath(target: string): ResearchPathResult {
  const empty = (
    targetKind: ResearchPathResult["targetKind"],
    error?: string,
  ): ResearchPathResult => ({
    ok: !error,
    target,
    targetKind,
    targetDisplay: target,
    targetTech: null,
    targetTechDisplay: null,
    alreadyUnlocked: false,
    alternateRoutes: [],
    steps: [],
    totalPacks: [],
    turdGatesNeeded: [],
    ...(error ? { error } : {}),
  });

  const techRow = db
    .select({ name: technologies.name, display: technologies.display })
    .from(technologies)
    .where(eq(technologies.name, target))
    .get();
  const recipeRow = !techRow ? getRecipe(target) : null;
  const item = !techRow && !recipeRow ? getItem(target) : null;
  const fluid = !techRow && !recipeRow && !item ? getFluid(target) : null;

  // The REAL researched-tech state (bridge-synced or manually marked) — used
  // below so a target already covered by it reports alreadyUnlocked, even
  // when the static enabled/producing.some(enabled) columns (start-enabled
  // only) haven't caught up. Must be checked up front, not just later inside
  // orderTechSteps, or a target whose sole unlocking tech is already
  // researched would fall through to a nonsensical zero-step "route".
  const researched = syncedResearchedTechs();

  let targetKind: "technology" | "recipe" | "good";
  let targetDisplay: string;
  let targetTech: string | null = null;
  let targetTechDisplay: string | null = null;
  let alreadyUnlocked = false;
  let alternateRoutes: { tech: string; display: string }[] = [];

  if (techRow) {
    targetKind = "technology";
    targetDisplay = techRow.display ?? target;
    targetTech = techRow.name;
    targetTechDisplay = techRow.display ?? target;
    alreadyUnlocked = researched.has(techRow.name);
  } else if (recipeRow) {
    targetKind = "recipe";
    targetDisplay = recipeRow.display ?? target;
    const ranked = rankUnlockTechs([target]);
    if (recipeRow.enabled || ranked.some((r) => researched.has(r.tech))) {
      alreadyUnlocked = true;
    } else if (!ranked.length) {
      return empty("recipe", `recipe '${target}' is disabled and no technology unlocks it`);
    } else {
      targetTech = ranked[0].tech;
      targetTechDisplay = ranked[0].display ?? ranked[0].tech;
      alternateRoutes = ranked
        .slice(1)
        .map((r) => ({ tech: r.tech, display: r.display ?? r.tech }));
    }
  } else if (item || fluid) {
    targetKind = "good";
    targetDisplay = item?.display ?? fluid?.display ?? target;
    const producing = recipesProducing(target);
    const ranked = producing.length ? rankUnlockTechs(producing.map((r) => r.name)) : [];
    if (producing.some((r) => r.enabled) || ranked.some((r) => researched.has(r.tech))) {
      alreadyUnlocked = true;
    } else if (ranked.length) {
      targetTech = ranked[0].tech;
      targetTechDisplay = ranked[0].display ?? ranked[0].tech;
      alternateRoutes = ranked
        .slice(1)
        .map((r) => ({ tech: r.tech, display: r.display ?? r.tech }));
    }
    // else (ranked.length === 0): either nothing produces it at all (raw
    // resource/import), or producing recipes exist but none is enabled/tech-
    // unlocked (currently unreachable) — either way, report as no targetTech,
    // not an error.
  } else {
    return empty(null, `no technology, recipe, or good named '${target}'`);
  }

  if (alreadyUnlocked || !targetTech) {
    return {
      ok: true,
      target,
      targetKind,
      targetDisplay,
      targetTech,
      targetTechDisplay,
      alreadyUnlocked,
      alternateRoutes,
      steps: [],
      totalPacks: [],
      turdGatesNeeded: [],
    };
  }

  const selections = getTurdSelections();
  const { steps: techNames, turdGatesNeeded } = orderTechSteps(targetTech, researched, selections);

  const totals = new Map<string, number>();
  const steps: ResearchPathStep[] = techNames.map((t) => {
    const disp = techDisplays([t]).get(t) ?? t;
    const packs = db
      .select({ name: techIngredients.name, amount: techIngredients.amount })
      .from(techIngredients)
      .where(eq(techIngredients.technology, t))
      .all();
    for (const p of packs) totals.set(p.name, (totals.get(p.name) ?? 0) + p.amount);
    return { tech: t, display: disp, packs };
  });

  const totalPacks = [...totals.entries()]
    .map(([name, amount]) => ({ name, amount: +amount.toFixed(2) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    ok: true,
    target,
    targetKind,
    targetDisplay,
    targetTech,
    targetTechDisplay,
    alreadyUnlocked: false,
    alternateRoutes,
    steps,
    totalPacks,
    turdGatesNeeded,
  };
}

export function getResearchHorizon(): ResearchHorizon {
  const m = metaAll();
  const parse = (k: string): string[] => {
    try {
      return JSON.parse(m[k] ?? "[]") as string[];
    } catch {
      return [];
    }
  };
  const mode =
    m.research_mode === "now" ? "now" : m.research_mode === "target" ? "target" : "future";
  if (mode === "target") {
    // up to (and including) the target's tech tier: allow anything unlocked by the
    // target's unlocking tech and its prerequisites, nothing beyond.
    const target = m.horizon_target || null;
    const u = target ? unlockTechForGood(target) : null;
    const packs = u ? packsForTechs(techPrereqClosure(u.tech)) : new Set<string>();
    return { mode, packs, researched: new Set(), target, targetTech: u?.tech ?? null };
  }
  return {
    mode,
    packs: new Set(parse("available_science_packs")),
    researched: new Set(parse("researched_techs")),
    target: null,
    targetTech: null,
  };
}
export function setResearchHorizon(x: {
  mode?: "now" | "future" | "target";
  packs?: string[];
  researched?: string[];
  target?: string | null;
  miningProductivityBonus?: number | null;
  recipeProductivityBonuses?: Record<string, number> | null;
}): boolean {
  const desired = new Map<string, string | null>();
  const setJson = (values: string[]) => JSON.stringify([...new Set(values)].sort());
  if (x.mode) desired.set("research_mode", x.mode);
  if (x.packs) desired.set("available_science_packs", setJson(x.packs));
  if (x.researched) desired.set("researched_techs", setJson(x.researched));
  if (x.target !== undefined) desired.set("horizon_target", x.target ?? "");
  if (x.miningProductivityBonus !== undefined) {
    if (x.miningProductivityBonus == null || !Number.isFinite(x.miningProductivityBonus))
      desired.set("research_mining_productivity_bonus", null);
    else
      desired.set(
        "research_mining_productivity_bonus",
        String(Math.max(0, x.miningProductivityBonus)),
      );
  }
  if (x.recipeProductivityBonuses !== undefined) {
    if (x.recipeProductivityBonuses == null) {
      desired.set("research_recipe_productivity_bonuses", null);
    } else {
      const clean = Object.fromEntries(
        Object.entries(x.recipeProductivityBonuses)
          .filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]))
          .filter(([, bonus]) => bonus !== 0)
          .sort(([a], [b]) => a.localeCompare(b)),
      );
      desired.set("research_recipe_productivity_bonuses", JSON.stringify(clean));
    }
  }
  const before = metaAll();
  const changed = [...desired].some(([key, value]) =>
    value == null ? Object.prototype.hasOwnProperty.call(before, key) : before[key] !== value,
  );
  if (!changed) return false;

  // Bump before the individual metadata writes. If a later write fails, cached
  // projections remain safely stale rather than appearing valid for mixed state.
  bumpSolveGeneration();
  for (const [key, value] of desired) {
    if (value == null) metaDelete(key);
    else metaSet(key, value);
  }
  return true;
}

/** The tech set actually completed (bridge-synced from the save, or manually
 * marked in Settings) — regardless of the current planning-horizon MODE. Unlike
 * getResearchHorizon().researched, which "target" mode deliberately zeroes for
 * its own gating logic, researchPath always wants the real state. */
export function syncedResearchedTechs(): Set<string> {
  const raw = metaAll().researched_techs;
  try {
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Search technologies by name/display (for the researched-tech picker) —
 * excludes the internal turd-select-* prerequisite techs. */
export function searchTechs(query: string, limit = 30): { name: string; display: string | null }[] {
  const pat = `%${query}%`;
  return db
    .select({ name: technologies.name, display: technologies.display })
    .from(technologies)
    .where(
      sql`(${technologies.name} LIKE ${pat} OR ${technologies.display} LIKE ${pat}) AND ${technologies.name} NOT LIKE 'turd-select-%'`,
    )
    .orderBy(technologies.order, technologies.name)
    .limit(limit)
    .all();
}

/** Full detail for a technology (hover card): science cost, what it unlocks, and
 * its direct prerequisites — all with display names. */
export function techDetail(tech: string) {
  const t = db
    .select({
      name: technologies.name,
      display: technologies.display,
      unitCount: technologies.unitCount,
    })
    .from(technologies)
    .where(eq(technologies.name, tech))
    .get();
  if (!t) return null;
  const science = db
    .select({ name: techIngredients.name, amount: techIngredients.amount })
    .from(techIngredients)
    .where(eq(techIngredients.technology, tech))
    .all();
  const packDisp = science.length
    ? new Map(
        db
          .select({ name: items.name, display: items.display })
          .from(items)
          .where(
            inArray(
              items.name,
              science.map((s) => s.name),
            ),
          )
          .all()
          .map((r) => [r.name, r.display] as const),
      )
    : new Map<string, string | null>();
  const recipeNames = db
    .select({ recipe: techUnlocks.recipe })
    .from(techUnlocks)
    .where(eq(techUnlocks.technology, tech))
    .all()
    .map((r) => r.recipe);
  const unlocks = recipeNames.length
    ? db
        .select({ name: recipes.name, display: recipes.display })
        .from(recipes)
        .where(inArray(recipes.name, recipeNames))
        .all()
    : [];
  const prereqNames = db
    .select({ p: techPrerequisites.prerequisite })
    .from(techPrerequisites)
    .where(eq(techPrerequisites.technology, tech))
    .all()
    .map((r) => r.p);
  const prereqs = prereqNames.length
    ? db
        .select({ name: technologies.name, display: technologies.display })
        .from(technologies)
        .where(inArray(technologies.name, prereqNames))
        .all()
    : [];
  return {
    name: t.name,
    display: t.display ?? t.name,
    unitCount: t.unitCount,
    science: science.map((s) => ({ ...s, display: packDisp.get(s.name) ?? s.name })),
    unlocks,
    prereqs,
  };
}

/** Display names for a set of tech internal names (for showing researched chips). */
export function techDisplays(names: string[]): Map<string, string> {
  if (!names.length) return new Map();
  return new Map(
    db
      .select({ name: technologies.name, display: technologies.display })
      .from(technologies)
      .where(inArray(technologies.name, Array.from(new Set(names))))
      .all()
      .map((r) => [r.name, r.display ?? r.name]),
  );
}

/** Science pack TYPES that appear in any tech, in UNLOCK-TIMELINE order — sorted by
 * the tier at which each pack becomes craftable (how many distinct science packs its
 * own unlocking tech transitively requires), ties broken by name. This is the static
 * progression list, not an alphabetical one. */
export function allSciencePacks(): string[] {
  const packs = db
    .selectDistinct({ name: techIngredients.name })
    .from(techIngredients)
    .all()
    .map((r) => r.name);
  const tier = new Map(
    packs.map((p) => {
      const u = unlockTechForGood(p);
      return [p, u ? packsForTechs(techPrereqClosure(u.tech)).size : 0] as const;
    }),
  );
  return packs.sort((a, b) => tier.get(a)! - tier.get(b)! || a.localeCompare(b));
}

/** A tech is "reached" if explicitly researched, or every science pack in its
 * full prerequisite closure is within your available set (you produce them, so
 * you'll research it in time). See reachMissingPacks for why the closure — not
 * the tech's own cost — is the correct gate. */
function techReachedByScience(tech: string, h: ResearchHorizon): boolean {
  return reachMissingPacks(tech, h).length === 0;
}

/** TURD choice state for a sub-tech given current selections:
 *  active = this choice selected; pickable = master undecided (free to choose);
 *  blocked = a DIFFERENT choice on this master is selected (needs respec). */
function turdStateFor(
  subTech: string,
  master: string | null,
  selections: Map<string, string>,
): "active" | "pickable" | "blocked" {
  if (!master) return selections.has(subTech) ? "active" : "pickable";
  const sel = selections.get(master);
  if (sel === subTech) return "active";
  if (sel) return "blocked";
  return "pickable";
}

export type RecipeAvail = {
  research: "enabled" | "available" | "needs-research";
  needs: string[]; // gating science packs (when needs-research)
  turd: {
    master: string | null;
    masterDisplay: string | null;
    choice: string | null;
    state: "active" | "pickable" | "blocked";
  } | null;
  availableNow: boolean; // reached research AND turd not blocked (pickable counts)
  buildableNow: boolean; // reached research AND turd ACTIVE — i.e. no unmade pick
};
function computeAvail(
  enabled: boolean,
  unlocks: ReturnType<typeof recipeLockState>,
  h: ResearchHorizon,
  selections: Map<string, string>,
): RecipeAvail {
  const turdU = unlocks.find((u) => u.isTurdSub);
  const turd = turdU
    ? {
        master: turdU.master,
        masterDisplay: turdU.masterDisplay,
        choice: turdU.display,
        state: turdStateFor(turdU.tech, turdU.master, selections),
      }
    : null;
  let research: RecipeAvail["research"];
  let needs: string[] = [];
  if (enabled) research = "enabled";
  else {
    // reachable via ANY unlocking tech; else the missing packs across all of them
    const missing = unlocks.map((u) => reachMissingPacks(u.tech, h));
    if (missing.some((m) => m.length === 0)) research = "available";
    else {
      research = "needs-research";
      needs = [...new Set(missing.flat())];
    }
  }
  const reached = research !== "needs-research";
  // availableNow: a 'pickable' (researched-but-undecided) master counts — picking
  // is still ahead. buildableNow is the stricter NOW-planning gate: only an ACTIVE
  // choice (or a non-TURD recipe) is truly buildable without an unmade commitment.
  const availableNow = reached && (!turd || turd.state !== "blocked");
  const buildableNow = reached && (!turd || turd.state === "active");
  return { research, needs, turd, availableNow, buildableNow };
}

/** Request-scoped bulk lookup context for a block solve. It is deliberately not
 * process-wide state: each solve gets a coherent SQLite snapshot without paying
 * the old N+1 query cost. */
export function createBlockSolveContext(recipeNames: string[]) {
  const recipeMap = recipesByName(recipeNames);
  const machineMap = machinesForRecipes(recipeNames);
  const horizon = getResearchHorizon();
  const selections = getTurdSelections();
  const producerCache = new Map<string, RecipeSummaryRow[]>();
  const lockCache = new Map<string, RecipeLockState>();
  const itemCache = new Map<string, ReturnType<typeof getItem>>();
  const fluidCache = new Map<string, ReturnType<typeof getFluid>>();
  let techGraph: {
    prereqsByTech: Map<string, string[]>;
    packsByTech: Map<string, string[]>;
    closureCache: Map<string, { techs: Set<string>; packs: Set<string> }>;
  } | null = null;

  const graph = () => {
    if (techGraph) return techGraph;
    const prereqsByTech = new Map<string, string[]>();
    for (const p of db
      .select({ tech: techPrerequisites.technology, prerequisite: techPrerequisites.prerequisite })
      .from(techPrerequisites)
      .all()) {
      const list = prereqsByTech.get(p.tech) ?? [];
      list.push(p.prerequisite);
      prereqsByTech.set(p.tech, list);
    }
    const packsByTech = new Map<string, string[]>();
    for (const p of db
      .select({ tech: techIngredients.technology, name: techIngredients.name })
      .from(techIngredients)
      .all()) {
      const list = packsByTech.get(p.tech) ?? [];
      list.push(p.name);
      packsByTech.set(p.tech, list);
    }
    techGraph = { prereqsByTech, packsByTech, closureCache: new Map() };
    return techGraph;
  };

  const closure = (tech: string) => {
    const g = graph();
    const cached = g.closureCache.get(tech);
    if (cached) return cached;
    const techs = new Set<string>();
    const packs = new Set<string>();
    const stack = [tech];
    while (stack.length) {
      const cur = stack.pop()!;
      if (techs.has(cur)) continue;
      techs.add(cur);
      for (const pack of g.packsByTech.get(cur) ?? []) packs.add(pack);
      for (const pre of g.prereqsByTech.get(cur) ?? []) if (!techs.has(pre)) stack.push(pre);
    }
    const out = { techs, packs };
    g.closureCache.set(tech, out);
    return out;
  };

  const missingPacks = (tech: string): string[] => {
    if (horizon.researched.has(tech)) return [];
    const c = closure(tech);
    const relevant = horizon.researched.size
      ? (() => {
          const packs = new Set<string>();
          const g = graph();
          for (const t of c.techs) {
            if (horizon.researched.has(t)) continue;
            for (const p of g.packsByTech.get(t) ?? []) packs.add(p);
          }
          return packs;
        })()
      : c.packs;
    return [...relevant].filter((p) => !horizon.packs.has(p));
  };

  const computeAvailInContext = (enabled: boolean, unlocks: RecipeLockState): RecipeAvail => {
    const turdU = unlocks.find((u) => u.isTurdSub);
    const turd = turdU
      ? {
          master: turdU.master,
          masterDisplay: turdU.masterDisplay,
          choice: turdU.display,
          state: turdStateFor(turdU.tech, turdU.master, selections),
        }
      : null;
    let research: RecipeAvail["research"];
    let needs: string[] = [];
    if (enabled) research = "enabled";
    else {
      const missing = unlocks.map((u) => missingPacks(u.tech));
      if (missing.some((m) => m.length === 0)) research = "available";
      else {
        research = "needs-research";
        needs = [...new Set(missing.flat())];
      }
    }
    const reached = research !== "needs-research";
    const availableNow = reached && (!turd || turd.state !== "blocked");
    const buildableNow = reached && (!turd || turd.state === "active");
    return { research, needs, turd, availableNow, buildableNow };
  };

  const producersFor = (names: string[]) => {
    const missing = [...new Set(names)].filter((name) => !producerCache.has(name));
    if (missing.length)
      for (const [name, rows] of recipesProducingByGoods(missing)) producerCache.set(name, rows);
    for (const name of missing) if (!producerCache.has(name)) producerCache.set(name, []);
  };

  const locksFor = (names: string[]) => {
    const missing = [...new Set(names)].filter((name) => !lockCache.has(name));
    if (missing.length)
      for (const [name, rows] of recipeLockStatesByRecipe(missing)) lockCache.set(name, rows);
    for (const name of missing) if (!lockCache.has(name)) lockCache.set(name, []);
  };

  const recipesFor = (names: string[]) => {
    const missing = [...new Set(names)].filter((name) => !recipeMap.has(name));
    if (missing.length)
      for (const [name, recipe] of recipesByName(missing)) recipeMap.set(name, recipe);
  };

  const displayFor = (name: string): string =>
    (itemCache.has(name) ? itemCache.get(name) : null)?.display ??
    (fluidCache.has(name) ? fluidCache.get(name) : null)?.display ??
    (() => {
      if (!itemCache.has(name)) itemCache.set(name, getItem(name));
      if (itemCache.get(name)) return itemCache.get(name)!.display ?? name;
      if (!fluidCache.has(name)) fluidCache.set(name, getFluid(name));
      return fluidCache.get(name)?.display ?? name;
    })();

  const availableProducedGoods = (names: string[], strictNow: boolean): Set<string> => {
    if (!names.length) return new Set();
    if (horizon.mode === "future") return obtainableGoods(names);
    producersFor(names);
    const producerRecipes = [
      ...new Set(names.flatMap((name) => producerCache.get(name)?.map((r) => r.name) ?? [])),
    ];
    locksFor(producerRecipes);
    const out = new Set<string>();
    for (const name of new Set(names)) {
      const ok = (producerCache.get(name) ?? []).some((r) => {
        const a = computeAvailInContext(r.enabled, lockCache.get(r.name) ?? []);
        return strictNow && horizon.mode === "now" ? a.buildableNow : a.availableNow;
      });
      if (ok) out.add(name);
    }
    return out;
  };

  return {
    productivityBonuses: (): ProductivityBonuses => {
      const out: ProductivityBonuses = { mining: 0, recipes: new Map() };
      const m = metaAll();
      const liveMining =
        horizon.mode === "now" ? Number(m.research_mining_productivity_bonus ?? NaN) : NaN;
      const hasLiveMining = Number.isFinite(liveMining);
      const liveRecipes = horizon.mode === "now" ? parseRecipeProductivityBonuses(m) : null;
      for (const r of db.select().from(techProductivityBonuses).all()) {
        if (horizon.mode !== "future" && missingPacks(r.technology).length > 0) continue;
        if (r.recipe === "") {
          if (!hasLiveMining) out.mining += r.modifier;
        } else if (!liveRecipes) {
          out.recipes.set(r.recipe, (out.recipes.get(r.recipe) ?? 0) + r.modifier);
        }
      }
      if (hasLiveMining) out.mining = liveMining;
      if (liveRecipes) out.recipes = liveRecipes;
      return out;
    },
    getRecipe: (name: string) => {
      recipesFor([name]);
      return recipeMap.get(name) ?? null;
    },
    machinesForRecipe: (name: string) => machineMap.get(name)?.slice() ?? machinesForRecipe(name),
    recipesProducing: (name: string) => {
      producersFor([name]);
      return producerCache.get(name) ?? [];
    },
    availableMachines: (names: string[]) => availableProducedGoods(names, false),
    unlockedItems: (names: string[]) => availableProducedGoods(names, true),
    getItem: (name: string) => {
      if (!itemCache.has(name)) itemCache.set(name, getItem(name));
      return itemCache.get(name) ?? null;
    },
    getFluid: (name: string) => {
      if (!fluidCache.has(name)) fluidCache.set(name, getFluid(name));
      return fluidCache.get(name) ?? null;
    },
    buildCost: (buildings: { name: string; count: number }[]): BuildCost => {
      const active = buildings
        .map((b) => ({ ...b, count: Math.ceil(b.count - 1e-6) }))
        .filter((b) => b.count > 0);
      producersFor(active.map((b) => b.name));
      const picks = new Map(
        active.map((b) => {
          const crafts = producerCache.get(b.name) ?? [];
          return [b.name, crafts.find((r) => r.enabled) ?? crafts[0] ?? null] as const;
        }),
      );
      recipesFor([...picks.values()].flatMap((p) => (p ? [p.name] : [])));

      const materials = new Map<string, { kind: string; amount: number }>();
      const used: BuildCost["buildings"] = [];
      for (const b of active) {
        const pick = picks.get(b.name) ?? null;
        const def = pick ? (recipeMap.get(pick.name) ?? null) : null;
        used.push({
          name: b.name,
          display: displayFor(b.name),
          count: b.count,
          recipe: pick?.name ?? null,
        });
        if (!def) continue;
        const per = def.products.find((p) => p.name === b.name)?.amount ?? 1;
        if (per <= 0) continue;
        for (const ing of def.ingredients) {
          const cur = materials.get(ing.name) ?? { kind: ing.kind, amount: 0 };
          cur.amount += (ing.amount * b.count) / per;
          materials.set(ing.name, cur);
        }
      }
      return {
        buildings: used,
        materials: [...materials]
          .map(([name, v]) => ({ name, kind: v.kind, display: displayFor(name), amount: v.amount }))
          .sort((a, b) => (a.display < b.display ? -1 : 1)),
      };
    },
  };
}

/** Availability of one recipe vs the research horizon + TURD selections, with
 * the unlocking techs' display names (for lock badges). Lighter than a full
 * `recipeCandidates` row — used by the dependency explorer (#100). */
export function recipeAvailability(
  name: string,
  enabled: boolean,
): { avail: RecipeAvail; unlockedBy: string[] } {
  const unlocks = recipeLockState(name);
  const avail = computeAvail(enabled, unlocks, getResearchHorizon(), getTurdSelections());
  return { avail, unlockedBy: enabled ? [] : unlocks.map((u) => u.display) };
}

/** Set-oriented availability for request-sized recipe lists. */
export function recipeAvailabilities(recipeRows: { name: string; enabled: boolean }[]) {
  const rows = [...new Map(recipeRows.map((row) => [row.name, row])).values()];
  const selections = getTurdSelections();
  const locks = recipeLockStatesByRecipe(
    rows.map((row) => row.name),
    new Set(selections.values()),
  );
  const availability = computeAvailByRecipe(rows, locks, getResearchHorizon(), selections);
  return new Map(
    rows.map((row) => {
      const unlocks = locks.get(row.name) ?? [];
      return [
        row.name,
        {
          avail: availability.get(row.name)!,
          unlockedBy: row.enabled ? [] : unlocks.map((unlock) => unlock.display),
        },
      ] as const;
    }),
  );
}

/* ── Browser (items / fluids / recipes with full context) ───────────────────── */

/** Search items AND fluids by internal or display name. */
export function searchAll(query: string, limit = 50, excluded = createExclusionMatcher()) {
  // hyphen/underscore-insensitive name match ("copper plate" -> copper-plate) + display
  const q = query.trim().toLowerCase();
  const nq = q.replace(/[-_\s]+/g, " ");
  const namePat = `%${nq}%`;
  const dispPat = `%${q}%`;
  const nameMatch = (col: AnyColumn, disp: AnyColumn) =>
    sql`replace(replace(lower(${col}), '-', ' '), '_', ' ') LIKE ${namePat} OR lower(${disp}) LIKE ${dispPat}`;
  const itemRows = db
    .select({
      name: items.name,
      display: items.display,
      kind: sql<string>`'item'`,
      subgroup: items.subgroup,
    })
    .from(items)
    .where(nameMatch(items.name, items.display))
    .limit(limit + 30)
    .all()
    .filter((r) => !excluded(r.name, r.subgroup))
    .map((r) => ({ name: r.name, display: r.display, kind: r.kind }));
  const fluidRows = db
    .select({ name: fluids.name, display: fluids.display, kind: sql<string>`'fluid'` })
    .from(fluids)
    .where(nameMatch(fluids.name, fluids.display))
    .limit(limit)
    .all()
    .filter((r) => !excluded(r.name));
  // exact/prefix matches first, then alphabetical (q defined above)
  const rank = (r: { name: string; display: string | null }) => {
    const n = r.name.toLowerCase();
    const d = (r.display ?? "").toLowerCase();
    if (n === q || d === q) return 0;
    if (n.startsWith(q) || d.startsWith(q)) return 1;
    return 2;
  };
  return [...itemRows, ...fluidRows]
    .sort((a, b) => rank(a) - rank(b) || (a.display ?? a.name).localeCompare(b.display ?? b.name))
    .slice(0, limit);
}

/** Compact unlock/lock state for recipe lists: how a recipe becomes available
 * and whether the current TURD selections already grant it. */
export function recipeLockState(name: string) {
  const selections = new Set(getTurdSelections().values());
  const unlocks = db
    .select({ tech: techUnlocks.technology })
    .from(techUnlocks)
    .where(eq(techUnlocks.recipe, name))
    .all()
    .map(({ tech }) => {
      const t = db.select().from(technologies).where(eq(technologies.name, tech)).get();
      const isTurdSub =
        db
          .select({ n: sql<number>`count(*)` })
          .from(techPrerequisites)
          .where(
            and(
              eq(techPrerequisites.technology, tech),
              eq(techPrerequisites.prerequisite, `turd-select-${tech}`),
            ),
          )
          .get()!.n > 0;
      const science = db
        .select({ name: techIngredients.name, amount: techIngredients.amount })
        .from(techIngredients)
        .where(eq(techIngredients.technology, tech))
        .all();
      const master = isTurdSub ? turdMasterOf(tech) : null;
      return {
        tech,
        display: t?.display ?? tech,
        science,
        isTurdSub,
        master: master?.name ?? null,
        masterDisplay: master?.display ?? null,
        turdSelected: isTurdSub && selections.has(tech),
      };
    });
  return unlocks;
}

type RecipeLockState = ReturnType<typeof recipeLockState>;

function recipeLockStatesByRecipe(
  recipeNames: string[],
  selections = new Set(getTurdSelections().values()),
): Map<string, RecipeLockState> {
  const uniq = [...new Set(recipeNames)].filter((n) => n);
  const out = new Map<string, RecipeLockState>();
  for (const name of uniq) out.set(name, []);
  if (!uniq.length) return out;

  const unlockRows = db
    .select({ recipe: techUnlocks.recipe, tech: techUnlocks.technology })
    .from(techUnlocks)
    .where(inArray(techUnlocks.recipe, uniq))
    .all();
  const techNames = [...new Set(unlockRows.map((r) => r.tech))];
  if (!techNames.length) return out;

  const techRows = new Map(
    db
      .select()
      .from(technologies)
      .where(inArray(technologies.name, techNames))
      .all()
      .map((t) => [t.name, t]),
  );
  const prereqsByTech = new Map<string, string[]>();
  for (const p of db
    .select({ tech: techPrerequisites.technology, prerequisite: techPrerequisites.prerequisite })
    .from(techPrerequisites)
    .where(inArray(techPrerequisites.technology, techNames))
    .all()) {
    const list = prereqsByTech.get(p.tech) ?? [];
    list.push(p.prerequisite);
    prereqsByTech.set(p.tech, list);
  }
  const masterNames = [
    ...new Set(
      [...prereqsByTech.values()].flatMap((ps) => ps.filter((p) => !p.startsWith("turd-select-"))),
    ),
  ];
  const masterRows = masterNames.length
    ? new Map(
        db
          .select({ name: technologies.name, display: technologies.display })
          .from(technologies)
          .where(inArray(technologies.name, masterNames))
          .all()
          .map((t) => [t.name, t.display]),
      )
    : new Map<string, string | null>();
  const scienceByTech = new Map<string, { name: string; amount: number }[]>();
  for (const s of db
    .select({
      tech: techIngredients.technology,
      name: techIngredients.name,
      amount: techIngredients.amount,
    })
    .from(techIngredients)
    .where(inArray(techIngredients.technology, techNames))
    .all()) {
    const list = scienceByTech.get(s.tech) ?? [];
    list.push({ name: s.name, amount: s.amount });
    scienceByTech.set(s.tech, list);
  }

  for (const { recipe, tech } of unlockRows) {
    const prereqs = prereqsByTech.get(tech) ?? [];
    const isTurdSub = prereqs.includes(`turd-select-${tech}`);
    const master = isTurdSub ? (prereqs.find((p) => !p.startsWith("turd-select-")) ?? null) : null;
    const list = out.get(recipe) ?? [];
    list.push({
      tech,
      display: techRows.get(tech)?.display ?? tech,
      science: scienceByTech.get(tech) ?? [],
      isTurdSub,
      master,
      masterDisplay: master ? (masterRows.get(master) ?? master) : null,
      turdSelected: isTurdSub && selections.has(tech),
    });
    out.set(recipe, list);
  }
  return out;
}

/** Availability for several recipes with one request-scoped technology graph.
 * This mirrors computeAvail without recursively querying each unlock's closure. */
function computeAvailByRecipe(
  recipeRows: { name: string; enabled: boolean }[],
  locksByRecipe: Map<string, RecipeLockState>,
  h: ResearchHorizon,
  selections: Map<string, string>,
): Map<string, RecipeAvail> {
  const techNames = [
    ...new Set(
      recipeRows.flatMap((recipe) =>
        (locksByRecipe.get(recipe.name) ?? []).map((unlock) => unlock.tech),
      ),
    ),
  ];
  const prereqsByTech = new Map<string, string[]>();
  const packsByTech = new Map<string, string[]>();
  if (techNames.length) {
    for (const row of db
      .select({
        technology: techPrerequisites.technology,
        prerequisite: techPrerequisites.prerequisite,
      })
      .from(techPrerequisites)
      .all()) {
      const list = prereqsByTech.get(row.technology) ?? [];
      list.push(row.prerequisite);
      prereqsByTech.set(row.technology, list);
    }
    for (const row of db
      .select({ technology: techIngredients.technology, name: techIngredients.name })
      .from(techIngredients)
      .all()) {
      const list = packsByTech.get(row.technology) ?? [];
      list.push(row.name);
      packsByTech.set(row.technology, list);
    }
  }
  const missingByTech = new Map<string, string[]>();
  const missingPacks = (tech: string): string[] => {
    const cached = missingByTech.get(tech);
    if (cached) return cached;
    if (h.researched.has(tech)) {
      missingByTech.set(tech, []);
      return [];
    }
    const closure = new Set<string>();
    const stack = [tech];
    while (stack.length) {
      const current = stack.pop()!;
      if (closure.has(current)) continue;
      closure.add(current);
      for (const prerequisite of prereqsByTech.get(current) ?? []) stack.push(prerequisite);
    }
    const relevant = h.researched.size
      ? [...closure].filter((technology) => !h.researched.has(technology))
      : [...closure];
    const missing = [
      ...new Set(relevant.flatMap((technology) => packsByTech.get(technology) ?? [])),
    ].filter((pack) => !h.packs.has(pack));
    missingByTech.set(tech, missing);
    return missing;
  };
  const out = new Map<string, RecipeAvail>();
  for (const recipe of recipeRows) {
    const unlocks = locksByRecipe.get(recipe.name) ?? [];
    const turdUnlock = unlocks.find((unlock) => unlock.isTurdSub);
    const turd = turdUnlock
      ? {
          master: turdUnlock.master,
          masterDisplay: turdUnlock.masterDisplay,
          choice: turdUnlock.display,
          state: turdStateFor(turdUnlock.tech, turdUnlock.master, selections),
        }
      : null;
    let research: RecipeAvail["research"];
    let needs: string[] = [];
    if (recipe.enabled) research = "enabled";
    else {
      const missing = unlocks.map((unlock) => missingPacks(unlock.tech));
      if (missing.some((packs) => packs.length === 0)) research = "available";
      else {
        research = "needs-research";
        needs = [...new Set(missing.flat())];
      }
    }
    const reached = research !== "needs-research";
    out.set(recipe.name, {
      research,
      needs,
      turd,
      availableNow: reached && (!turd || turd.state !== "blocked"),
      buildableNow: reached && (!turd || turd.state === "active"),
    });
  }
  return out;
}

/* ── TURD-set consistency (one choice per master; plans must not conflict) ───── */

export type TurdReq = {
  master: string;
  masterDisplay: string;
  sub: string;
  choice: string;
  recipe: string;
};
/** The TURD choices a recipe set REQUIRES — only for recipes that are turd-GATED
 * (their sole unlock is a single turd sub-tech; recipes also reachable by plain
 * research, or by any of several turd choices, impose no strict requirement). */
export function turdRequirements(recipeNames: string[]): TurdReq[] {
  const reqs: TurdReq[] = [];
  const uniq = Array.from(new Set(recipeNames));
  const locksByRecipe = recipeLockStatesByRecipe(uniq);
  for (const name of uniq) {
    const unlocks = locksByRecipe.get(name) ?? [];
    const turdU = unlocks.filter((u) => u.isTurdSub);
    const plainU = unlocks.filter((u) => !u.isTurdSub);
    if (turdU.length !== 1 || plainU.length) continue; // not strictly turd-gated
    const u = turdU[0];
    if (u.master)
      reqs.push({
        master: u.master,
        masterDisplay: u.masterDisplay ?? u.master,
        sub: u.tech,
        choice: u.display ?? u.tech,
        recipe: name,
      });
  }
  return reqs;
}

export type TurdConsistency = {
  ok: boolean;
  conflicts: {
    master: string;
    masterDisplay: string;
    choices: { sub: string; choice: string; recipes: string[] }[];
  }[];
  selections: {
    master: string;
    masterDisplay: string;
    requiredSub: string;
    requiredChoice: string;
    current: string | null;
    action: "already-selected" | "pick" | "switch";
  }[];
};
/** Check a recipe set for TURD consistency: conflicts (two recipes need DIFFERENT
 * choices of the same master — infeasible) + the selections the plan implies vs
 * the user's current TURD selections (already-selected / pick / switch). */
export function checkTurdConsistency(recipeNames: string[]): TurdConsistency {
  const reqs = turdRequirements(recipeNames);
  const selections = getTurdSelections();
  const byMaster = new Map<string, TurdReq[]>();
  for (const r of reqs) {
    const a = byMaster.get(r.master) ?? [];
    a.push(r);
    byMaster.set(r.master, a);
  }
  const conflicts: TurdConsistency["conflicts"] = [];
  const selActions: TurdConsistency["selections"] = [];
  for (const [master, rs] of byMaster) {
    const subs = Array.from(new Set(rs.map((r) => r.sub)));
    const masterDisplay = rs[0].masterDisplay;
    if (subs.length > 1) {
      conflicts.push({
        master,
        masterDisplay,
        choices: subs.map((sub) => ({
          sub,
          choice: rs.find((r) => r.sub === sub)!.choice,
          recipes: rs.filter((r) => r.sub === sub).map((r) => r.recipe),
        })),
      });
    } else {
      const current = selections.get(master) ?? null;
      selActions.push({
        master,
        masterDisplay,
        requiredSub: subs[0],
        requiredChoice: rs[0].choice,
        current,
        action: current === subs[0] ? "already-selected" : current ? "switch" : "pick",
      });
    }
  }
  return { ok: conflicts.length === 0, conflicts, selections: selActions };
}

/** Every recipe used across all existing blocks (for factory-wide checks). */
export function allBlockRecipes(): string[] {
  return [
    ...new Set(
      db
        .select({ data: blocks.data })
        .from(blocks)
        .all()
        .flatMap((r) => r.data.recipes ?? []),
    ),
  ];
}

/** Recipe-picker candidates (producing/consuming X) with lock + TURD state.
 * Recipes and buildings unlocked in the synced save rank first, followed by
 * other horizon-usable choices and then locked choices; cost breaks ties inside
 * each group. A candidate is usable only when both its recipe and at least one
 * compatible building are available under the selected planning horizon. */
export function recipeCandidatesBatch(names: string[], mode: "produce" | "consume") {
  const uniq = [...new Set(names)].filter((name) => name);
  if (!uniq.length) return new Map<string, never[]>();

  const exclusions = exclusionGlobs();
  const baseByGood =
    mode === "produce" ? recipesProducingByGoods(uniq) : recipesConsumingByGoods(uniq);
  for (const [good, rows] of baseByGood)
    baseByGood.set(
      good,
      rows.filter((r) => !matchesExclusion(exclusions, r.name, r.category, r.subgroup)),
    );
  const allBase = [...baseByGood.values()].flat();
  const recipeNames = [...new Set(allBase.map((recipe) => recipe.name))];
  const costs = recipeCosts(recipeNames);
  const supersededMap = turdSuperseded(recipeNames);
  const recipesByNameMap = recipesByName(recipeNames);
  const selections = getTurdSelections();
  const locksByRecipe = recipeLockStatesByRecipe(recipeNames, new Set(selections.values()));
  const researched = syncedResearchedTechs();
  const horizon = getResearchHorizon();
  const availability = computeAvailByRecipe(allBase, locksByRecipe, horizon, selections);
  const machineOptions = machineOptionsForRecipes(recipeNames);
  const comp = (c: {
    kind: string;
    name: string;
    display: string | null;
    amount?: number | null;
  }) => ({
    kind: c.kind,
    name: c.name,
    display: c.display,
    amount: c.amount ?? 0,
  });
  const entries = uniq.map((name) => {
    const rows = (baseByGood.get(name) ?? []).map((r) => {
      const unlocks = locksByRecipe.get(r.name) ?? [];
      const turd = unlocks.find((u) => u.isTurdSub);
      const avail = availability.get(r.name)!;
      const available = r.enabled || (turd ? turd.turdSelected : unlocks.length > 0); // tech-locked counts as obtainable
      const machines = (machineOptions.get(r.name) ?? [])
        .slice()
        .sort((a, b) => a.craftingSpeed - b.craftingSpeed);
      const machineAvailable =
        machines.length === 0 ||
        (horizon.mode === "future"
          ? machines.some((machine) => machine.startEnabled || machine.unlockedBy.length > 0)
          : machines.some((machine) => machine.availableNow));
      const recipeAvailable =
        horizon.mode === "future"
          ? available
          : horizon.mode === "now"
            ? avail.buildableNow
            : avail.availableNow;
      const superseded = supersededMap.get(r.name) ?? null;
      const selectable = recipeAvailable && machineAvailable && !superseded;
      const recipeUnlockedNow = isRecipeUnlockedNow(r.enabled, unlocks, researched);
      const machineUnlockedNow =
        machines.length === 0 || machines.some((machine) => machine.unlockedNow);
      const unlockedNow = selectable && recipeUnlockedNow && machineUnlockedNow;
      // Cost orders each availability group independently. Superseded recipes
      // remain last because the selected TURD removed them in-game.
      const rank = unlockedNow ? 0 : selectable ? 1 : superseded ? 3 : 2;
      // io summary so lookalike recipes (Py loves reusing names) tell apart at a glance
      const full = recipesByNameMap.get(r.name);
      return {
        ...r,
        unlocks,
        turd: turd ?? null,
        available,
        avail,
        selectable,
        unlockedNow,
        horizonMode: horizon.mode,
        machineAvailability: {
          available: machineAvailable,
          options: machines.map((machine) => ({
            name: machine.name,
            display: machine.display,
            unlockedNow: machine.unlockedNow,
            availableNow: machine.availableNow,
            startEnabled: machine.startEnabled,
            unlockedBy: machine.unlockedBy,
          })),
        },
        rank,
        cost: costs.get(r.name) ?? null,
        superseded,
        ingredients: (full?.ingredients ?? []).map(comp),
        products: (full?.products ?? []).map((c) =>
          comp({
            ...c,
            amount:
              c.amount ??
              (c.amountMin != null && c.amountMax != null ? (c.amountMin + c.amountMax) / 2 : 0),
          }),
        ),
      };
    });
    return [
      name,
      rows.sort(
        (a, b) =>
          a.rank - b.rank ||
          (a.cost ?? Infinity) - (b.cost ?? Infinity) ||
          (a.display ?? a.name).localeCompare(b.display ?? b.name),
      ),
    ] as const;
  });
  return new Map(entries);
}

export function recipeCandidates(name: string, mode: "produce" | "consume") {
  return recipeCandidatesBatch([name], mode).get(name) ?? [];
}

/** A recipe with everything the browser shows on one row: io, machines,
 * unlock state (start-enabled / tech / TURD choice + whether it's active). */
function recipeCard(
  r: NonNullable<ReturnType<typeof getRecipe>>,
  machineRows: ReturnType<typeof machinesForRecipe>,
  unlocks: RecipeLockState,
) {
  const machines = machineRows.map((m) => ({
    name: m.name,
    display: m.display,
    craftingSpeed: m.craftingSpeed,
  }));
  return {
    name: r.name,
    display: r.display,
    category: r.category,
    energyRequired: r.energyRequired,
    enabled: r.enabled,
    hidden: r.hidden,
    ingredients: r.ingredients.map((c) => ({
      kind: c.kind,
      name: c.name,
      display: c.display,
      amount: c.amount,
    })),
    products: r.products.map((c) => ({
      kind: c.kind,
      name: c.name,
      display: c.display,
      amount:
        c.amount ??
        (c.amountMin != null && c.amountMax != null ? (c.amountMin + c.amountMax) / 2 : 0),
      amountMin: c.amountMin,
      amountMax: c.amountMax,
      probability: c.probability,
    })),
    machines,
    unlocks,
  };
}
export type RecipeCardData = ReturnType<typeof recipeCard>;

/** Everything the browser's detail pane needs for one item/fluid: recipe cards
 * enriched with the explorer measures (#97) — economy cost/flow/waste, the
 * research-horizon availability, and TURD supersession — so the UI can rank
 * producers/consumers by how much a sensible economy actually runs them. */
export function browseDetail(name: string) {
  const item = getItem(name);
  const fluid = getFluid(name);
  if (!item && !fluid) return null;
  const horizon = getResearchHorizon();
  const selections = getTurdSelections();
  const producedBy = recipesProducing(name);
  const consumedBy = recipesConsuming(name);
  const recipeNames = [...new Set([...producedBy, ...consumedBy].map((r) => r.name))];
  const recipeMap = recipesByName(recipeNames);
  const machineMap = machinesForRecipes(recipeNames);
  const lockMap = recipeLockStatesByRecipe(recipeNames);
  const eco = recipeEconomy(recipeNames);
  const superseded = turdSuperseded(recipeNames);
  const cards = (rs: { name: string }[]) => {
    return rs
      .map((row) => {
        const recipe = recipeMap.get(row.name);
        return recipe
          ? recipeCard(recipe, machineMap.get(row.name) ?? [], lockMap.get(row.name) ?? [])
          : null;
      })
      .filter((c): c is RecipeCardData => c !== null)
      .map((c) => ({
        ...c,
        ...(eco.get(c.name) ?? { cost: null, flow: null, waste: null }),
        avail: computeAvail(c.enabled, c.unlocks, horizon, selections),
        superseded: superseded.get(c.name) ?? null,
      }));
  };
  return {
    name,
    kind: fluid ? "fluid" : "item",
    display: item?.display ?? fluid?.display ?? name,
    item,
    fluid,
    // false until a cost-analysis recompute adds flow/waste (pre-#97 DBs)
    flowComputed: recipeFlowsComputed(),
    producedBy: cards(producedBy),
    consumedBy: cards(consumedBy),
  };
}

/** Name search over items (for the recipe/item browser). */
export function searchItems(query: string, limit = 50) {
  // Match against the internal name (with hyphens/underscores treated as spaces,
  // so "copper plate" finds "copper-plate") AND the display name, case-insensitive.
  const q = query.trim().toLowerCase();
  const nq = q.replace(/[-_\s]+/g, " ");
  const namePat = `%${nq}%`;
  const dispPat = `%${q}%`;
  return db
    .select({
      name: items.name,
      display: items.display,
      subgroup: items.subgroup,
      stackSize: items.stackSize,
    })
    .from(items)
    .where(
      sql`replace(replace(lower(${items.name}), '-', ' '), '_', ' ') LIKE ${namePat} OR lower(${items.display}) LIKE ${dispPat}`,
    )
    .limit(limit + 30)
    .all()
    .filter((r) => !isExcluded(r.name, r.subgroup)) // uncraftable EE / user-excluded
    .slice(0, limit);
}

/** All meta key/values (import provenance, data fingerprint, sync time). */
export function metaAll(): Record<string, string | null> {
  return Object.fromEntries(
    db
      .select()
      .from(meta)
      .all()
      .map((r) => [r.key, r.value]),
  );
}

export function metaSet(key: string, value: string) {
  db.insert(meta)
    .values({ key, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } })
    .run();
}

export function metaDelete(key: string) {
  db.delete(meta).where(eq(meta.key, key)).run();
}

/* ── Preferred defaults ("favorites") ────────────────────────────────────────
 * A remembered pick per interchangeable-choice CATEGORY, applied when a recipe
 * is first added to a block (see server recipeDefaultsFn) and baked into that
 * block's stored picks. Changing a favorite never rewrites existing blocks — the
 * solver fallback (lowest tier / cheapest fuel) is favorite-independent.
 *
 * `favorite_machines`: recipe crafting/resource category → machine name.
 * `favorite_fuels`:     fuel category → fuel item name. */
function readJsonMap(key: string): Record<string, string> {
  const raw = metaAll()[key];
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function getFavoriteMachines(): Record<string, string> {
  return readJsonMap("favorite_machines");
}

export function getFavoriteFuels(): Record<string, string> {
  return readJsonMap("favorite_fuels");
}

/** Set (or clear, when `machine` is null) the preferred machine for a category. */
export function setFavoriteMachine(category: string, machine: string | null) {
  const map = getFavoriteMachines();
  if (machine) map[category] = machine;
  else delete map[category];
  metaSet("favorite_machines", JSON.stringify(map));
}

/** Set (or clear, when `fuel` is null) the preferred fuel for a fuel category. */
export function setFavoriteFuel(fuelCategory: string, fuel: string | null) {
  const map = getFavoriteFuels();
  if (fuel) map[fuelCategory] = fuel;
  else delete map[fuelCategory];
  metaSet("favorite_fuels", JSON.stringify(map));
}

// (The old global "preferred fluid fuel" pick is gone: unfiltered fluid burners
// now draw from the shared pyops-fluid-fuel pool — which fluid fills the demand
// is a per-block choice of Burn recipe, not a per-machine fuel pick. See #25.)

/* ── Cost analysis lookups (LP shadow prices; see server/cost-analysis.ts) ──── */

export function goodCosts(names: string[]): Map<string, number> {
  if (!names.length) return new Map();
  return new Map(
    db
      .select({ name: costAnalysis.name, cost: costAnalysis.cost })
      .from(costAnalysis)
      .where(
        and(eq(costAnalysis.scope, "good"), inArray(costAnalysis.name, Array.from(new Set(names)))),
      )
      .all()
      .map((r) => [r.name, r.cost]),
  );
}

export function recipeCosts(names: string[]): Map<string, number> {
  if (!names.length) return new Map();
  return new Map(
    db
      .select({ name: costAnalysis.name, cost: costAnalysis.cost })
      .from(costAnalysis)
      .where(
        and(
          eq(costAnalysis.scope, "recipe"),
          inArray(costAnalysis.name, Array.from(new Set(names))),
        ),
      )
      .all()
      .map((r) => [r.name, r.cost]),
  );
}

export type RecipeEconomy = { cost: number | null; flow: number | null; waste: number | null };
/** Explorer measures per recipe (#97): execution cost, estimated economy flow
 * (the LP dual of the recipe's constraint), and waste share (0–1: how much of
 * the recipe's input value it destroys). Fields are null where the analysis
 * hasn't produced them — e.g. a DB whose cost analysis predates the flow/waste
 * scopes, until the next data sync or manual recompute. */
export function recipeEconomy(names: string[]): Map<string, RecipeEconomy> {
  const out = new Map<string, RecipeEconomy>();
  if (!names.length) return out;
  const rows = db
    .select({ scope: costAnalysis.scope, name: costAnalysis.name, cost: costAnalysis.cost })
    .from(costAnalysis)
    .where(
      and(
        inArray(costAnalysis.scope, ["recipe", "recipe-flow", "recipe-waste"]),
        inArray(costAnalysis.name, Array.from(new Set(names))),
      ),
    )
    .all();
  for (const r of rows) {
    const e = out.get(r.name) ?? { cost: null, flow: null, waste: null };
    if (r.scope === "recipe") e.cost = r.cost;
    else if (r.scope === "recipe-flow") e.flow = r.cost;
    else e.waste = r.cost;
    out.set(r.name, e);
  }
  return out;
}

/** Whether the stored cost analysis carries the explorer's flow/waste scopes —
 * false for a DB computed before #97, until a recompute or data sync. */
export function recipeFlowsComputed(): boolean {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(costAnalysis)
      .where(eq(costAnalysis.scope, "recipe-flow"))
      .get()!.n > 0
  );
}

/** Goods some reachable recipe produces (enabled, tech-unlockable, or
 * synthetic) — auto-fill must not pick creative/editor-only modules. */
export function obtainableGoods(names: string[]): Set<string> {
  if (!names.length) return new Set();
  const rows = db
    .selectDistinct({ name: recipeProducts.name })
    .from(recipeProducts)
    .innerJoin(recipes, eq(recipes.name, recipeProducts.recipe))
    .leftJoin(techUnlocks, eq(techUnlocks.recipe, recipes.name))
    .where(
      and(
        inArray(recipeProducts.name, Array.from(new Set(names))),
        eq(recipes.hidden, false),
        sql`(${recipes.enabled} = 1 OR ${recipes.kind} != 'real' OR ${techUnlocks.recipe} IS NOT NULL)`,
      ),
    )
    .all();
  return new Set(rows.map((r) => r.name));
}

/** Cheap producer/consumer fan-out counts for a good (non-hidden recipes only).
 * Powers the additive classifier: ubiquitous commodities are imported, narrow
 * intermediates are built. See server/additives.ts for the policy. */
export function goodGraphCounts(name: string): { producers: number; consumers: number } {
  const producers = db
    .select({ n: sql<number>`count(distinct ${recipeProducts.recipe})` })
    .from(recipeProducts)
    .innerJoin(recipes, and(eq(recipes.name, recipeProducts.recipe), eq(recipes.hidden, false)))
    .where(eq(recipeProducts.name, name))
    .get()!.n;
  const consumers = db
    .select({ n: sql<number>`count(distinct ${recipeIngredients.recipe})` })
    .from(recipeIngredients)
    .innerJoin(recipes, and(eq(recipes.name, recipeIngredients.recipe), eq(recipes.hidden, false)))
    .where(eq(recipeIngredients.name, name))
    .get()!.n;
  return { producers, consumers };
}

export function costAnalysisCount(): number {
  return db
    .select({ n: sql<number>`count(*)` })
    .from(costAnalysis)
    .get()!.n;
}

/** Row counts — useful for a health check / "is the db loaded" probe. */
/** Which data-driven, mod-specific surfaces the loaded dataset actually supports,
 * so the UI can hide features that have no data behind them (e.g. TURD when the
 * Pyanodons alien-life mods aren't part of the synced mod set). Keyed on the data
 * being present, not on sniffing for a named mod — see #68 for the broader
 * mod-agnostic goal. */
export function dataCapabilities(): { hasTurd: boolean } {
  const turd = (
    db
      .select({ n: sql<number>`count(*)` })
      .from(technologies)
      .where(eq(technologies.isTurd, true))
      .get() as { n: number }
  ).n;
  return { hasTurd: turd > 0 };
}

export function stats() {
  const count = (t: Parameters<ReturnType<typeof db.select>["from"]>[0]) =>
    (
      db
        .select({ n: sql<number>`count(*)` })
        .from(t)
        .get() as { n: number }
    ).n;
  return {
    recipes: count(recipes),
    items: count(items),
    fluids: count(fluids),
    craftingMachines: count(craftingMachines),
  };
}
