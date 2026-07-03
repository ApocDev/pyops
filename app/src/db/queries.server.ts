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
import { and, eq, inArray, isNotNull, sql, type AnyColumn } from "drizzle-orm";
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
import { goalNames, normalizeBlockData, primaryRate } from "../lib/goals.ts";
import { prodScaledAmount } from "../lib/productivity.ts";
import { relevantRecipes, type RecipeDef } from "../solver/block.ts";

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
};

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

/** Recipes that OUTPUT the given item/fluid (the candidate recipes for making X). */
export function recipesProducing(name: string) {
  return db
    .selectDistinct(recipeSummary)
    .from(recipeProducts)
    .innerJoin(recipes, eq(recipes.name, recipeProducts.recipe))
    .where(eq(recipeProducts.name, name))
    .all();
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
      moduleSlots: craftingMachines.moduleSlots,
      energyUsageW: craftingMachines.energyUsageW,
      energySource: craftingMachines.energySource,
      pollutionPerMin: craftingMachines.pollutionPerMin,
      allowedEffects: craftingMachines.allowedEffects,
      allowedModuleCategories: craftingMachines.allowedModuleCategories,
      neighbourBonus: craftingMachines.neighbourBonus,
      burnsFluid: craftingMachines.burnsFluid,
      fluidFuelFilter: craftingMachines.fluidFuelFilter,
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
  const h = getResearchHorizon();
  const selections = getTurdSelections();
  const out = new Set<string>();
  for (const name of new Set(machineNames)) {
    const crafts = recipesProducing(name); // recipes that build the machine item
    const ok = crafts.some(
      (r) => computeAvail(r.enabled, recipeLockState(r.name), h, selections).availableNow,
    );
    if (ok) out.add(name);
  }
  return out;
}

/** Which of the given module items are UNLOCKED in the current horizon — a module
 * is available if some recipe producing it is reached. In NOW mode this is the
 * strict buildableNow (no unmade TURD pick); in target/future, availableNow.
 * Drives the agent's module auto-fill so it only places modules you can actually
 * have. See [[turd-planning-model]] for the buildableNow vs availableNow split. */
export function availableModuleItems(names: string[]): Set<string> {
  if (!names.length) return new Set();
  const h = getResearchHorizon();
  // FUTURE mode plans against the whole tech tree — anything producible is fair
  // game (availableNow would wrongly exclude not-yet-researched tiers).
  if (h.mode === "future") return obtainableGoods(names);
  const selections = getTurdSelections();
  const now = h.mode === "now";
  const out = new Set<string>();
  for (const name of new Set(names)) {
    const ok = recipesProducing(name).some((r) => {
      const a = computeAvail(r.enabled, recipeLockState(r.name), h, selections);
      return now ? a.buildableNow : a.availableNow;
    });
    if (ok) out.add(name);
  }
  return out;
}

/** Machines that can run a recipe, enriched with availability for the building
 * picker: whether the machine is buildable at game start, which techs unlock it
 * (its tier signal — e.g. smelters-mk04), and whether it's available right now. */
