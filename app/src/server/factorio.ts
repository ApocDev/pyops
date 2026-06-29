import { createServerFn } from "@tanstack/react-start";
import { cycleItems, solveBlock, type Disposition, type RecipeDef } from "../solver/block";
import { computeEffects, type BeaconConfig } from "./effects";
import { resolveLogistics, rowLogistics } from "../lib/logistics";
import {
  goalNames,
  normalizeBlockData,
  primaryGoal,
  primaryRate,
  withPrimaryRate,
} from "../lib/goals";
import type { Goal } from "../db/schema.ts";

/**
 * Server functions exposing the query layer to the client.
 * The query layer is imported dynamically inside each handler so better-sqlite3
 * never ends up in the client bundle.
 */
const lib = () => import("../db/queries.ts");

/** Pseudo-fluids modeling energy flows (1 unit = 1 MJ → rate/s = MW). Electricity
 * is grid-distributed (always an import); heat is a short-trip mechanic that must
 * be produced locally — it flows through the solver as a real good so a reactor
 * recipe in the block gets sized to the heat draw. */
const HEAT = "pyops-heat";

function pseudoDisplay(name: string) {
  if (name === "pyops-heat") return "heat";
  if (name === "pyops-electricity") return "electricity";
  return null;
}

export const statsFn = createServerFn({ method: "GET" }).handler(async () => (await lib()).stats());

export const searchItemsFn = createServerFn({ method: "GET" })
  .validator((query: string) => query)
  .handler(async ({ data }) => (await lib()).searchItems(data, 100));

/** Item + fluid search (by internal or display name) for the browser. */
export const searchAllFn = createServerFn({ method: "GET" })
  .validator((query: string) => query)
  .handler(async ({ data }) => (await lib()).searchAll(data, 80));

/** Full browser detail: item/fluid info + produced-by/consumed-by recipe cards. */
export const browseDetailFn = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(async ({ data }) => (await lib()).browseDetail(data));

export const itemDetailFn = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(async ({ data }) => {
    const q = await lib();
    return {
      name: data,
      item: q.getItem(data),
      fluid: q.getFluid(data),
      // localized name of what this spoils into (the row only has the internal id)
      spoilResultDisplay: ((sr) => (sr ? (q.getItem(sr)?.display ?? sr) : null))(
        q.getItem(data)?.spoilResult,
      ),
      cost: q.goodCosts([data]).get(data) ?? null,
      producedBy: q.recipesProducing(data),
      consumedBy: q.recipesConsuming(data),
    };
  });

/** Map of every spoilable item → its spoil time in ticks. Loaded once by the
 * icon layer to paint a stopwatch overlay on spoilable items wherever they show. */
export const spoilablesFn = createServerFn({ method: "GET" }).handler(async () =>
  (await lib()).spoilables(),
);

export const recipeDetailFn = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(async ({ data }) => {
    const q = await lib();
    return {
      recipe: q.getRecipe(data),
      machines: q.machinesForRecipe(data),
      unlocks: q.recipeUnlocks(data),
    };
  });

/** Classify a bare name (item/fluid/recipe) so prose refs render with icon+hover. */
export const classifyRefFn = createServerFn({ method: "GET" })
  .validator((data: string | { name: string; prefer?: "recipe" }) => data)
  .handler(async ({ data }) => {
    const q = await lib();
    const name = typeof data === "string" ? data : data.name;
    if (typeof data !== "string" && data.prefer === "recipe") {
      const recipe = q.getRecipe(name);
      if (recipe) return { kind: "recipe" as const, display: recipe.display ?? name };
    }
    return q.classifyRef(name);
  });

export const recipesProducingFn = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(async ({ data }) => (await lib()).recipesProducing(data));

/** Resolve item-vs-fluid kind + display name for a set of goods — used to icon
 * and auto-name goal cells before a solve exists (a fluid goal with no recipe
 * yet, or naming a block after its first goal). */
export const goodInfoFn = createServerFn({ method: "GET" })
  .validator((names: string[]) => names)
  .handler(async ({ data }) => {
    const q = await lib();
    const out: Record<string, { kind: "item" | "fluid"; display: string }> = {};
    for (const n of data) {
      const c = q.classifyRef(n);
      out[n] =
        c && c.kind !== "recipe"
          ? { kind: c.kind, display: c.display }
          : { kind: "item", display: n };
    }
    return out;
  });

/** Recipe-picker candidates with lock + TURD state, availability-sorted. */
export const recipeCandidatesFn = createServerFn({ method: "GET" })
  .validator((d: { name: string; mode: "produce" | "consume" }) => d)
  .handler(async ({ data }) => (await lib()).recipeCandidates(data.name, data.mode));

export const recipesConsumingFn = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(async ({ data }) => (await lib()).recipesConsuming(data));

/** Machine options for a recipe (for the building picker popup) — with speed,
 * power, energy source, module slots, and unlock/tier info. */
export const machineOptionsFn = createServerFn({ method: "GET" })
  .validator((recipe: string) => recipe)
  .handler(async ({ data }) => (await lib()).machineOptionsForRecipe(data));

/** Module + beacon options for one recipe row (for the modules popup): the
 * chosen machine's slots, eligible modules, and beacon variants with their
 * eligible modules. */
export const modulePickerFn = createServerFn({ method: "GET" })
  .validator((d: { recipe: string; machine: string }) => d)
  .handler(async ({ data }) => (await lib()).modulePickerData(data.recipe, data.machine));

/* Module/beacon presets (saved loadouts). */
export const listModulePresetsFn = createServerFn({ method: "GET" }).handler(async () =>
  (await lib()).listModulePresets(),
);

export const saveModulePresetFn = createServerFn({ method: "POST" })
  .validator((d: { name: string; modules: string[]; beacons: BeaconConfig[] }) => d)
  .handler(async ({ data }) => ({
    id: (await lib()).saveModulePreset(data.name.trim() || "Preset", data.modules, data.beacons),
  }));

export const deleteModulePresetFn = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .handler(async ({ data }) => {
    (await lib()).deleteModulePreset(data);
    return { ok: true };
  });

// Common, non-creative fuels to default to (cheapest-first surfaces editor items
// like ee-super-fuel). Prefer a real fuel by name; else the median by energy.
const PREFERRED_FUELS = [
  "coal",
  "coke",
  "solid-fuel",
  "charcoal",
  "wood",
  "biomass",
  "petroleum-gas",
  "natural-gas",
];
/** The fallback fuel when the player has set no favorite for the category: a real,
 * non-creative fuel by name; else the median by energy. A favorite (see
 * recipeDefaultsFn) is resolved before this. */
function defaultFuel<T extends { name: string; fuelValueJ: number | null }>(
  fuels: T[],
): T | undefined {
  for (const p of PREFERRED_FUELS) {
    const m = fuels.find((f) => f.name === p);
    if (m) return m;
  }
  return fuels[Math.floor(fuels.length / 2)]; // median energy avoids junk-low / nuclear-high
}

/** The fallback machine when the player has set no favorite for the category: the
 * simplest early-game building (lowest speed, then prefer non-heat, then lowest
 * power) — correct and buildable now beats the fastest endgame machine. */
function pickDefaultMachine<
  T extends {
    craftingSpeed: number | null;
    energySource: string | null;
    energyUsageW: number | null;
  },
>(machines: T[]): T | undefined {
  if (!machines.length) return undefined;
  return machines
    .slice()
    .sort(
      (a, b) =>
        (a.craftingSpeed ?? 0) - (b.craftingSpeed ?? 0) ||
        (a.energySource === "heat" ? 1 : 0) - (b.energySource === "heat" ? 1 : 0) ||
        (a.energyUsageW ?? 0) - (b.energyUsageW ?? 0),
    )[0];
}

/** The target good's boundary flow for the cache. A normal block exports its
 * target (role "primary"); a SINK block (negative rate) consumes it, so record it
 * as an import of |rate| — that way the factory/coherence aggregates treat the
 * block as a consumer of the good, not a negative producer. */
function targetBoundaryFlow(item: string, kind: string, rate: number) {
  return rate >= 0
    ? { item, kind, role: "primary", rate }
    : { item, kind, role: "import", rate: -rate };
}

/** The full cached boundary-flow list for a solved block: the goals (each a primary
 * output sized to its rate), the surplus byproducts, and the imports. Centralized so
 * every save path emits the same shape. The solver excludes goals from its own
 * exports, so they never double-count here. */
function boundaryFlows(
  goals: { name: string; kind: string; rate: number }[],
  r: {
    exports: { name: string; kind: string; rate: number }[];
    imports: { name: string; kind: string; rate: number }[];
  },
) {
  return [
    ...goals.map((g) => targetBoundaryFlow(g.name, g.kind, g.rate)),
    ...r.exports.map((f) => ({ item: f.name, kind: f.kind, role: "byproduct", rate: f.rate })),
    ...r.imports.map((f) => ({ item: f.name, kind: f.kind, role: "import", rate: f.rate })),
  ];
}

/** Resolve a block's goals to `{ name, kind, rate }` for the boundary cache (the
 * good's kind is needed so the flow icons correctly). */
function goalFlows(
  data: SolveInput,
  q: Awaited<ReturnType<typeof lib>>,
): { name: string; kind: string; rate: number }[] {
  return data.goals.map((g) => ({
    name: g.name,
    kind: q.getFluid(g.name) ? "fluid" : "item",
    rate: g.rate,
  }));
}

/** Machine requirement to cache for a solved block: how many of each machine the
 * block runs, keyed by the RECIPE it runs (so built-vs-required can compare per
 * recipe, not just per machine). Fractional — the theoretical count; the UI ceils
 * when comparing against what's built. */
function machineReqs(rows: { recipe: string; machine?: { name: string; count: number } | null }[]) {
  const totals = new Map<string, { machine: string; recipe: string; count: number }>();
  for (const row of rows) {
    if (!row.machine || row.machine.count <= 0) continue;
    const key = `${row.machine.name} ${row.recipe}`;
    const cur = totals.get(key);
    if (cur) cur.count += row.machine.count;
    else
      totals.set(key, { machine: row.machine.name, recipe: row.recipe, count: row.machine.count });
  }
  return [...totals.values()];
}

export type { BeaconConfig } from "./effects";

export type SolveInput = {
  // Output goals, primary first (see lib/goals.ts). A pinned goal (numeric rate)
  // becomes a solver target; an unpinned goal (null rate) is a co-product relabeled
  // from a surplus export. goals[0] anchors naming/icon and the rate-scaling tools.
  goals: Goal[];
  recipes: string[];
  dispositions?: Record<string, Disposition>;
  machines?: Record<string, string>; // recipe → chosen machine (else fastest)
  fuels?: Record<string, string>; // recipe → chosen fuel (else cheapest available)
  modules?: Record<string, string[]>; // recipe → modules in the machine's slots
  beacons?: Record<string, BeaconConfig[]>; // recipe → beacons affecting each machine
};

/** Core block computation (solve → machines/fuel/power, fuel/ash folded into the
 * boundary flows). Shared by the live solve and block saving so both use one path. */