export function machineOptionsForRecipe(recipeName: string) {
  const machines = machinesForRecipe(recipeName);
  const available = availableMachines(machines.map((m) => m.name));
  const category = db
    .select({ category: recipes.category })
    .from(recipes)
    .where(eq(recipes.name, recipeName))
    .get()?.category;
  const favorite = category ? (getFavoriteMachines()[category] ?? null) : null;
  return machines.map((m) => {
    const crafts = recipesProducing(m.name); // recipes that build the machine item
    const startEnabled = crafts.some((r) => r.enabled);
    const unlockedBy = dedupeBy(
      crafts
        .flatMap((r) => recipeUnlocks(r.name))
        .map((u) => ({ tech: u.tech, display: u.display })),
      (u) => u.tech,
    );
    return {
      ...m,
      startEnabled,
      unlockedBy,
      availableNow: available.has(m.name),
      favorite: m.name === favorite,
    };
  });
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
 * the always-on hidden T.U.R.D. beacon (1:1, no slot cost), not placed by hand —
 * see turdChoices for a choice's module. */
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
        categoryAllowed(mod, m.allowedModuleCategories) && effectsAllowed(mod, m.allowedEffects),
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

  // hidden modules are TURD internals — game-inserted, never hand-placed
  const allModules = db
    .select()
    .from(modules)
    .where(eq(modules.hidden, false))
    .orderBy(modules.category, modules.tier, modules.name)
    .all();
  const prodOk = (mod: ModuleRow) => mod.effProductivity <= 0 || r.allowProductivity;
  const machineModules = allModules.filter(
    (mod) =>
      categoryAllowed(mod, m.allowedModuleCategories) &&
      categoryAllowed(mod, r.allowedModuleCategories) &&
      effectsAllowed(mod, m.allowedEffects) &&
      prodOk(mod),
  );

  const beaconRows = db
    .select()
    .from(beacons)
    .where(eq(beacons.hidden, false))
    .orderBy(beacons.name)
    .all();
  const beaconList = beaconRows.map((b) => ({
    name: b.name,
    display: b.display,
    distributionEffectivity: b.distributionEffectivity,
    moduleSlots: b.moduleSlots,
    energyUsageW: b.energyUsageW,
    profile: b.profile,
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
  const beaconModules = allModules.filter((mod) => beaconModuleNames.has(mod.name));

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

/** Sub-techs of a master: techs requiring BOTH the master and their own
 * turd-select gate. */
function turdSubTechs(masterName: string): string[] {
  return db
    .select({ technology: techPrerequisites.technology })
    .from(techPrerequisites)
    .where(eq(techPrerequisites.prerequisite, masterName))
    .all()
    .map((r) => r.technology)
    .filter(
      (t) =>
        db
          .select({ n: sql<number>`count(*)` })
          .from(techPrerequisites)
          .where(
            and(
              eq(techPrerequisites.technology, t),
              eq(techPrerequisites.prerequisite, `turd-select-${t}`),
            ),
          )
          .get()!.n > 0,
    );
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
  const selections = new Map(
    db
      .select()
      .from(turdSelections)
      .all()
      .map((s) => [s.masterTech, s.subTech]),
  );
  return masters
    .map((m) => ({
      name: m.name,
      display: m.display ?? m.name,
      description: stripRichText(m.description),
      science: db
        .select({ name: techIngredients.name, amount: techIngredients.amount })
        .from(techIngredients)
        .where(eq(techIngredients.technology, m.name))
        .all()
        .map((s) => ({ ...s, display: compDisplay("item", s.name) ?? s.name })),
      subTechs: turdSubTechs(m.name).map(buildTurdSub),
      selected: selections.get(m.name) ?? null,
    }))
    .filter((m) => m.subTechs.length > 0); // respec helpers are turd-flagged but offer no choices
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

/** Does this recipe produce a building (a crafting machine)? Used to decide whether
 * a TURD choice's module applies to the recipe's throughput. */
function recipeBuildsBuilding(recipe: string): boolean {
  const prods = db
    .select({ name: recipeProducts.name })
    .from(recipeProducts)
    .where(eq(recipeProducts.recipe, recipe))
    .all()
    .map((p) => p.name);
  if (!prods.length) return false;
  return !!db
    .select({ n: craftingMachines.name })
    .from(craftingMachines)
    .where(inArray(craftingMachines.name, prods))
    .get();
}

function buildTurdSub(sub: string) {
  const tech = db.select().from(technologies).where(eq(technologies.name, sub)).get();
  const mods = turdModulesOf(sub);
  const modNames = new Set(mods.map((mod) => mod.name));
  const unlocks = db
    .select({ recipe: techUnlocks.recipe })
    .from(techUnlocks)
    .where(eq(techUnlocks.technology, sub))
    .all()
    .map((u) => u.recipe)
    .filter((r) => !modNames.has(r)); // hide the hidden <sub>-module recipes
  // old→new swaps this branch performs, keyed by the new recipe it grants
  const oldByNew = new Map(
    db
      .select()
      .from(turdReplacements)
      .where(eq(turdReplacements.subTech, sub))
      .all()
      .map((r) => [r.newRecipe, r.oldRecipe] as const),
  );
  const changes: TurdChange[] = unlocks.map((to) => {
    const from = oldByNew.get(to) ?? null;
    return {
      from,
      fromDisplay: from ? (getRecipe(from)?.display ?? from) : null,
      to,
      toDisplay: getRecipe(to)?.display ?? to,
      buildsBuilding: recipeBuildsBuilding(to),
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
  const subs = turdSubTechs(masterName);
  if (!subs.length) return null;
  const selected = getTurdSelections().get(masterName) ?? null;
  return {
    master: masterName,
    masterDisplay: m.display ?? masterName,
    description: stripRichText(m.description),
    selected,
    choices: subs.map((sub) => {
      const s = buildTurdSub(sub);
      return { ...s, selected: s.name === selected };
    }),
  };
}

/** Masters a recipe touches: it's a TURD-gated unlock (the recipe a branch grants)
 * or a base recipe some branch replaces. */
function turdMastersForRecipe(recipe: string): string[] {
  const out = new Set<string>();
  for (const u of recipeLockState(recipe)) if (u.isTurdSub && u.master) out.add(u.master);
  for (const r of db
    .select()
    .from(turdReplacements)
    .where(eq(turdReplacements.oldRecipe, recipe))
    .all()) {
    const mo = turdMasterOf(r.subTech);
    if (mo) out.add(mo.name);
  }
  return [...out];
}

/** Masters relevant to a good: resolve every recipe that produces or consumes it,
 * then map those to their TURD masters. */
function turdMastersForGood(good: string): string[] {
  const recs = new Set<string>([
    ...db
      .select({ r: recipeProducts.recipe })
      .from(recipeProducts)
      .where(eq(recipeProducts.name, good))
      .all()
      .map((x) => x.r),
    ...db
      .select({ r: recipeIngredients.recipe })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.name, good))
      .all()
      .map((x) => x.r),
  ]);
  const out = new Set<string>();
  for (const r of recs) for (const mn of turdMastersForRecipe(r)) out.add(mn);
  return [...out];
}

/** Resolve TURD masters from a master tech name (or its sub-tech), a recipe, or a
 * good, and return full detail for each. Drives the assistant's turdChoices tool. */
export function turdChoicesLookup(opts: { master?: string; recipe?: string; good?: string }) {
  const masters = new Set<string>();
  if (opts.master) {
    const direct = db.select().from(technologies).where(eq(technologies.name, opts.master)).get();
    if (direct?.isTurd) masters.add(opts.master);
    else {
      const mo = turdMasterOf(opts.master); // maybe they passed a sub-tech name
      if (mo) masters.add(mo.name);
    }
  }
  if (opts.recipe) for (const mn of turdMastersForRecipe(opts.recipe)) masters.add(mn);
  if (opts.good) for (const mn of turdMastersForGood(opts.good)) masters.add(mn);
  return [...masters].map(turdMasterDetail).filter((d) => d !== null);
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
  const recDisplay = (n: string) => getRecipe(n)?.display ?? n;
  // subs whose OLD recipe the plan uses → group under their (unpicked) master
  const byMaster = new Map<string, { display: string | null; replaced: Set<string> }>();
  for (const r of db
    .select()
    .from(turdReplacements)
    .where(inArray(turdReplacements.oldRecipe, [...planSet]))
    .all()) {
    const master = turdMasterOf(r.subTech);
    if (!master || selections.has(master.name)) continue; // picked = locked in stone
    const e = byMaster.get(master.name) ?? { display: master.display, replaced: new Set<string>() };
    e.replaced.add(r.oldRecipe);
    byMaster.set(master.name, e);
  }
  const out = [];
  for (const [masterName, info] of byMaster) {
    const subs = turdSubTechs(masterName);
    // pickable-now gate: probe one branch recipe — reached AND turd 'pickable'
    // (master undecided) means it's a free choice the user could make right now.
    const probe = db
      .select({ n: turdReplacements.newRecipe })
      .from(turdReplacements)
      .where(inArray(turdReplacements.subTech, subs))
      .all()
      .map((r) => r.n)[0];
    if (!probe) continue;
    const avail = computeAvail(
      getRecipe(probe)?.enabled ?? false,
      recipeLockState(probe),
      h,
      selections,
    );
    if (!avail.availableNow || avail.turd?.state !== "pickable") continue; // not pickable now
    const options = subs.map((sub) => {
      const tech = db.select().from(technologies).where(eq(technologies.name, sub)).get();
      const reps = db
        .select()
        .from(turdReplacements)
        .where(eq(turdReplacements.subTech, sub))
        .all();
      return {
        sub,
        display: tech?.display ?? sub,
        replaces: reps.slice(0, 6).map((rp) => ({
          recipe: recDisplay(rp.oldRecipe),
          with: recDisplay(rp.newRecipe),
        })),
        moreReplacements: reps.length > 6 ? reps.length - 6 : undefined,
        modules: turdModulesOf(sub).map((m) => ({
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

export function setTurdSelection(masterTech: string, subTech: string | null) {
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
      enabled: blocks.enabled, // whole-block toggle (#73) — for sidebar dimming
      groupId: blocks.groupId,
      updatedAt: blocks.updatedAt,
      data: blocks.data,
    })
    .from(blocks)
    .orderBy(blocks.sortOrder, blocks.name)
    .all();
  // Health is derived from `data` against the CURRENT reference data (so an item
  // migration shows up immediately, no re-solve) plus the persisted last solve
  // status. One bulk lookup each, then pure per-block checks — `data` stays
  // server-side; only the verdict is exposed.
  const recipeNames = new Set(
    db
      .select({ n: recipes.name })
      .from(recipes)
      .all()
      .map((r) => r.n),
  );
  const goodNames = new Set([
    ...db
      .select({ n: items.name })
      .from(items)
      .all()
      .map((r) => r.n),
    ...db
      .select({ n: fluids.name })
      .from(fluids)
      .all()
      .map((r) => r.n),
  ]);
  // recipe → its product good names, for the "no recipe in the block makes this
  // goal" check (one scan of recipe_products, grouped).
  const productsByRecipe = new Map<string, Set<string>>();
  for (const p of db
    .select({ recipe: recipeProducts.recipe, name: recipeProducts.name })
    .from(recipeProducts)
    .all()) {
    let set = productsByRecipe.get(p.recipe);
    if (!set) productsByRecipe.set(p.recipe, (set = new Set()));
    set.add(p.name);
  }
  // recipe → its ingredient good names, for the "can this recipe reach a goal?"
  // check that mirrors the solver's unused-recipe pinning.
  const ingredientsByRecipe = new Map<string, Set<string>>();
  for (const p of db
    .select({ recipe: recipeIngredients.recipe, name: recipeIngredients.name })
    .from(recipeIngredients)
    .all()) {
    let set = ingredientsByRecipe.get(p.recipe);
    if (!set) ingredientsByRecipe.set(p.recipe, (set = new Set()));
    set.add(p.name);
  }
  return rows.map(({ data, solveStatus, ...b }) => {
    const d = normalizeBlockData(data as BlockData);
    const blockRecipes = d.recipes ?? [];
    const broken =
      blockRecipes.some((r) => !recipeNames.has(r)) || goalNames(d).some((g) => !goodNames.has(g));
    // a goal is "unmade" when it still exists but no recipe in the block produces it
    const makesInBlock = new Set<string>();
    for (const r of blockRecipes)
      for (const p of productsByRecipe.get(r) ?? []) makesInBlock.add(p);
    const unmadeGoals = goalNames(d).filter((g) => goodNames.has(g) && !makesInBlock.has(g));
    // Recipes that can't reach any in-block goal — the solver pins these to 0 and
    // the block still solves, so surface them here (mirrors the solver's check) or
    // the sidebar would go green on a block full of dead recipes. Only meaningful
    // when a goal is actually produced in-block; an explicit `balance` protects a
    // recipe from being flagged.
    let unusedCount = 0;
    if (goalNames(d).some((g) => makesInBlock.has(g))) {
      const pseudo: RecipeDef[] = blockRecipes.map((name) => ({
        name,
        energyRequired: 0,
        ingredients: [...(ingredientsByRecipe.get(name) ?? [])].map((n) => ({
          kind: "item",
          name: n,
          amount: 0,
        })),
        products: [...(productsByRecipe.get(name) ?? [])].map((n) => ({
          kind: "item",
          name: n,
          amount: 0,
        })),
      }));
      const relevant = relevantRecipes(pseudo, goalNames(d));
      const balanced = new Set(
        Object.entries(d.dispositions ?? {}).flatMap(([k, v]) => (v === "balance" ? [k] : [])),
      );
      unusedCount = pseudo.filter((r, i) => {
        if (relevant.has(i)) return false;
        const touches = (c: { name: string }) => balanced.has(c.name);
        return !(balanced.size && (r.ingredients.some(touches) || r.products.some(touches)));
      }).length;
    }
    const health: BlockHealth =
      broken || solveStatus === "infeasible"
        ? "error"
        : unmadeGoals.length > 0 ||
            unusedCount > 0 ||
            solveStatus === "relaxed" ||
            solveStatus === "underdetermined"
          ? "warn"
          : "ok";
    return {
      ...b,
      broken,
      health,
      unmadeGoals,
      unusedCount,
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
  db.transaction((tx) => {
    ids.forEach((id, i) => tx.update(blocks).set({ sortOrder: i }).where(eq(blocks.id, id)).run());
  });
}
/** Persist a manual folder order (block_groups.sort_order = position). */
export function setGroupOrder(ids: number[]) {
  db.transaction((tx) => {
    ids.forEach((id, i) =>
      tx.update(blockGroups).set({ sortOrder: i }).where(eq(blockGroups.id, id)).run(),
    );
  });
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
export function blockReferenceFingerprint(data: BlockData): string {
  const parts: string[] = [];
  for (const name of [...new Set(data.recipes ?? [])].sort())
    parts.push(`R ${name} ${recipeSignature(name)}`);
  for (const g of goalNames(normalizeBlockData(data)).sort())
    parts.push(`G ${g} ${goodExists(g) ? "1" : "0"}`);
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
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
    dataFingerprint: string | null;
    solveStatus?: string | null;
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
      dataFingerprint: input.dataFingerprint,
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
export function blocksWithFlows() {
  return db
    .select()
    .from(blocks)
    .where(eq(blocks.enabled, true)) // disabled blocks (#73) sit out the factory what-if
    .orderBy(blocks.sortOrder, blocks.name)
    .all()
    .map((b) => ({
      id: b.id,
      name: b.name,
      rate: primaryRate(normalizeBlockData(b.data)),
      flows: db
        .select({
          item: blockFlows.item,
          kind: blockFlows.kind,
          role: blockFlows.role,
          rate: blockFlows.rate,
        })
        .from(blockFlows)
        .where(eq(blockFlows.blockId, b.id))
        .all(),
    }));
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
  return bs.map((b) => {
    const flows = db
      .select({
        item: blockFlows.item,
        kind: blockFlows.kind,
        role: blockFlows.role,
        rate: blockFlows.rate,
      })
      .from(blockFlows)
      .where(eq(blockFlows.blockId, b.id))
      .all();
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
 * recipe (e.g. iron-plate) resolve to the item. Returns null for unknown names. */
export function classifyRef(
  name: string,
): { kind: "item" | "fluid" | "recipe"; display: string } | null {
  const it = db.select({ d: items.display }).from(items).where(eq(items.name, name)).get();
  if (it) return { kind: "item", display: it.d ?? name };
  const fl = db.select({ d: fluids.display }).from(fluids).where(eq(fluids.name, name)).get();
  if (fl) return { kind: "fluid", display: fl.d ?? name };
  const r = db.select({ d: recipes.display }).from(recipes).where(eq(recipes.name, name)).get();
  if (r) return { kind: "recipe", display: r.d ?? name };
  return null;
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
  clearExclusionCache();
}

let _exclCache: RegExp[] | null = null;
function exclusionGlobs(): RegExp[] {
  _exclCache ??= [...DEFAULT_EXCLUDE_GLOBS, ...getExclusions().globs].map(globToRegex);
  return _exclCache;
}
/** Call after setExclusions so live queries recompile. */
export function clearExclusionCache() {
  _exclCache = null;
}
/** True if any exclusion glob matches any of the given fields (name/subgroup/category). */
function isExcluded(...fields: (string | null | undefined)[]): boolean {
  const globs = exclusionGlobs();
  return fields.some((f) => f != null && globs.some((g) => g.test(f)));
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
    if (h.mode !== "future") {
      const science = db
        .select({ name: techIngredients.name })
        .from(techIngredients)
        .where(eq(techIngredients.technology, r.technology))
        .all();
      if (!techReachedByScience(r.technology, science, h)) continue;
    }
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
 * mining-productivity levels and Factorio 2.0 `change-recipe-productivity` techs.
 * Gated exactly like stackBonuses / machine availability — everything in FUTURE
 * mode, live research + the pack gate in NOW, the tier's pack gate for a target.
 * Note: repeatable techs (Py's infinite mining-productivity-12) count at most one
 * level — the mod's research sync reports researched tech NAMES, not levels. */
export function productivityBonuses(): ProductivityBonuses {
  const h = getResearchHorizon();
  const out: ProductivityBonuses = { mining: 0, recipes: new Map() };
  for (const r of db.select().from(techProductivityBonuses).all()) {
    if (h.mode !== "future") {
      const science = db
        .select({ name: techIngredients.name })
        .from(techIngredients)
        .where(eq(techIngredients.technology, r.technology))
        .all();
      if (!techReachedByScience(r.technology, science, h)) continue;
    }
    if (r.recipe === "") out.mining += r.modifier;
    else out.recipes.set(r.recipe, (out.recipes.get(r.recipe) ?? 0) + r.modifier);
  }
  return out;
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

/* ── Research / TURD availability horizon (plan for now vs future) ───────────── */

export type ResearchHorizon = {
  // now = current science; future = anything; target = up to a target good's tech tier
  mode: "now" | "future" | "target";
  packs: Set<string>; // science packs you have / produce (or, for target, up to its tier)
  researched: Set<string>; // explicitly-completed techs (mod-fed later; mock for now)
  target: string | null; // the target good (mode = target)
  targetTech: string | null; // the tech that unlocks the target (mode = target)
};

/** Every tech in a tech's prerequisite closure — the tech itself plus all ancestors. */
function techPrereqClosure(root: string): Set<string> {
  const seen = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const t = stack.pop()!;
    if (seen.has(t)) continue;
    seen.add(t);
    for (const r of db
      .select({ p: techPrerequisites.prerequisite })
      .from(techPrerequisites)
      .where(eq(techPrerequisites.technology, t))
      .all()) {
      if (!seen.has(r.p)) stack.push(r.p);
    }
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

/** The technology that first lets you make a good: among the techs unlocking a
 * recipe that produces it, the lowest-tier one (fewest distinct science packs in
 * its prerequisite closure, ties broken by name). null if it's start-craftable or
 * nothing unlocks it. */
export function unlockTechForGood(good: string): { tech: string; display: string | null } | null {
  const recipeNames = recipesProducing(good).map((r) => r.name);
  if (!recipeNames.length) return null;
  const techNames = db
    .selectDistinct({ t: techUnlocks.technology })
    .from(techUnlocks)
    .where(inArray(techUnlocks.recipe, recipeNames))
    .all()
    .map((r) => r.t);
  if (!techNames.length) return null;
  const best = techNames
    .map((t) => ({ t, tier: packsForTechs(techPrereqClosure(t)).size }))
    .sort((a, b) => a.tier - b.tier || (a.t < b.t ? -1 : 1))[0].t;
  const disp = db
    .select({ d: technologies.display })
    .from(technologies)
    .where(eq(technologies.name, best))
    .get();
  return { tech: best, display: disp?.d ?? best };
}

let _horizonCache: ResearchHorizon | null = null;
export function getResearchHorizon(): ResearchHorizon {
  if (_horizonCache) return _horizonCache;
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
    _horizonCache = { mode, packs, researched: new Set(), target, targetTech: u?.tech ?? null };
    return _horizonCache;
  }
  _horizonCache = {
    mode,
    packs: new Set(parse("available_science_packs")),
    researched: new Set(parse("researched_techs")),
    target: null,
    targetTech: null,
  };
  return _horizonCache;
}
export function setResearchHorizon(x: {
  mode?: "now" | "future" | "target";
  packs?: string[];
  researched?: string[];
  target?: string | null;
}) {
  if (x.mode) metaSet("research_mode", x.mode);
  if (x.packs) metaSet("available_science_packs", JSON.stringify(x.packs));
  if (x.researched) metaSet("researched_techs", JSON.stringify(x.researched));
  if (x.target !== undefined) metaSet("horizon_target", x.target ?? "");
  _horizonCache = null;
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

/** A tech is "reached" if explicitly researched, or all its science packs are
 * within your available set (you produce them, so you'll research it in time). */
function techReachedByScience(
  tech: string,
  science: { name: string }[],
  h: ResearchHorizon,
): boolean {
  if (h.researched.has(tech)) return true;
  return science.every((s) => h.packs.has(s.name));
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
  else if (unlocks.some((u) => techReachedByScience(u.tech, u.science, h))) research = "available";
  else {
    research = "needs-research";
    needs = [
      ...new Set(
        unlocks.flatMap((u) => u.science.map((s) => s.name)).filter((p) => !h.packs.has(p)),
      ),
    ];
  }
  const reached = research !== "needs-research";
  // availableNow: a 'pickable' (researched-but-undecided) master counts — picking
  // is still ahead. buildableNow is the stricter NOW-planning gate: only an ACTIVE
  // choice (or a non-TURD recipe) is truly buildable without an unmade commitment.
  const availableNow = reached && (!turd || turd.state !== "blocked");
  const buildableNow = reached && (!turd || turd.state === "active");
  return { research, needs, turd, availableNow, buildableNow };
}

/* ── Browser (items / fluids / recipes with full context) ───────────────────── */

/** Search items AND fluids by internal or display name. */
export function searchAll(query: string, limit = 50) {
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
    .filter((r) => !isExcluded(r.name, r.subgroup))
    .map((r) => ({ name: r.name, display: r.display, kind: r.kind }));
  const fluidRows = db
    .select({ name: fluids.name, display: fluids.display, kind: sql<string>`'fluid'` })
    .from(fluids)
    .where(nameMatch(fluids.name, fluids.display))
    .limit(limit)
    .all()
    .filter((r) => !isExcluded(r.name));
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
  for (const name of Array.from(new Set(recipeNames))) {
    const unlocks = recipeLockState(name);
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

const BARREL_CATEGORIES = new Set(["py-barreling", "py-unbarreling", "barreling", "barrelling"]);

/** Recipe-picker candidates (producing/consuming X) with lock + TURD state,
 * sorted: available first (cheapest first within a tier, per cost analysis),
 * tech-locked next, unselected-TURD after, barrel fill/empty dead last —
 * useful at times, rarely what you actually want. */
export function recipeCandidates(name: string, mode: "produce" | "consume") {
  const base = (mode === "produce" ? recipesProducing(name) : recipesConsuming(name)).filter(
    (r) => !isExcluded(r.name, r.category, r.subgroup),
  );
  const costs = recipeCosts(base.map((r) => r.name));
  const supersededMap = turdSuperseded(base.map((r) => r.name));
  const horizon = getResearchHorizon();
  const selections = getTurdSelections();
  const rows = base.map((r) => {
    const unlocks = recipeLockState(r.name);
    const turd = unlocks.find((u) => u.isTurdSub);
    const avail = computeAvail(r.enabled, unlocks, horizon, selections);
    const available = r.enabled || (turd ? turd.turdSelected : unlocks.length > 0); // tech-locked counts as obtainable
    // available-now (start-enabled or its unlock tech is researched/reached) ranks
    // above tech-locked-but-not-yet-researched
    let rank = r.enabled ? 0 : turd ? (turd.turdSelected ? 1 : 3) : avail.availableNow ? 1 : 2;
    const superseded = supersededMap.get(r.name) ?? null;
    if (superseded) rank = Math.max(rank, 6); // the selected TURD removed it in-game
    if (BARREL_CATEGORIES.has(r.category ?? "")) rank += 10;
    // io summary so lookalike recipes (Py loves reusing names) tell apart at a glance
    const full = getRecipe(r.name);
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
    return {
      ...r,
      unlocks,
      turd: turd ?? null,
      available,
      avail,
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
  return rows.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.cost ?? Infinity) - (b.cost ?? Infinity) ||
      (a.display ?? a.name).localeCompare(b.display ?? b.name),
  );
}

/** A recipe with everything the browser shows on one row: io, machines,
 * unlock state (start-enabled / tech / TURD choice + whether it's active). */
function recipeCard(name: string) {
  const r = getRecipe(name);
  if (!r) return null;
  const machines = machinesForRecipe(name).map((m) => ({
    name: m.name,
    display: m.display,
    craftingSpeed: m.craftingSpeed,
  }));
  const unlocks = recipeLockState(name);
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
      probability: c.probability,
    })),
    machines,
    unlocks,
  };
}
export type RecipeCardData = NonNullable<ReturnType<typeof recipeCard>>;

/** Everything the browser's detail pane needs for one item/fluid. */
export function browseDetail(name: string) {
  const item = getItem(name);
  const fluid = getFluid(name);
  if (!item && !fluid) return null;
  const cards = (rs: { name: string }[]) =>
    rs.map((r) => recipeCard(r.name)).filter((c): c is RecipeCardData => !!c);
  return {
    name,
    kind: fluid ? "fluid" : "item",
    display: item?.display ?? fluid?.display ?? name,
    item,
    fluid,
    producedBy: cards(recipesProducing(name)),
    consumedBy: cards(recipesConsuming(name)),
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