export async function computeBlock(rawData: SolveInput) {
  const q = await lib();
  // Tolerate the legacy { target, rate, extraGoals } shape from older saved docs.
  const data = normalizeBlockData(rawData) as SolveInput;

  // Drift guard: if the block references a recipe or goal good that no longer
  // exists in the current reference data (a mod was updated/disabled/removed),
  // DO NOT solve. Silently dropping the missing recipe would re-solve the block
  // to different rates and flows with no warning. Mark it `broken` and solve an
  // EMPTY recipe set instead — a harmless underdetermined result — so callers
  // preserve the last-good cache and the UI shows exactly what's missing.
  const missing = q.blockMissingRefs(data);
  const broken = missing.recipes.length > 0 || missing.goods.length > 0;

  const fetched = broken
    ? ([] as NonNullable<ReturnType<typeof q.getRecipe>>[])
    : data.recipes
        .map((name) => q.getRecipe(name))
        .filter((r): r is NonNullable<ReturnType<typeof q.getRecipe>> => !!r);

  // Machine choice + module/beacon effects per recipe, BEFORE the solve —
  // productivity scales the recipe's products, which changes the balance.
  const moduleDb = q.getModules([
    ...Object.values(data.modules ?? {}).flat(),
    ...Object.values(data.beacons ?? {})
      .flat()
      .flatMap((b) => b.modules),
  ]);
  const beaconDb = q.getBeacons(
    Object.values(data.beacons ?? {})
      .flat()
      .map((b) => b.beacon),
  );

  // Py TURD: the selected upgrades insert hidden modules into their buildings
  // (via an internal 1:1 beacon — no slot cost). A module applies when the
  // machine's slot categories accept its category, and — for the per-tier
  // -mk0N variants — the machine's own -mk0N tier matches.
  const turdMods = q.activeTurdModules();
  const turdFor = (machine: { name: string; allowedModuleCategories: string[] | null } | null) => {
    if (!machine || !turdMods.length) return [];
    return turdMods.filter((mod) => {
      if (!machine.allowedModuleCategories?.includes(mod.category ?? "")) return false;
      const tier = /-mk0(\d)$/.exec(mod.name);
      return !tier || machine.name.endsWith(`-mk0${tier[1]}`);
    });
  };

  // YAFC-style module auto-fill (ModuleFillerParameters.AutoFillModules): when
  // a row has NO manual module config, pick the module with the best economy
  //   prod% × recipeCost/time + speed% × machineCost/payback − consumption% × energyCost/s
  // among modules whose own cost pays back within the configured window, and
  // fill every slot with it. An explicit (even empty) module list always wins.
  const settings = q.metaAll();
  const payback = Number(settings.autofill_payback ?? 0); // seconds; 0 = off
  const fillMiners = settings.autofill_miners === "1";
  // Preferred fuels per category (for marking the favorite in the fuel picker).
  // Favorites are baked into a block's stored picks at recipe-add time, so the
  // solve fallback here stays favorite-independent (lowest tier / cheapest fuel).
  const favoriteFuels = q.getFavoriteFuels();
  const favoriteFluidFuel = q.getFavoriteFluidFuel();
  const recipeCostMap =
    payback > 0 ? q.recipeCosts(fetched.map((r) => r.name)) : new Map<string, number>();
  const autoFill = (
    r: (typeof fetched)[number],
    chosen: ReturnType<typeof q.machinesForRecipe>[number],
  ): string | null => {
    if (!(fillMiners || r.kind !== "mining")) return null;
    let eligible = q.modulePickerData(r.name, chosen.name)?.modules ?? [];
    // never auto-pick creative/editor modules (nothing reachable produces them)
    const obtainable = q.obtainableGoods(eligible.map((m) => m.name));
    eligible = eligible.filter((m) => obtainable.has(m.name));
    if (!eligible.length) return null;

    const time = r.energyRequired ?? 0.5;
    const recipeCost = recipeCostMap.get(r.name) ?? 0;
    const costs = q.goodCosts([chosen.name, ...eligible.map((m) => m.name), "pyops-electricity"]);
    const productivityEconomy = recipeCost / time;
    const speedEconomy = Math.max(1e-4, costs.get(chosen.name) ?? 0) / payback;
    // energy cost per second per building: electricity at its LP price, or the
    // default fuel at its price for burners
    let effectivityEconomy = 0;
    if (chosen.energySource === "electric") {
      effectivityEconomy =
        ((chosen.energyUsageW ?? 0) / 1e6) * Math.max(0, costs.get("pyops-electricity") ?? 0);
    } else if (chosen.energySource === "burner" || chosen.energySource === "fluid") {
      const all = q.fuelsForCategories(chosen.fuelCategories, chosen.energySource === "fluid");
      const pick = all.find((f) => f.name === data.fuels?.[r.name]) ?? defaultFuel(all);
      if (pick?.fuelValueJ) {
        const perSec = (chosen.energyUsageW ?? 0) / pick.fuelValueJ;
        effectivityEconomy = perSec * Math.max(0, q.goodCosts([pick.name]).get(pick.name) ?? 0);
      }
    }

    let best: string | null = null;
    let bestEconomy = 0;
    for (const m of eligible) {
      const economy =
        m.effProductivity * productivityEconomy +
        m.effSpeed * speedEconomy -
        m.effConsumption * effectivityEconomy;
      const moduleCost = Math.max(0, costs.get(m.name) ?? 0);
      if (economy > bestEconomy && moduleCost / economy <= payback) {
        bestEconomy = economy;
        best = m.name;
      }
    }
    return best;
  };

  // Machine eligibility: in NOW mode the default pick is restricted to buildings
  // the player has actually unlocked (real research from the bridge, else the
  // science-pack proxy). FUTURE mode allows any machine. An explicit per-recipe
  // override always wins, and the picker still lists every machine (flagged).
  const machinesByRecipe = new Map(
    fetched.map((r) => [
      r.name,
      q // sorted fastest-first (for the picker)
        .machinesForRecipe(r.name)
        .slice()
        .sort((a, b) => (b.craftingSpeed ?? 0) - (a.craftingSpeed ?? 0)),
    ]),
  );
  const restrictMachines = q.getResearchHorizon().mode !== "future";
  const unlockedMachines = restrictMachines
    ? q.availableMachines([...new Set([...machinesByRecipe.values()].flat().map((m) => m.name))])
    : null;

  const setup = new Map(
    fetched.map((r) => {
      const machines = machinesByRecipe.get(r.name)!;
      // restrict the default to unlocked machines when any are unlocked; if none
      // are (the recipe itself is locked anyway), fall back to the full list.
      const pool =
        unlockedMachines && machines.some((m) => unlockedMachines.has(m.name))
          ? machines.filter((m) => unlockedMachines.has(m.name))
          : machines;
      const fallback = pickDefaultMachine(pool);
      const chosen = machines.find((m) => m.name === data.machines?.[r.name]) ?? fallback ?? null;
      const manual = data.modules?.[r.name];
      let machineModules = (manual ?? [])
        .filter((n) => moduleDb.has(n))
        .slice(0, chosen?.moduleSlots ?? 0);
      // a row is auto-MANAGED whenever it has no manual config — even when the
      // economy picks no module ("none is worth it" must still read as auto)
      const autoManaged =
        manual === undefined && payback > 0 && chosen != null && chosen.moduleSlots > 0;
      if (autoManaged) {
        const autoModule = autoFill(r, chosen!);
        if (autoModule) {
          machineModules = Array(chosen!.moduleSlots).fill(autoModule) as string[];
          for (const [name, mod] of q.getModules([autoModule])) moduleDb.set(name, mod);
        }
      }
      const beaconCfgs = (data.beacons?.[r.name] ?? []).filter(
        (b) => beaconDb.has(b.beacon) && b.count > 0,
      );
      const turdModules = turdFor(chosen);
      const effects = computeEffects(
        r.allowProductivity,
        machineModules,
        beaconCfgs,
        moduleDb,
        beaconDb,
        turdModules,
      );
      return [
        r.name,
        {
          machines,
          chosen,
          machineModules,
          beaconCfgs,
          turdModules,
          effects,
          autoModules: autoManaged,
        },
      ] as const;
    }),
  );

  // Goods produced by some recipe in this block — used to decide whether a burner's
  // fuel is self-supplied (model it in the LP so production scales to self-fuel) vs
  // imported (handled post-hoc as a fuel import).
  const producedInBlock = new Set(fetched.flatMap((r) => r.products.map((p) => p.name)));
  const selfFueled = new Set<string>(); // recipes whose fuel is modeled in the LP (skip the post-hoc fold)
  const defs: RecipeDef[] = fetched.map((r) => {
    const s = setup.get(r.name)!;
    const fx = s.effects;
    const chosen = s.chosen;
    const ingredients = r.ingredients.map((c) => ({
      kind: c.kind,
      name: c.name,
      amount: c.amount,
    }));
    const extraProducts: {
      kind: string;
      name: string;
      amount: number;
      probability?: number | null;
    }[] = [];
    // Self-fueling burners: when a machine burns a fuel this block PRODUCES (e.g. a
    // burner-mining-drill mining raw-coal while burning raw-coal), model the burn in
    // the LP — a fuel ingredient (+ its ash product) per execution. The solver then
    // scales mining up so net output meets the target AND covers its own fuel, and
    // ash falls out as a real byproduct, instead of the fuel showing as an import.
    // Imported fuels (not produced in-block) stay post-hoc. Mirrors the powerW formula.
    if (
      (chosen?.energySource === "burner" || chosen?.energySource === "fluid") &&
      chosen.energyUsageW
    ) {
      const all = q.fuelsForCategories(chosen.fuelCategories, chosen.energySource === "fluid");
      const pick = all.find((f) => f.name === data.fuels?.[r.name]) ?? defaultFuel(all);
      if (pick?.fuelValueJ && producedInBlock.has(pick.name)) {
        const speed = (chosen.craftingSpeed ?? 1) * fx.speedMult;
        const energyRequired = r.energyRequired ?? 0.5;
        const fuelPerExec =
          (chosen.energyUsageW * fx.consMult * energyRequired) / (speed * pick.fuelValueJ);
        if (fuelPerExec > 0) {
          ingredients.push({ kind: pick.kind, name: pick.name, amount: fuelPerExec });
          if (pick.burntResult)
            extraProducts.push({ kind: "item", name: pick.burntResult, amount: fuelPerExec });
          selfFueled.add(r.name);
        }
      }
    }
    // Heat-powered machines (Py hard mode) draw heat that must be produced LOCALLY
    // by a reactor recipe in the same block (heat can't cross blocks). Model the
    // draw as a real pyops-heat ingredient so the solver SIZES the reactor (a
    // generate-heat-* recipe, which produces pyops-heat) to exactly meet it. With
    // no reactor present, pyops-heat falls out as an import — the signal that a
    // local heat source is still missing. Mirrors the post-hoc powerW formula
    // (energyUsageW × count × consMult) reduced to per-execution (count = x·energyRequired/speed).
    if (chosen?.energySource === "heat" && chosen.energyUsageW) {
      const speed = (chosen.craftingSpeed ?? 1) * fx.speedMult;
      const energyRequired = r.energyRequired ?? 0.5;
      const heatPerExec = (chosen.energyUsageW * fx.consMult * energyRequired) / (speed * 1e6);
      if (heatPerExec > 0) ingredients.push({ kind: "fluid", name: HEAT, amount: heatPerExec });
    }
    return {
      name: r.name,
      energyRequired: r.energyRequired ?? 0.5,
      ingredients,
      products: [
        ...r.products.map((c) => ({
          kind: c.kind,
          name: c.name,
          probability: c.probability,
          amount:
            (c.amount ??
              (c.amountMin != null && c.amountMax != null ? (c.amountMin + c.amountMax) / 2 : 0)) *
            (c.ignoredByProductivity ? 1 : fx.prodMult),
        })),
        // ash/burnt result from self-fuel (not productivity-scaled — it's from burning)
        ...extraProducts,
      ],
    };
  });
  const result = solveBlock({
    targets: data.goals,
    recipes: defs,
    dispositions: data.dispositions,
  });

  // Per-recipe rows for the grid: each recipe's ingredients/products at the
  // solved run-rate, the chosen machine (override or fastest) with a real count
  // (machine-seconds/sec ÷ speed), its power draw, and — for burners — the
  // chosen fuel and its consumption. Machine/fuel choice is display-only; it
  // never changes the solved rates, only how many buildings / how much fuel.
  const byName = new Map(fetched.map((r) => [r.name, r]));
  const defByName = new Map(defs.map((d) => [d.name, d])); // products already productivity-scaled
  let totalPowerW = 0;
  let totalHeatW = 0; // Py hard-mode "heat" machines — must be produced locally
  const fuelTotals = new Map<string, { display: string | null; kind: string; perSec: number }>();
  const burntTotals = new Map<string, { display: string | null; perSec: number }>(); // burnt result (ash, …)
  const rows = result.recipes.map((rr) => {
    const def = byName.get(rr.recipe)!;
    const scaled = defByName.get(rr.recipe)!;
    const {
      machines,
      chosen,
      machineModules,
      beaconCfgs,
      turdModules,
      effects: fx,
      autoModules,
    } = setup.get(rr.recipe)!;
    const speed = (chosen?.craftingSpeed ?? 1) * fx.speedMult;
    const count = rr.machines1x / speed;
    const powerW = (chosen?.energyUsageW ?? 0) * count * fx.consMult;
    const beaconPowerW = fx.beaconPowerPerMachineW * count;
    if (count > 0) totalPowerW += beaconPowerW; // beacons are always electric

    let fuel: {
      name: string;
      display: string | null;
      kind: string;
      perSec: number;
      chosen: string;
      burnt: { name: string; display: string | null; perSec: number } | null;
    } | null = null;
    let availableFuels: {
      name: string;
      display: string | null;
      kind: string;
      fuelValueJ: number | null;
      favorite: boolean;
    }[] = [];
    const burns = chosen && (chosen.energySource === "burner" || chosen.energySource === "fluid");
    if (burns && chosen.energyUsageW) {
      const all = q.fuelsForCategories(chosen.fuelCategories, chosen.energySource === "fluid");
      // a fuel is the favorite when it's the stored pick for any of the machine's
      // fuel categories (solid fuels carry exactly one category) — or, for fluids
      // (no category), the single global preferred fluid fuel
      const favSet = new Set(
        chosen.fuelCategories.map((c) => favoriteFuels[c]).filter((n): n is string => !!n),
      );
      availableFuels = all.map((f) => ({
        name: f.name,
        display: f.display,
        kind: f.kind,
        fuelValueJ: f.fuelValueJ,
        favorite: f.kind === "fluid" ? f.name === favoriteFluidFuel : favSet.has(f.name),
      }));
      const pick = all.find((f) => f.name === data.fuels?.[rr.recipe]) ?? defaultFuel(all);
      if (pick?.fuelValueJ) {
        const perSec = powerW / pick.fuelValueJ; // J/s ÷ J/unit = units/s (effectivity≈1)
        // burning yields a burnt result 1:1 (coal → ash, fuel-cell → depleted-cell)
        const burnt = pick.burntResult
          ? {
              name: pick.burntResult,
              display: q.getItem(pick.burntResult)?.display ?? null,
              perSec,
            }
          : null;
        fuel = {
          name: pick.name,
          display: pick.display,
          kind: pick.kind,
          perSec,
          chosen: pick.name,
          burnt,
        };
        if (count > 0 && !selfFueled.has(rr.recipe)) {
          // self-fueled recipes are netted in the LP (fuel + ash modeled there) —
          // folding here too would double-count. Otherwise fold the fuel/ash.
          // (also skip backward/infeasible recipes via count > 0)
          const t = fuelTotals.get(pick.name) ?? {
            display: pick.display,
            kind: pick.kind,
            perSec: 0,
          };
          t.perSec += perSec;
          fuelTotals.set(pick.name, t);
          if (burnt) {
            const b = burntTotals.get(burnt.name) ?? { display: burnt.display, perSec: 0 };
            b.perSec += perSec;
            burntTotals.set(burnt.name, b);
          }
        }
      }
    } else if (chosen?.energySource === "electric" && count > 0) {
      totalPowerW += powerW;
    } else if (chosen?.energySource === "heat" && count > 0) {
      // heat-powered building (Py hard mode): needs heat delivered locally — it
      // doesn't draw the electric grid and doesn't burn its own fuel.
      totalHeatW += powerW;
    }

    return {
      recipe: rr.recipe,
      display: def.display ?? rr.recipe,
      rate: rr.rate,
      machine: chosen && {
        name: chosen.name,
        display: chosen.display,
        energySource: chosen.energySource,
        count,
        powerW,
        craftingSpeed: chosen.craftingSpeed,
        moduleSlots: chosen.moduleSlots,
      },
      machines: machines.map((m) => ({
        name: m.name,
        display: m.display,
        craftingSpeed: m.craftingSpeed,
        energyUsageW: m.energyUsageW,
        energySource: m.energySource,
      })),
      fuel,
      availableFuels,
      modules: machineModules,
      autoModules,
      turdModules: turdModules.map((m) => ({ name: m.name, display: m.display })),
      beacons: beaconCfgs,
      beaconPowerW,
      effects: { speed: fx.speedBonus, productivity: fx.prodBonus, consumption: fx.consBonus },
      ingredients: def.ingredients.map((c) => ({
        name: c.name,
        kind: c.kind,
        display: c.display,
        rate: c.amount * rr.rate,
      })),
      // product rates from the productivity-scaled defs (the real output)
      products: def.products.map((c, i) => ({
        name: c.name,
        kind: c.kind,
        display: c.display,
        rate: (scaled.products[i]?.amount ?? 0) * (c.probability ?? 1) * rr.rate,
      })),
    };
  });
  const power = {
    totalW: totalPowerW,
    heatW: totalHeatW, // requires a local heat source (heat doesn't travel far)
    fuel: [...fuelTotals.entries()]
      .map(([name, t]) => ({ name, ...t }))
      .sort((a, b) => b.perSec - a.perSec),
  };

  // Fold fuel into the balance: burning is extra consumption of the chosen fuel.
  // It offsets that item's byproduct export first, then any shortfall becomes an
  // import. A byproduct that fully covers its burners → self-fueled (no import).
  const EPS = 1e-6;
  const flowNet = new Map<string, { kind: string; net: number }>(); // net>0 export, <0 import
  for (const f of result.imports) flowNet.set(f.name, { kind: f.kind, net: -f.rate });
  for (const f of result.exports) flowNet.set(f.name, { kind: f.kind, net: f.rate });
  for (const [name, t] of fuelTotals) {
    const cur = flowNet.get(name) ?? { kind: t.kind, net: 0 };
    cur.net -= t.perSec;
    flowNet.set(name, cur);
  }
  for (const [name, t] of burntTotals) {
    // burning emits a burnt result (ash, …)
    const cur = flowNet.get(name) ?? { kind: "item", net: 0 };
    cur.net += t.perSec;
    flowNet.set(name, cur);
  }
  // Fold electric draw into the balance as electricity consumption (1 unit =
  // 1 MJ → rate/s = MW). Generating recipes in-block produce it through the
  // solver; any shortfall shows as an "Electricity" import you can click to
  // add a generator recipe. Same netting rule as fuel: no auto-spawning.
  const ELECTRICITY = "pyops-electricity";
  if (totalPowerW > EPS) {
    const cur = flowNet.get(ELECTRICITY) ?? { kind: "fluid", net: 0 };
    cur.net -= totalPowerW / 1e6;
    flowNet.set(ELECTRICITY, cur);
  }
  // Heat (Py hard mode) is NOT folded here — unlike electricity, it flows through
  // the solver as a real good (heat-powered machines consume pyops-heat; reactor
  // recipes produce it). So a heat shortfall already shows up in result.imports as
  // a pyops-heat import, and a reactor in the block balances it internally.
  // totalHeatW is retained only for the power.heatW display figure.
  const byNameAsc = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : 1);
  const imports = [...flowNet]
    .filter(([, v]) => v.net < -EPS)
    .map(([name, v]) => ({ name, kind: v.kind, rate: -v.net }))
    .sort(byNameAsc);
  const allExports = [...flowNet]
    .filter(([, v]) => v.net > EPS)
    .map(([name, v]) => ({ name, kind: v.kind, rate: v.net }))
    .sort(byNameAsc);
  // Goals are solver targets (excluded from the solver's exports), so every surplus
  // here is a genuine byproduct. A good you don't target is never a "primary output".
  const exports = allExports;
  const fuelItems = [...fuelTotals.keys()]; // for the 🔥 tag in the UI
  const burntItems = [...burntTotals.keys()]; // ash / depleted cells from burning

  // Which imports are craftable in-block (a recipe exists to make them) vs. true
  // raws (nothing produces them — you must supply them). Drives the import tint.
  const producible = imports
    .filter((f) => q.recipesProducing(f.name).length > 0)
    .map((f) => f.name);

  // Fluid temperature sanity: the solver links fluids by name, so flag any
  // consumer whose required temperature range no fluid produced in-block
  // satisfies (e.g. a turbine needing ≥500° fed by 250° steam).
  const producedTempsInBlock = new Map<string, number[]>();
  for (const r of fetched)
    for (const p of r.products)
      if (p.kind === "fluid" && p.temperature != null)
        producedTempsInBlock.set(p.name, [
          ...(producedTempsInBlock.get(p.name) ?? []),
          p.temperature,
        ]);
  const tempWarnings: { recipe: string; item: string; needs: string; got: number[] }[] = [];
  for (const r of fetched) {
    for (const c of r.ingredients) {
      if (c.kind !== "fluid" || (c.minTemp == null && c.maxTemp == null)) continue;
      const got = producedTempsInBlock.get(c.name);
      if (!got?.length) continue; // imported — temperature is the player's problem
      const lo = c.minTemp ?? -Infinity;
      const hi = c.maxTemp ?? Infinity;
      if (!got.some((t) => t >= lo && t <= hi)) {
        tempWarnings.push({
          recipe: r.name,
          item: c.name,
          needs:
            c.minTemp != null && c.maxTemp != null
              ? `${c.minTemp}–${c.maxTemp}°`
              : c.minTemp != null
                ? `≥${c.minTemp}°`
                : `≤${c.maxTemp}°`,
          got: Array.from(new Set(got)),
        });
      }
    }
  }

  // On a backward/infeasible solve, surface the loop items the reverse recipes
  // consume — these are the ones starved of a feed. The UI lets the player click
  // one to add a recipe that supplies it.
  let stuckItems: string[] = [];
  if (result.status === "infeasible" && result.negativeRecipes?.length) {
    const cyc = cycleItems(defs);
    const negSet = new Set(result.negativeRecipes);
    const stuck = new Set<string>();
    for (const r of fetched) {
      if (!negSet.has(r.name)) continue;
      for (const c of r.ingredients) if (cyc.has(c.name)) stuck.add(c.name);
    }
    stuckItems = [...stuck];
  }

  // display-name map for the names that appear in the result (target, recipes, flows)
  const display: Record<string, string> = {};
  for (const r of fetched) if (r.display) display[r.name] = r.display;
  const itemDisp = (name: string) => q.getItem(name)?.display ?? q.getFluid(name)?.display ?? null;
  for (const name of [
    ...goalNames(data),
    ...imports.map((f) => f.name),
    ...exports.map((f) => f.name),
    ...stuckItems,
  ]) {
    const d = itemDisp(name);
    if (d) display[name] = d;
  }
  // One-time build cost: the materials needed to CONSTRUCT this block's buildings
  // (#38). Aggregate machines across rows by type, then expand each building's own
  // recipe — this surfaces e.g. steel for a science block even though no science
  // recipe consumes it. Beacons are excluded (their physical count is ambiguous).
  const buildingCounts = new Map<string, number>();
  for (const r of rows)
    if (r.machine?.count)
      buildingCounts.set(
        r.machine.name,
        (buildingCounts.get(r.machine.name) ?? 0) + r.machine.count,
      );
  const buildCost = q.buildCost([...buildingCounts].map(([name, count]) => ({ name, count })));

  return {
    ...result,
    imports,
    exports,
    rows,
    display,
    producible,
    stuckItems,
    power,
    fuelItems,
    burntItems,
    tempWarnings,
    buildCost,
    broken,
    missing,
  };
}

/** Persist a block's input doc + refresh its cached flows/machines/power. When the
 * solve is `broken` (a referenced recipe/good vanished) the last-good cache is KEPT
 * (null = leave untouched) so the factory aggregates stay correct and re-enabling
 * the mod restores the block; the input + per-block reference fingerprint are still
 * written. Shared by every save path so they all degrade the same way. */
async function persistBlock(
  q: Awaited<ReturnType<typeof lib>>,
  meta: { id?: number | null; name: string; iconKind: string | null; iconName: string | null },
  rawData: SolveInput,
  r: Awaited<ReturnType<typeof computeBlock>>,
): Promise<number> {
  const data = normalizeBlockData(rawData) as SolveInput; // persist the new goals shape
  return q.saveBlockRow(
    {
      ...meta,
      data,
      electricityW: r.broken ? null : r.power.totalW,
      dataFingerprint: q.blockReferenceFingerprint(data),
    },
    r.broken ? null : [...boundaryFlows(goalFlows(data, q), r)],
    r.broken ? null : machineReqs(r.rows),
  );
}

/** Solve a block live (for the editor). */
export const solveBlockFn = createServerFn({ method: "GET" })
  .validator((d: SolveInput) => d)
  .handler(async ({ data }) => computeBlock(data));

/** Push a block's solved summary to the game so the mod can render an in-game
 * build sheet (Helmod-style): the buildings + counts (each clickable for a
 * configured blueprint), plus inputs/outputs and power. Fire-and-forget; returns
 * whether a peer was reachable. */
/** Solve a saved block and push it to the in-game Helmod-style summary panel,
 * including the per-good belts/inserters + top-level logistics descriptor. Shared
 * by the web "show in game" button (`bridgeShowBlockFn`) and the `gameShowBlock`
 * MCP dev tool, so both exercise the exact same payload path. */
export async function showBlockInGame(id: number) {
  const q = await lib();
  const row = q.getBlock(id);
  if (!row) return { sent: false as const, name: null };
  const input = normalizeBlockData(row.data as SolveInput) as SolveInput;
  const r = await computeBlock(input);

  // Energy pseudo-goods are shown as the power/heat lines, not as I/O rows
  // (they aren't real prototypes, so an in-game icon tag wouldn't resolve).
  const PSEUDO = new Set([HEAT, "pyops-electricity"]);
  // Logistics for the in-game summary's Helmod-style belt/inserter readout: belts
  // to carry each item, and inserters/loaders to feed one building (recipe rows
  // only). Sized against the same picks as the web Logistics control.
  const ctx = q.logisticsContext();
  const logi = resolveLogistics(ctx);
  const moverName = logi.moverKind === "loader" ? logi.loader?.name : logi.inserter?.name;
  const logistics = logi.belt
    ? { belt: logi.belt.name, mover: moverName ?? null, moverKind: logi.moverKind }
    : null;
  // Honour the same independent show toggles as the web Logistics control, so a
  // belts-only (or inserters-only) setup carries through to the in-game readout
  // instead of always emitting both.
  const good = (
    c: { name: string; kind: string; rate: number },
    machineCount: number,
    note?: "fuel" | "burnt",
  ) => {
    const base: {
      name: string;
      kind: string;
      rate: number;
      belts?: number;
      inserters?: number;
      note?: "fuel" | "burnt";
    } = { name: c.name, kind: c.kind, rate: c.rate };
    if (note) base.note = note;
    if (c.kind !== "item" || !logi.belt) return base;
    const rl = rowLogistics(logi, c.rate, machineCount);
    if (!rl) return base;
    // belts size the whole flow; inserters are per-building (recipe rows only)
    if (ctx.prefs.showBelts) base.belts = rl.belts;
    if (ctx.prefs.showInserters && machineCount > 0) base.inserters = rl.devices;
    return base;
  };
  const goods = (arr: { name: string; kind: string; rate: number }[], machineCount: number) =>
    arr.filter((c) => !PSEUDO.has(c.name)).map((c) => good(c, machineCount));

  // Per-recipe rows for the Helmod-style matrix: each recipe's products, its
  // factory + count (the blueprint button), and its ingredients.
  const recipes = r.rows
    .filter((row) => row.machine && row.machine.count > 0)
    .map((row) => {
      const count = row.machine!.count;
      const ingredients = goods(row.ingredients, count);
      const products = goods(row.products, count);
      // Burner machines draw fuel and emit a 1:1 burnt result (coal → ash, cell →
      // depleted cell). Those are real item flows in/out of the building, so — like
      // Helmod — fold the fuel into ingredients and the burnt result into products
      // (tagged so the cell can note it). They then get belt/inserter sizing too.
      if (row.fuel) {
        ingredients.push(
          good({ name: row.fuel.name, kind: row.fuel.kind, rate: row.fuel.perSec }, count, "fuel"),
        );
        if (row.fuel.burnt) {
          products.push(
            good(
              { name: row.fuel.burnt.name, kind: "item", rate: row.fuel.burnt.perSec },
              count,
              "burnt",
            ),
          );
        }
      }
      return {
        machine: row.machine!.name,
        machineDisplay: row.machine!.display,
        recipe: row.recipe,
        recipeDisplay: row.display,
        count: Math.ceil(count - 1e-6),
        modules: row.modules ?? [],
        products,
        ingredients,
        beacons: (row.beacons ?? []).map((b) => ({
          beacon: b.beacon,
          count: b.count,
          modules: b.modules,
        })),
      };
    });
  const boundary = (f: { name: string; kind: string; rate: number }) => ({
    ...good(f, 0), // belts only — boundary flows aren't tied to one building
    display: r.display[f.name],
  });
  const outputs = [...goalFlows(input, q).filter((g) => g.rate > 0), ...r.exports]
    .filter((f) => !PSEUDO.has(f.name))
    .map(boundary);
  const inputs = r.imports.filter((f) => !PSEUDO.has(f.name)).map(boundary);

  const b = await import("./bridge/server.ts");
  b.ensureBridge();
  return {
    sent: b.sendToPeer({
      type: "cmd.show_block",
      payload: {
        name: row.name,
        powerW: r.power.totalW,
        heatW: r.power.heatW,
        logistics,
        recipes,
        inputs,
        outputs,
      },
    }),
    name: row.name,
  };
}

/** Close the in-game summary panel. Pairs with `showBlockInGame` for the dev
 * loop (open → screenshot → close) and the `gameCloseSummary` MCP tool. */
export async function hideBlockInGame() {
  const b = await import("./bridge/server.ts");
  b.ensureBridge();
  return { sent: b.sendToPeer({ type: "cmd.hide_block", payload: {} }) };
}

export const bridgeShowBlockFn = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .handler(async ({ data }) => showBlockInGame(data));

/** Save a block: solve once, persist the input + its cached I/O flows + power.
 * Name/icon default to the target product. Returns the (new or existing) id. */
export const saveBlockFn = createServerFn({ method: "POST" })
  .validator(
    (d: {
      id?: number | null;
      name?: string;
      iconKind?: string;
      iconName?: string;
      data: SolveInput;
    }) => d,
  )
  .handler(async ({ data }) => {
    const q = await lib();
    const r = await computeBlock(data.data);
    const primary = primaryGoal(normalizeBlockData(data.data))?.name ?? "";
    const targetKind = q.getFluid(primary) ? "fluid" : "item";
    const name = data.name?.trim() || r.display[primary] || primary || "New block";
    const id = await persistBlock(
      q,
      {
        id: data.id,
        name,
        iconKind: data.iconKind ?? targetKind,
        iconName: data.iconName ?? primary,
      },
      data.data,
      r,
    );
    return { id, name };
  });

export const listBlocksFn = createServerFn({ method: "GET" }).handler(async () =>
  (await lib()).listBlocks(),
);

export const loadBlockFn = createServerFn({ method: "GET" })
  .validator((id: number) => id)
  .handler(async ({ data }) => (await lib()).getBlock(data));

export const deleteBlockFn = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .handler(async ({ data }) => {
    (await lib()).deleteBlock(data);
    return { ok: true };
  });

/** Delete a block only if it's still untouched — no goal, no co-products, no
 * recipes (so no imports/exports either). Used to clean up throwaway "New block"
 * tabs that are closed without ever being used. Returns whether it deleted. */
export const deleteBlockIfEmptyFn = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .handler(async ({ data }) => {
    const q = await lib();
    const row = q.getBlock(data);
    if (!row) return { deleted: false };
    const d = normalizeBlockData(row.data as SolveInput);
    const empty = goalNames(d).length === 0 && (d.recipes?.length ?? 0) === 0;
    if (empty) q.deleteBlock(data);
    return { deleted: empty };
  });

export const factoryTotalsFn = createServerFn({ method: "GET" }).handler(async () =>
  (await lib()).factoryTotals(),
);

/** Factory what-if: solve the whole factory for the per-block scale changes
 * that satisfy all demands/consumptions. `demands` overrides a final product's rate
 * (e.g. science → 2/s) to see the cascade; unspecified demands stay at current. */
export const factoryWhatIfFn = createServerFn({ method: "POST" })
  .validator((d: { demands?: Record<string, number> }) => d)
  .handler(async ({ data }) => {
    const q = await lib();
    const { factoryWhatIf } = await import("./factory-solve.ts");
    const result = await factoryWhatIf(q.blocksWithFlows(), data.demands ?? {});
    const display = (name: string) => pseudoDisplay(name) ?? q.classifyRef(name)?.display ?? name;
    return {
      ...result,
      demands: result.demands.map((g) => ({ ...g, display: display(g.good) })),
      raws: result.raws.map((g) => ({ ...g, display: display(g.good) })),
      overproduced: result.overproduced.map((g) => ({ ...g, display: display(g.good) })),
    };
  });

/** Per-machine required (across blocks) vs. built (live from the game), plus the
 * sync status — drives the "under-built" view. */
export const machineSufficiencyFn = createServerFn({ method: "GET" }).handler(async () => {
  const q = await lib();
  const m = q.metaAll();
  return {
    machines: q.machineSufficiency(),
    syncedAt: m.built_synced_at ?? null,
    syncedCount: m.built_synced_count ? Number(m.built_synced_count) : null,
  };
});

/** Planned (from block flows) vs. actual (live from the game) production per item,
 * plus the stats sync status — drives the factory ledger's "actual/s" column. */
export const productionComparisonFn = createServerFn({ method: "GET" }).handler(async () => {
  const q = await lib();
  const m = q.metaAll();
  return {
    items: q.factoryProductionComparison(),
    syncedAt: m.stats_synced_at ?? null,
    syncedCount: m.stats_synced_count ? Number(m.stats_synced_count) : null,
  };
});

/** Re-solve every block and refresh its cached I/O flows + power, keeping its
 * identity (id/name/icon/data). Use after a solver change makes caches stale. */
export const recomputeAllBlocksFn = createServerFn({ method: "POST" }).handler(async () => {
  const q = await lib();
  let ok = 0;
  let broken = 0;
  const failed: { id: number; name: string; error: string }[] = [];
  for (const b of q.listBlocks()) {
    const row = q.getBlock(b.id);
    if (!row) continue;
    try {
      const data = row.data as SolveInput;
      const r = await computeBlock(data);
      // broken blocks keep their last-good cache (persistBlock passes null flows);
      // count them separately so the caller can report what still needs attention
      if (r.broken) broken++;
      await persistBlock(
        q,
        { id: row.id, name: row.name, iconKind: row.iconKind, iconName: row.iconName },
        data,
        r,
      );
      ok++;
    } catch (e) {
      failed.push({ id: b.id, name: b.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok, broken, failed };
});

/** Drill-down: blocks producing/consuming one good (for the factory resource view). */
export const blocksForGoodFn = createServerFn({ method: "GET" })
  .validator((good: string) => good)
  .handler(async ({ data }) => (await lib()).blocksForGood(data));

/** Block-to-block wiring (links / unsourced / surplus) for the coherence view. */
export const factoryCoherenceFn = createServerFn({ method: "GET" }).handler(async () =>
  (await lib()).factoryCoherence(),
);

/** Scale-to-demand preview: re-solve one block at a new target rate and diff it
 * against its current solve — the concrete changes to hit the target (building
 * counts per recipe, imports, byproducts, power). Does NOT save. */
export const scalePlanFn = createServerFn({ method: "GET" })
  .validator((d: { blockId: number; newRate: number }) => d)
  .handler(async ({ data }) => {
    const q = await lib();
    const row = q.getBlock(data.blockId);
    if (!row) return null;
    const input = normalizeBlockData(row.data as SolveInput) as SolveInput;
    const cur = await computeBlock(input);
    const next = await computeBlock(withPrimaryRate(input, data.newRate));
    const curRow = new Map(cur.rows.map((r) => [r.recipe, r]));
    const rows = next.rows.map((nr) => {
      const cr = curRow.get(nr.recipe);
      return {
        recipe: nr.recipe,
        display: nr.display,
        machine: nr.machine?.name ?? null,
        machineDisplay: nr.machine?.display ?? null,
        energySource: nr.machine?.energySource ?? null,
        countCur: cr?.machine?.count ?? 0,
        countNew: nr.machine?.count ?? 0,
        modules: nr.modules ?? [],
        beaconCount: (nr.beacons ?? []).reduce((s, b) => s + b.count, 0),
        fuel: nr.fuel?.name ?? null,
      };
    });
    type Flow = { name: string; kind: string; rate: number };
    const display = (name: string) => pseudoDisplay(name) ?? q.classifyRef(name)?.display ?? name;
    const diffFlows = (cf: Flow[], nf: Flow[]) => {
      const m = new Map<
        string,
        { good: string; display: string; kind: string; cur: number; next: number }
      >();
      for (const f of cf)
        m.set(f.name, {
          good: f.name,
          display: display(f.name),
          kind: f.kind,
          cur: f.rate,
          next: 0,
        });
      for (const f of nf) {
        const e = m.get(f.name) ?? {
          good: f.name,
          display: display(f.name),
          kind: f.kind,
          cur: 0,
          next: 0,
        };
        e.next = f.rate;
        m.set(f.name, e);
      }
      return [...m.values()].map((e) => ({
        ...e,
        cur: +e.cur.toFixed(3),
        next: +e.next.toFixed(3),
      }));
    };
    return {
      block: {
        id: row.id,
        name: row.name,
        good: primaryGoal(input)?.name ?? "",
        currentRate: primaryRate(input),
      },
      newRate: data.newRate,
      status: next.status,
      message: next.message ?? null,
      rows,
      imports: diffFlows(cur.imports, next.imports),
      byproducts: diffFlows(cur.exports, next.exports),
      power: {
        curW: cur.power.totalW,
        nextW: next.power.totalW,
        curHeatW: cur.power.heatW,
        nextHeatW: next.power.heatW,
      },
    };
  });

/** Apply a scale-up: set one block's target rate, re-solve, and persist (same
 * cache refresh as saveBlock — identity preserved, only the rate changes). */
export const setBlockRateFn = createServerFn({ method: "POST" })
  .validator((d: { blockId: number; rate: number }) => d)
  .handler(async ({ data }) => {
    const q = await lib();
    const row = q.getBlock(data.blockId);
    if (!row) return { ok: false };
    const input = withPrimaryRate(
      normalizeBlockData(row.data as SolveInput),
      data.rate,
    ) as SolveInput;
    const r = await computeBlock(input);
    if (r.broken) return { ok: false, broken: true };
    await persistBlock(
      q,
      { id: row.id, name: row.name, iconKind: row.iconKind, iconName: row.iconName },
      input,
      r,
    );
    return { ok: true };
  });

/* ── Projects (one sqlite db per mod list) ──────────────────────────────────── */
const projectsLib = () => import("./projects.ts");

export const listProjectsFn = createServerFn({ method: "GET" }).handler(async () =>
  (await projectsLib()).listProjects(),
);

export const createProjectFn = createServerFn({ method: "POST" })
  .validator((name: string) => name)
  .handler(async ({ data }) => (await projectsLib()).createProject(data.trim() || "Project"));

export const setActiveProjectFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data }) => (await projectsLib()).setActiveProject(data));

export const removeProjectFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    await (await projectsLib()).removeProject(data);
    return { ok: true };
  });

/* ── Planner settings (module auto-fill) ────────────────────────────────────── */

export const plannerSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  const q = await lib();
  const m = q.metaAll();
  return {
    autofillPayback: Number(m.autofill_payback ?? 0),
    fillMiners: m.autofill_miners === "1",
    spoilImportCutoffSec: Number(m.spoil_import_cutoff_sec ?? 300),
    costsComputed: q.costAnalysisCount() > 0,
  };
});

export const setPlannerSettingsFn = createServerFn({ method: "POST" })
  .validator(
    (d: { autofillPayback: number; fillMiners: boolean; spoilImportCutoffSec?: number }) => d,
  )
  .handler(async ({ data }) => {
    const q = await lib();
    q.metaSet("autofill_payback", String(Math.max(0, data.autofillPayback)));
    q.metaSet("autofill_miners", data.fillMiners ? "1" : "0");
    if (data.spoilImportCutoffSec != null)
      q.metaSet("spoil_import_cutoff_sec", String(Math.max(0, data.spoilImportCutoffSec)));
    return { ok: true };
  });

/** Resolve the favorite (or fallback) building + fuel for each recipe, applied when
 * a recipe is first added to a block so the pick gets baked into the block's stored
 * config (issue #18). Availability-gated: a favorite that isn't unlocked yet (or an
 * unpicked TURD option) falls through to the lowest-tier / cheapest fallback until
 * it becomes buildable. Favorites are NEVER consulted at solve time, so existing
 * blocks keep their picks when a favorite changes. */
export const recipeDefaultsFn = createServerFn({ method: "POST" })
  .validator((recipes: string[]) => recipes)
  .handler(async ({ data }) => {
    const q = await lib();
    const favMachines = q.getFavoriteMachines();
    const favFuels = q.getFavoriteFuels();
    const favFluidFuel = q.getFavoriteFluidFuel();
    const restrict = q.getResearchHorizon().mode !== "future";
    const out: Record<string, { machine?: string; fuel?: string }> = {};
    for (const name of data) {
      const r = q.getRecipe(name);
      if (!r) continue;
      const machines = q
        .machinesForRecipe(name)
        .slice()
        .sort((a, b) => (b.craftingSpeed ?? 0) - (a.craftingSpeed ?? 0));
      if (!machines.length) continue;
      const unlocked = restrict ? q.availableMachines(machines.map((m) => m.name)) : null;
      const pool =
        unlocked && machines.some((m) => unlocked.has(m.name))
          ? machines.filter((m) => unlocked.has(m.name))
          : machines;
      const favMachine = r.category ? favMachines[r.category] : undefined;
      const chosen =
        (favMachine && pool.find((m) => m.name === favMachine)) || pickDefaultMachine(pool);
      if (!chosen) continue;
      const pick: { machine?: string; fuel?: string } = { machine: chosen.name };
      if (chosen.energySource === "burner" || chosen.energySource === "fluid") {
        const isFluid = chosen.energySource === "fluid";
        const fuels = q.fuelsForCategories(chosen.fuelCategories, isFluid);
        let favFuel: string | undefined;
        if (isFluid) {
          // fluids have no category — a single global preferred fluid fuel
          const ff = favFluidFuel;
          if (ff && fuels.some((x) => x.name === ff)) favFuel = ff;
        } else {
          for (const cat of chosen.fuelCategories) {
            const f = favFuels[cat];
            if (f && fuels.some((x) => x.name === f)) {
              favFuel = f;
              break;
            }
          }
        }
        const fuel = favFuel ?? defaultFuel(fuels)?.name;
        if (fuel) pick.fuel = fuel;
      }
      out[name] = pick;
    }
    return out;
  });

/** Set/clear the preferred building for a recipe's category (the "favorite" star in
 * the building picker). `machine: null` clears it. */
export const setFavoriteMachineFn = createServerFn({ method: "POST" })
  .validator((d: { recipe: string; machine: string | null }) => d)
  .handler(async ({ data }) => {
    const q = await lib();
    const category = q.getRecipe(data.recipe)?.category;
    if (!category) return { ok: false };
    q.setFavoriteMachine(category, data.machine);
    return { ok: true };
  });

/** Set/clear the preferred fuel (the "favorite" star in the fuel picker). A solid
 * fuel sets the favorite for its fuel category; a fluid sets the single global
 * preferred fluid fuel (fluids have no category). `clear: true` removes it. */
export const setFavoriteFuelFn = createServerFn({ method: "POST" })
  .validator((d: { fuel: string; clear?: boolean }) => d)
  .handler(async ({ data }) => {
    const q = await lib();
    const category = q.getItem(data.fuel)?.fuelCategory;
    if (category) {
      q.setFavoriteFuel(category, data.clear ? null : data.fuel);
      return { ok: true };
    }
    if (q.getFluid(data.fuel)) {
      q.setFavoriteFluidFuel(data.clear ? null : data.fuel);
      return { ok: true };
    }
    return { ok: false };
  });

/** Logistics throughput context for the block view (#21): the user's belt/mover
 * picks + stacking prefs, the current research-derived stack bonuses, and the
 * prototype options. The per-row belt/inserter math runs client-side from this so
 * changing a tier is instant (no re-solve). */
export const logisticsContextFn = createServerFn({ method: "GET" }).handler(async () =>
  (await lib()).logisticsContext(),
);

/** Rocket-lift weights for the given items (null = unset → default applies). */
export const itemWeightsFn = createServerFn({ method: "GET" })
  .validator((names: string[]) => names)
  .handler(async ({ data }) => (await lib()).itemWeights(data));

export const setLogisticsPrefsFn = createServerFn({ method: "POST" })
  .validator(
    (d: {
      showBelts?: boolean;
      showInserters?: boolean;
      showRockets?: boolean;
      belt?: string;
      mover?: string;
      moverKind?: "inserter" | "loader";
      stacking?: boolean;
      overrideStack?: number | null;
    }) => d,
  )
  .handler(async ({ data }) => {
    const q = await lib();
    if (data.showBelts != null) q.metaSet("logistics_show_belts", data.showBelts ? "1" : "0");
    if (data.showInserters != null)
      q.metaSet("logistics_show_inserters", data.showInserters ? "1" : "0");
    if (data.showRockets != null) q.metaSet("logistics_rockets", data.showRockets ? "1" : "0");
    if (data.belt != null) q.metaSet("logistics_belt", data.belt);
    if (data.mover != null) q.metaSet("logistics_mover", data.mover);
    if (data.moverKind != null) q.metaSet("logistics_mover_kind", data.moverKind);
    if (data.stacking != null) q.metaSet("logistics_stacking", data.stacking ? "1" : "0");
    if (data.overrideStack !== undefined)
      q.metaSet(
        "logistics_stack_override",
        data.overrideStack == null ? "" : String(Math.max(1, Math.round(data.overrideStack))),
      );
    return { ok: true };
  });

/** Manual planning exclusions (uncraftable EE is excluded by default automatically). */
export const exclusionsFn = createServerFn({ method: "GET" }).handler(async () =>
  (await lib()).getExclusions(),
);
export const setExclusionsFn = createServerFn({ method: "POST" })
  .validator((d: { globs?: string[] }) => d)
  .handler(async ({ data }) => {
    (await lib()).setExclusions(data);
    return { ok: true };
  });

/** Research/TURD planning horizon: now vs future, available science packs,
 * explicitly-researched techs (mock for the mod bridge). */
export const researchHorizonFn = createServerFn({ method: "GET" }).handler(async () => {
  const q = await lib();
  const h = q.getResearchHorizon();
  const m = q.metaAll();
  // when planning up to a target, surface the resolved tech + its display for the UI
  const targetTechDisplay =
    h.targetTech && h.mode === "target"
      ? (q.techDisplays([h.targetTech]).get(h.targetTech) ?? h.targetTech)
      : null;
  const targetDisplay = h.target ? (q.classifyRef(h.target)?.display ?? h.target) : null;
  return {
    mode: h.mode,
    packs: [...h.packs],
    researched: [...h.researched],
    allPacks: q.allSciencePacks(),
    target: h.target,
    targetDisplay,
    targetTech: h.targetTech,
    targetTechDisplay,
    // live research pushed by the in-game mod (bridge), if any
    syncedAt: m.research_synced_at ?? null,
    syncedCount: m.research_synced_count ? Number(m.research_synced_count) : null,
  };
});
export const setResearchHorizonFn = createServerFn({ method: "POST" })
  .validator(
    (d: {
      mode?: "now" | "future" | "target";
      packs?: string[];
      researched?: string[];
      target?: string | null;
    }) => d,
  )
  .handler(async ({ data }) => {
    (await lib()).setResearchHorizon(data);
    return { ok: true };
  });

/** App-level AI config (OpenRouter key + model). Env always wins; the stored value
 * is the UI default. The key itself is never sent back — only whether one is set. */
export const aiConfigFn = createServerFn({ method: "GET" }).handler(async () => {
  const cfg = await import("./app-config.ts");
  const stored = cfg.readAppConfig();
  return {
    keyStored: !!stored.openrouterApiKey,
    keyFromEnv: !!process.env.OPENROUTER_API_KEY,
    model: stored.model ?? "",
    modelFromEnv: !!process.env.PYOPS_AGENT_MODEL,
    resolvedModel: cfg.resolveModel().model,
    defaultModel: cfg.DEFAULT_MODEL,
  };
});

/** Persist the app-level AI config. Pass a field to set it ("" clears it back to
 * env/default); omit a field to leave it unchanged. */
export const setAiConfigFn = createServerFn({ method: "POST" })
  .validator((d: { openrouterApiKey?: string | null; model?: string | null }) => d)
  .handler(async ({ data }) => {
    const { writeAppConfig } = await import("./app-config.ts");
    const patch: { openrouterApiKey?: string; model?: string } = {};
    if (data.openrouterApiKey !== undefined) patch.openrouterApiKey = data.openrouterApiKey ?? "";
    if (data.model !== undefined) patch.model = data.model ?? "";
    writeAppConfig(patch);
    return { ok: true };
  });

/** Resolve a good to the tech that first unlocks making it — for the target-horizon
 * picker, so the user can search by item and see which tech gates it. */
export const goodUnlockTechFn = createServerFn({ method: "GET" })
  .validator((good: string) => good)
  .handler(async ({ data }) => (await lib()).unlockTechForGood(data));

/** Tech search for the researched-tech picker (+ display names for chips). */
export const searchTechsFn = createServerFn({ method: "GET" })
  .validator((q: string) => q)
  .handler(async ({ data }) => (await lib()).searchTechs(data, 30));
export const techDisplaysFn = createServerFn({ method: "GET" })
  .validator((names: string[]) => names)
  .handler(async ({ data }) => [...(await lib()).techDisplays(data).entries()]);

/** Full detail for one technology (hover card): cost, unlocks, prerequisites. */
export const techDetailFn = createServerFn({ method: "GET" })
  .validator((tech: string) => tech)
  .handler(async ({ data }) => (await lib()).techDetail(data));

/** Recompute the cost analysis LP for the active project (runs automatically
 * after every data sync; this is the manual trigger). */
export const recomputeCostsFn = createServerFn({ method: "POST" }).handler(async () => {
  const { computeCostAnalysis } = await import("./cost-analysis.ts");
  const { currentDatabaseFile } = await import("../db/index.ts");
  return computeCostAnalysis(currentDatabaseFile());
});

/* ── Game-data sync (server-side dumping) ───────────────────────────────────── */
const dumpLib = () => import("./dump.ts");

/** Current sync pipeline state (poll while a sync runs). */
export const syncStateFn = createServerFn({ method: "GET" }).handler(async () =>
  (await dumpLib()).syncState(),
);

/** Whether Factorio is already running (holds its instance lock) — so the UI can
 * warn before a dump and avoid launching into a guaranteed lock failure. `running`
 * is null when we can't tell (then the dump is attempted and the error is mapped). */
export const factorioRunningFn = createServerFn({ method: "GET" }).handler(async () => ({
  running: await (await dumpLib()).factorioRunning(),
}));

/** Kick off the dump → import (→ atlas) pipeline. Icons are opt-in: that
 * stage loads the full game and Steam may prompt for launch confirmation. */
export const startDataSyncFn = createServerFn({ method: "POST" })
  .validator((d: { icons?: boolean }) => d)
  .handler(async ({ data }) => (await dumpLib()).startDataSync(data));

/** Data health: row counts, when/what we imported, and whether the current
 * mod list still matches the data fingerprint. */
export const dataStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const q = await lib();
  const d = await dumpLib();
  const metaMap = q.metaAll();
  let currentFingerprint: string | null = null;
  try {
    currentFingerprint = await d.modListFingerprint();
  } catch {
    /* factorio dir missing */
  }
  // The mod set (name + version + enabled) this project's data was dumped from —
  // the provenance of the reference data, shown so you can see exactly what your
  // saved plans were built against.
  let mods: { name: string; enabled: boolean; version: string | null }[] = [];
  if (metaMap.mod_list) {
    try {
      mods = JSON.parse(metaMap.mod_list);
    } catch {
      mods = [];
    }
  }
  return {
    stats: q.stats(),
    meta: metaMap,
    mods,
    currentFingerprint,
    stale:
      currentFingerprint != null &&
      metaMap.data_fingerprint != null &&
      currentFingerprint !== metaMap.data_fingerprint,
  };
});

/** Mod-drift check: compare the game's CURRENT mod set (live from the mods dir)
 * against the baseline this project's data was dumped from (#28, `meta.mod_list`),
 * by name AND version. Returns the categorized drift plus `needsRedump` — the
 * signal that the reference data no longer matches the game and a re-dump is due.
 * Cheap (two small file reads), so it's safe to poll on app start, on project
 * switch (a full reload re-runs it), on bridge reconnect, and periodically. */
export const modDriftFn = createServerFn({ method: "GET" }).handler(async () => {
  const q = await lib();
  const d = await dumpLib();
  const metaMap = q.metaAll();
  let baseline: import("./dump.ts").ModEntry[] | null = null;
  if (metaMap.mod_list) {
    try {
      baseline = JSON.parse(metaMap.mod_list);
    } catch {
      baseline = null;
    }
  }
  let current: import("./dump.ts").ModEntry[] | null = null;
  try {
    current = await d.readMods();
  } catch {
    current = null; // factorio dir missing — can't compare, don't nag
  }
  if (!baseline || !current)
    return { haveBaseline: !!baseline, drift: null, needsRedump: false } as const;
  return {
    haveBaseline: true,
    drift: d.diffMods(baseline, current),
    needsRedump: d.redumpNeeded(baseline, current),
  };
});

/* ── TURD (Pyanodon tech upgrades) ──────────────────────────────────────────── */

export const listTurdUpgradesFn = createServerFn({ method: "GET" }).handler(async () =>
  (await lib()).listTurdUpgrades(),
);

/** Live TURD state pushed by the in-game mod (bridge), if any. Mirrors the
 * research synced status — drives the "✓ live: N synced" note on the TURD page. */
export const turdSyncStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const m = (await lib()).metaAll();
  let unknown: { master: string; sub: string }[] = [];
  if (m.turd_synced_unknown) {
    try {
      unknown = JSON.parse(m.turd_synced_unknown) as { master: string; sub: string }[];
    } catch {
      unknown = [];
    }
  }
  return {
    syncedAt: m.turd_synced_at ?? null,
    syncedCount: m.turd_synced_count ? Number(m.turd_synced_count) : null,
    unknown,
  };
});

/** Re-solve every saved block and refresh its cached flows — used after a
 * global change (TURD selection, research). Returns how many were re-solved. */
export async function resolveAllBlocks() {
  const q = await lib();
  const all = q.listBlocks();
  for (const b of all) {
    const row = q.getBlock(b.id);
    if (!row) continue;
    const data = row.data as SolveInput;
    const r = await computeBlock(data);
    // broken blocks keep their last-good cache (persistBlock passes null flows)
    await persistBlock(
      q,
      { id: b.id, name: row.name, iconKind: row.iconKind, iconName: row.iconName },
      data,
      r,
    );
  }
  return all.length;
}

/** Dry-run change detection: re-solve every saved block WITHOUT saving and
 * compare against its cached flows, so a TURD pick or data re-import that changed
 * recipes surfaces *which* blocks are affected and *how*, rather than silently
 * re-solving. Reports broken blocks (a referenced recipe no longer exists or the
 * solve errors) and changed blocks (their fresh I/O differs from the cache). */
export const blockChangeReportFn = createServerFn({ method: "GET" }).handler(async () => {
  const q = await lib();
  const EPS = 1e-4;

  // a stable per-good key + label for diffing the boundary flows
  type Report = {
    id: number;
    name: string;
    status: "ok" | "changed" | "broken";
    stale: boolean;
    missingRecipes: string[];
    missingGoods: string[];
    changes: {
      item: string;
      display: string | null;
      kind: string;
      was: number | null;
      now: number | null;
    }[];
    error?: string;
  };
  const reports: Report[] = [];

  for (const b of q.listBlocks()) {
    const row = q.getBlock(b.id);
    if (!row) continue;
    const data = normalizeBlockData(row.data as SolveInput) as SolveInput;
    // staleness is now per-block: the block's own referenced prototypes changed
    // (in-place mod update or a vanished recipe), not just the global mod set.
    const stale = row.dataFingerprint !== q.blockReferenceFingerprint(data);

    const missing = q.blockMissingRefs(data);
    if (missing.recipes.length > 0 || missing.goods.length > 0) {
      reports.push({
        id: b.id,
        name: row.name,
        status: "broken",
        stale,
        missingRecipes: missing.recipes,
        missingGoods: missing.goods,
        changes: [],
      });
      continue;
    }

    let fresh: { item: string; kind: string; role: string; rate: number }[];
    try {
      const r = await computeBlock(data);
      fresh = boundaryFlows(goalFlows(data, q), r);
    } catch (e) {
      reports.push({
        id: b.id,
        name: row.name,
        status: "broken",
        stale,
        missingRecipes: [],
        missingGoods: [],
        changes: [],
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    // diff cached vs fresh by (item) on net rate (sum across roles, signed:
    // primary/byproduct positive, import negative) — captures appeared/gone/changed
    const net = (flows: { item: string; kind: string; role: string; rate: number }[]) => {
      const m = new Map<string, { kind: string; rate: number }>();
      for (const f of flows) {
        const cur = m.get(f.item) ?? { kind: f.kind, rate: 0 };
        cur.rate += f.role === "import" ? -f.rate : f.rate;
        m.set(f.item, cur);
      }
      return m;
    };
    const before = net(q.getBlockFlows(b.id));
    const after = net(fresh);
    const items = new Set<string>([...before.keys(), ...after.keys()]);
    const changes: Report["changes"] = [];
    for (const item of items) {
      const wasV = before.get(item);
      const nowV = after.get(item);
      const was = wasV ? wasV.rate : null;
      const now = nowV ? nowV.rate : null;
      if (was == null || now == null || Math.abs(was - now) > EPS) {
        const kind = nowV?.kind ?? wasV?.kind ?? "item";
        changes.push({
          item,
          display: q.getItem(item)?.display ?? q.getFluid(item)?.display ?? null,
          kind,
          was,
          now,
        });
      }
    }
    reports.push({
      id: b.id,
      name: row.name,
      status: changes.length > 0 ? "changed" : "ok",
      stale,
      missingRecipes: [],
      missingGoods: [],
      changes: changes.sort((a, c) => (a.display ?? a.item).localeCompare(c.display ?? c.item)),
    });
  }

  const affected = reports.filter((r) => r.status !== "ok");
  return { reports: affected, total: reports.length, affected: affected.length };
});

/** Set (or clear) the chosen sub-tech for a TURD master, then re-solve all
 * cached blocks since TURD effects change machine throughput everywhere. */
export const setTurdSelectionFn = createServerFn({ method: "POST" })
  .validator((d: { masterTech: string; subTech: string | null }) => d)
  .handler(async ({ data }) => {
    (await lib()).setTurdSelection(data.masterTech, data.subTech);
    const resolved = await resolveAllBlocks();
    return { ok: true, resolved };
  });

/* ── Folders (block groups) ──────────────────────────────────────────────────── */
export const listGroupsFn = createServerFn({ method: "GET" }).handler(async () =>
  (await lib()).listGroups(),
);

export const createGroupFn = createServerFn({ method: "POST" })
  .validator((name: string) => name)
  .handler(async ({ data }) => ({ id: (await lib()).createGroup(data.trim() || "New folder") }));

export const renameGroupFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; name: string }) => d)
  .handler(async ({ data }) => {
    (await lib()).renameGroup(data.id, data.name.trim() || "Folder");
    return { ok: true };
  });

export const deleteGroupFn = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .handler(async ({ data }) => {
    (await lib()).deleteGroup(data);
    return { ok: true };
  });

export const setBlockGroupFn = createServerFn({ method: "POST" })
  .validator((d: { blockId: number; groupId: number | null }) => d)
  .handler(async ({ data }) => {
    (await lib()).setBlockGroup(data.blockId, data.groupId);
    return { ok: true };
  });

export const setGroupParentFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; parentId: number | null }) => d)
  .handler(async ({ data }) => ({ ok: (await lib()).setGroupParent(data.id, data.parentId) }));

export const setBlockOrderFn = createServerFn({ method: "POST" })
  .validator((ids: number[]) => ids)
  .handler(async ({ data }) => {
    (await lib()).setBlockOrder(data);
    return { ok: true };
  });

export const setGroupOrderFn = createServerFn({ method: "POST" })
  .validator((ids: number[]) => ids)
  .handler(async ({ data }) => {
    (await lib()).setGroupOrder(data);
    return { ok: true };
  });

export type IconSlot = { s: number; x: number; y: number };
export type IconManifest = {
  cell: number;
  atlasSize: number;
  sheets: string[];
  icons: Record<string, IconSlot>;
};

// The icon atlas manifest, served as data (small, not cached) rather than a
// static file — avoids the dev static-serving bug and works in production.
export const iconManifestFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<IconManifest> => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const raw = await fs.readFile(path.join(process.cwd(), "icon-data", "manifest.json"), "utf8");
    // file content is untyped input — assert the shape at this boundary only
    const manifest = JSON.parse(raw) as IconManifest;
    // Cache-bust the atlas sheets: the PNGs are served at stable URLs (/icons/
    // atlas-0.png), so a re-import or a project switch (new dump → new atlas at the
    // same path) would otherwise be masked by the browser cache (icons land on the
    // wrong sprites until a hard refresh). The data fingerprint changes whenever the
    // dump does and differs per project, so it's the right version token. The /icons
    // handler ignores the query string and still serves the file.
    const q = await lib();
    const fp = q.metaAll().data_fingerprint;
    if (fp) manifest.sheets = manifest.sheets.map((s) => `${s}?v=${fp}`);
    return manifest;
  },
);
