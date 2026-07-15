/**
 * Block computation core — server-only (import protection keeps it out of any
 * client bundle). The solve → machines/fuel/power pipeline (`computeBlock`),
 * block persistence with cached flows (`persistBlock`), the in-game summary
 * push (`showBlockInGame`/`hideBlockInGame`), and the bulk re-solve
 * (`resolveAllBlocks`). Extracted from factorio.ts so the server-fn layer
 * stays client-importable while this module imports the query layer statically.
 */
import type { Disposition } from "../solver/migrate";
import { expandTemps, type TempComponent, type TempRecipeDef } from "../solver/temps";
import { solveBlockLp, type LpBlockInput, type Pin } from "../solver/lp";
import {
  composeSubBlocks,
  isSyntheticSubName,
  type ComposedGroup,
  type SubBlockSolve,
} from "../solver/subblock";
import { diagnoseBlock, type DiagnosisCard } from "../solver/diagnose";
import { migrateToLpInput } from "../solver/migrate";
import type { TemperatureQualifier } from "../solver/temperature-flow";

/** A pin as stored in the block doc (#91): counts are in BUILDINGS (what the
 * user sees on the row); the solve converts to executions/sec via the row's
 * per-building craft rate, so module/beacon changes re-derive the rate. */
export type DocPin =
  | { kind: "count" | "cap"; recipe: string; count: number }
  | { kind: "share"; recipe: string; item: string; share: number; base?: "total" | "remaining" }
  /** this recipe absorbs the item's surplus (net = 0) — byproduct disposal */
  | { kind: "drain"; recipe: string; item: string };
import { computeEffects, type BeaconConfig } from "./effects";
import { pickAutoModules } from "./module-fill.server.ts";
import { resolveLogistics, rowLogistics } from "../lib/logistics";
import { prodScaledAmount } from "../lib/productivity";
import { reactorHeatMultiplier, REACTOR_LAYOUT_DEFAULT, type ReactorLayout } from "../lib/reactor";
import { goalNames, normalizeBlockData } from "../lib/goals";
import { fmtTemp, fmtTempRange } from "../lib/format";
import type { Goal } from "../db/schema.ts";
import * as q from "../db/queries.server.ts";
import {
  currentSolveGeneration,
  markSolveGenerationResolved,
  solveProjectionVersionNeedsRefresh,
  solveGenerationNeedsRefresh,
} from "../db/solve-generation.server.ts";
import { withUndoAction } from "./undo-action.server.ts";
import { ensureBridge, sendToPeer } from "./bridge/server.ts";

/** Pseudo-fluids modeling energy flows (1 unit = 1 MJ → rate/s = MW). Electricity
 * is grid-distributed (always an import); heat is a short-trip mechanic that must
 * be produced locally — it flows through the solver as a real good so a reactor
 * recipe in the block gets sized to the heat draw. Fluid fuel (#25) works like
 * heat: unfiltered `burns_fluid` machines draw MJ of pyops-fluid-fuel, and a
 * `burn-fluid-*` conversion recipe in the block gets sized to supply it. */
const HEAT = "pyops-heat";
const FLUID_FUEL = "pyops-fluid-fuel";
const ELECTRICITY = "pyops-electricity";

/** How a fluid-energy-source machine takes in fuel (#25/#114), from the dump's
 * FluidEnergySource: `burns_fluid` machines burn by fuel_value — any
 * fuel-valued fluid when unfiltered (the shared pyops-fluid-fuel pool: Py's
 * glassworks/smelter/antimony drills/oil boiler), or exactly the fluid_box's
 * filter fluid when set (Py's oil/gas powerplants). Non-burning fluid sources
 * consume their filter fluid by TEMPERATURE (#114 — Py: uf6 reactors, compost
 * plants, the solar tower): a fixed units/s drain (`fluidFuelPerSec`, from
 * fluid_usage_per_tick or the engine's maximum_temperature derivation) or an
 * energy-following one (draw ÷ `fluidFuelEnergyJ` usable J per unit) — see
 * db/fluid-energy.ts. A null burnsFluid is a pre-#25 import: treat it as the
 * pool (the common Py case) until a re-sync; a temperature source with neither
 * drain column (pre-#114 import) stays unmodelled until a re-sync. */
function fluidFueling(m: {
  burnsFluid: number | null;
  fluidFuelFilter: string | null;
  fluidFuelPerSec: number | null;
  fluidFuelEnergyJ: number | null;
}):
  | { mode: "pool" }
  | { mode: "pinned"; fluid: string }
  | { mode: "temperature"; fluid: string; perSec: number | null; energyJ: number | null }
  | { mode: "none" } {
  const burns = m.burnsFluid == null ? true : m.burnsFluid !== 0;
  if (!burns) {
    if (m.fluidFuelFilter && (m.fluidFuelPerSec != null || m.fluidFuelEnergyJ != null))
      return {
        mode: "temperature",
        fluid: m.fluidFuelFilter,
        perSec: m.fluidFuelPerSec,
        energyJ: m.fluidFuelEnergyJ,
      };
    return { mode: "none" };
  }
  return m.fluidFuelFilter ? { mode: "pinned", fluid: m.fluidFuelFilter } : { mode: "pool" };
}

/** Steady drain (units/s) of a temperature-fed machine's filter fluid, for ONE
 * running machine at consumption multiplier `consMult` (#114). Fixed-rate
 * sources ignore modules — the engine consumes their derived per-tick rate
 * regardless; scaling sources follow the actual energy draw. */
function temperatureDrainPerMachine(
  f: { perSec: number | null; energyJ: number | null },
  energyUsageW: number | null,
  consMult: number,
): number {
  if (f.perSec != null) return f.perSec;
  if (f.energyJ && energyUsageW) return (energyUsageW * consMult) / f.energyJ;
  return 0;
}

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
export function defaultFuel<T extends { name: string; fuelValueJ: number | null }>(
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
export function pickDefaultMachine<
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
 * block as a consumer of the good, not a negative producer. A stock goal (#38)
 * exports at role "stock" — primary-like everywhere, but factory views can mark
 * it as a buffer-refill demand rather than continuous throughput. */
/** The full cached boundary-flow list for a solved block: the produce/stock
 * goals (each a primary output sized to its rate), the surplus byproducts, and
 * the imports. Centralized so every save path emits the same shape.
 *
 * Only PRODUCE/stock goals (rate ≥ 0) are emitted as goal-flows: the solver
 * excludes them from its own exports, so this is where the produced output
 * enters the cache. A SINK goal (rate < 0, "consume N/s") is NOT emitted — the
 * solver already reports the consumed good in `r.imports` at its true net rate,
 * so adding a goal-flow too would list the block twice as a consumer and
 * double-count the demand in the factory totals. */
export function boundaryFlows(
  goals: {
    name: string;
    kind: string;
    rate: number;
    direction?: "produce" | "consume";
    stock?: boolean;
  }[],
  r: {
    exports: { name: string; kind: string; rate: number }[];
    imports: { name: string; kind: string; rate: number }[];
    qualifiedImports?: ({ name: string; kind: string; rate: number } & TemperatureQualifier)[];
    qualifiedExports?: ({ name: string; kind: string; rate: number } & TemperatureQualifier)[];
    qualifiedGoals?: Record<string, ({ rate: number } & TemperatureQualifier)[]>;
  },
) {
  const goalRows = goals
    .filter((g) => g.direction !== "consume" && g.rate >= 0)
    .flatMap((g) => {
      const qualified = r.qualifiedGoals?.[g.name];
      if (!qualified?.length)
        return [{ item: g.name, kind: g.kind, role: g.stock ? "stock" : "primary", rate: g.rate }];
      const total = qualified.reduce((sum, flow) => sum + flow.rate, 0);
      let assigned = 0;
      return qualified.map((flow, index) => {
        const sourceRate = flow.rate;
        const rate =
          index === qualified.length - 1
            ? Math.max(0, g.rate - assigned)
            : total > 0
              ? (g.rate * sourceRate) / total
              : 0;
        assigned += rate;
        return {
          item: g.name,
          kind: g.kind,
          role: g.stock ? "stock" : "primary",
          rate,
          ...(flow.temperatureMode
            ? {
                temperatureMode: flow.temperatureMode,
                minTemp: flow.minTemp,
                maxTemp: flow.maxTemp,
              }
            : {}),
        };
      });
    });
  return [
    ...goalRows,
    ...(r.qualifiedExports ?? r.exports).map(({ name, ...f }) => ({
      ...f,
      item: name,
      role: "byproduct",
    })),
    ...(r.qualifiedImports ?? r.imports).map(({ name, ...f }) => ({
      ...f,
      item: name,
      role: "import",
    })),
  ];
}

/** Resolve a block's goals to `{ name, kind, rate }` for the boundary cache (the
 * good's kind is needed so the flow icons correctly). */
export function goalFlows(data: SolveInput): {
  name: string;
  kind: string;
  rate: number;
  direction?: "produce" | "consume";
  stock?: boolean;
}[] {
  return data.goals.map((g) => ({
    name: g.name,
    kind: q.getFluid(g.name) ? "fluid" : "item",
    rate: g.rate,
    direction: g.direction ?? (g.rate < 0 ? "consume" : "produce"),
    stock: g.stock != null,
  }));
}

/** Machine requirement to cache for a solved block: how many of each machine the
 * block runs, keyed by the RECIPE it runs (so built-vs-required can compare per
 * recipe, not just per machine). Fractional — the theoretical count; the UI ceils
 * when comparing against what's built. Exported for the agent tools (draft
 * `buildings` field, `buildingBill`), which reuse it against `computeBlock`'s
 * solved rows instead of re-deriving machine counts. */
export function machineReqs(
  rows: { recipe: string; machine?: { name: string; count: number } | null }[],
) {
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

export type SolveInput = {
  // Output goals, primary first (see lib/goals.ts). A pinned goal (numeric rate)
  // becomes a solver target; an unpinned goal (null rate) is a co-product relabeled
  // from a surplus export. goals[0] anchors naming/icon and the rate-scaling tools.
  goals: Goal[];
  icon?: { kind: string; name: string }; // explicit block icon (#40); unset = first goal's
  recipes: string[];
  disabledRecipes?: string[]; // recipes kept in the block but excluded from the solve (#73)
  // sub-block groups (#7 display-only, #76 composed) + recipe → group id
  rowGroups?: { id: number; name: string; composed?: boolean; goals?: Goal[]; made?: string[] }[];
  recipeGroups?: Record<string, number>; // recipe → sub-block group id
  /** item → estimated incidental rot rate /s (#20). Operational projection only:
   * it leaves the nominal recipe solve untouched and adds the item's spoil result
   * to the boundary byproducts after the solve. */
  spoilRates?: Record<string, number>;
  /** factory allocation tier for this block; higher is preferred */
  supplyPriority?: number;
  /** optional exported-good overrides; missing entries inherit supplyPriority */
  supplyPriorities?: Record<string, number>;
  /** legacy per-item overrides (pre-#91 docs) — migrated to `made` on read; new
   * docs never write this */
  dispositions?: Record<string, Disposition>;
  /** items this block claims in-block production for (net ≥ 0; #91). Absent on a
   * legacy doc → derived from dispositions via the migration mapping and echoed
   * back on the result so the editor persists it on next save. */
  made?: string[];
  /** per-row pins (#91), in building counts (converted to rates at solve time):
   * count = always run exactly N buildings; cap = at most N buildings (built
   * ceiling); share = this consumer takes a % of the item's production. */
  pins?: DocPin[];
  machines?: Record<string, string>; // recipe → chosen machine (else fastest)
  fuels?: Record<string, string>; // recipe → chosen fuel (else cheapest available)
  /** Per-recipe planned temperature for a fluid ingredient. Missing means Auto
   * (the prototype's full accepted range). This is routing intent, not a change
   * to the Factorio recipe prototype. */
  fluidTemperatures?: Record<string, Record<string, number>>;
  // Reactor farm layout per reactor recipe row (#94): the assumed x×y grid whose
  // neighbour bonus scales the row's heat output (absent = 1×1, no bonus).
  reactorLayouts?: Record<string, ReactorLayout>;
  modules?: Record<string, string[]>; // recipe → modules in the machine's slots
  beacons?: Record<string, BeaconConfig[]>; // recipe → beacons affecting each machine
};

/** Core block computation (solve → machines/fuel/power, fuel/ash folded into the
 * boundary flows). Shared by the live solve and block saving so both use one path. */
export async function computeBlock(rawData: SolveInput) {
  // Tolerate the legacy { target, rate, extraGoals } shape from older saved docs.
  const data = normalizeBlockData(rawData) as SolveInput;
  const refs = q.createBlockSolveContext(data.recipes);
  const fuelsByCategorySet = new Map<string, ReturnType<typeof q.fuelsForCategories>>();
  const fuelsForCategories = (categories: string[]) => {
    const key = [...categories].sort().join("\u0000");
    const cached = fuelsByCategorySet.get(key);
    if (cached) return cached;
    const fuels = q.fuelsForCategories(categories);
    fuelsByCategorySet.set(key, fuels);
    return fuels;
  };

  // Drift guard: if the block references a recipe or goal good that no longer
  // exists in the current reference data (a mod was updated/disabled/removed),
  // DO NOT solve. Silently dropping the missing recipe would re-solve the block
  // to different rates and flows with no warning. Mark it `broken` and solve an
  // EMPTY recipe set instead — a harmless underdetermined result — so callers
  // preserve the last-good cache and the UI shows exactly what's missing.
  const missing = q.blockMissingRefs(data);
  const broken = missing.recipes.length > 0 || missing.goods.length > 0;

  // Disabled recipes (#73) stay in `data.recipes` but drop out of the solve, so
  // they add no equations, boundary flows, or machine counts. A/B two recipes by
  // disabling one; stage future rows by keeping them off until enabled.
  const disabled = new Set(data.disabledRecipes ?? []);
  const fetched = broken
    ? ([] as NonNullable<ReturnType<typeof q.getRecipe>>[])
    : (data.recipes ?? [])
        .filter((name) => !disabled.has(name))
        .map((name) => refs.getRecipe(name))
        .filter((r): r is NonNullable<ReturnType<typeof q.getRecipe>> => !!r);
  const fluidTemperatureOptions = q.producedFluidTemperatures([
    ...fetched.flatMap((recipe) =>
      [...recipe.ingredients, ...recipe.products].flatMap((component) =>
        component.kind === "fluid" ? [component.name] : [],
      ),
    ),
    ...data.goals.flatMap((goal) => (refs.getFluid(goal.name) ? [goal.name] : [])),
  ]);
  const favoriteFluidTemperatures = q.getFavoriteFluidTemperatures();

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
  // Research-driven productivity (#92): mining-productivity levels + Factorio
  // 2.0 change-recipe-productivity techs, gated by the research horizon exactly
  // like machine availability (everything in FUTURE, reached techs otherwise).
  const researchProd = refs.productivityBonuses();

  const turdMods = q.activeTurdModules();
  const turdFor = (machine: { name: string; allowedModuleCategories: string[] | null } | null) => {
    if (!machine || !turdMods.length) return [];
    return turdMods.filter((mod) => {
      if (!machine.allowedModuleCategories?.includes(mod.category ?? "")) return false;
      const tier = /-mk0(\d)$/.exec(mod.name);
      return !tier || machine.name.endsWith(`-mk0${tier[1]}`);
    });
  };

  // Module auto-fill is SUGGESTED, never applied. Suggestions intentionally live
  // outside this core solve now: their availability scan was the dominant part
  // of an otherwise sub-millisecond LP solve. `computeModuleSuggestions` runs
  // after a coalesced editor save and consumes the authoritative solved rates.
  // The solve itself only ever uses the doc's stored modules, so plans don't
  // rearrange themselves when research unlocks better tiers or counts drift.
  const settings = q.metaAll();
  const moduleHints = (settings.autofill ?? "1") !== "0"; // hint visibility only
  // Machine eligibility: in NOW mode the default pick is restricted to buildings
  // the player has actually unlocked (real research from the bridge, else the
  // science-pack proxy). FUTURE mode allows any machine. An explicit per-recipe
  // override always wins, and the picker still lists every machine (flagged).
  const machinesByRecipe = new Map(
    fetched.map((r) => [
      r.name,
      refs
        .machinesForRecipe(r.name) // sorted fastest-first (for the picker)
        .slice()
        .sort((a, b) => (b.craftingSpeed ?? 0) - (a.craftingSpeed ?? 0)),
    ]),
  );
  const restrictMachines = q.getResearchHorizon().mode !== "future";
  const unlockedMachines = restrictMachines
    ? refs.availableMachines([...new Set([...machinesByRecipe.values()].flat().map((m) => m.name))])
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
      const machineModules = (manual ?? [])
        .filter((n) => moduleDb.has(n))
        .slice(0, chosen?.moduleSlots ?? 0);
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
        {
          recipeProd: researchProd.recipes.get(r.name) ?? 0,
          miningProd: r.kind === "mining" ? researchProd.mining : 0,
          maxProductivity: r.maximumProductivity,
        },
      );
      return [
        r.name,
        {
          chosen,
          machineModules,
          beaconCfgs,
          turdModules,
          effects,
        },
      ] as const;
    }),
  );

  // Goods produced by some recipe in this block — used to decide whether a burner's
  // fuel is self-supplied (model it in the LP so production scales to self-fuel) vs
  // imported (handled post-hoc as a fuel import).
  const producedInBlock = new Set(fetched.flatMap((r) => r.products.map((p) => p.name)));
  const selfFueled = new Set<string>(); // recipes whose fuel is modeled in the LP (skip the post-hoc fold)
  const defs: TempRecipeDef[] = fetched.map((r) => {
    const s = setup.get(r.name)!;
    const fx = s.effects;
    const chosen = s.chosen;
    const ingredients: TempComponent[] = r.ingredients.map((c) => {
      const selected = data.fluidTemperatures?.[r.name]?.[c.name];
      const fluid = c.kind === "fluid" ? refs.getFluid(c.name) : null;
      const acceptedMin = c.minTemp ?? fluid?.defaultTemperature ?? null;
      const acceptedMax = c.maxTemp ?? fluid?.maxTemperature ?? null;
      const validSelection =
        c.kind === "fluid" &&
        selected != null &&
        Number.isFinite(selected) &&
        (acceptedMin == null || selected >= acceptedMin) &&
        (acceptedMax == null || selected <= acceptedMax);
      return {
        kind: c.kind,
        name: c.name,
        amount: c.amount,
        minTemp: validSelection ? selected : acceptedMin,
        maxTemp: validSelection ? selected : c.maxTemp,
      };
    });
    const extraProducts: TempComponent[] = [];
    // Self-fueling burners: when a machine burns a fuel this block PRODUCES (e.g. a
    // burner-mining-drill mining raw-coal while burning raw-coal), model the burn in
    // the LP — a fuel ingredient (+ its ash product) per execution. The solver then
    // scales mining up so net output meets the target AND covers its own fuel, and
    // ash falls out as a real byproduct, instead of the fuel showing as an import.
    // Imported fuels (not produced in-block) stay post-hoc. Mirrors the powerW formula.
    // Applies to solid burners and PINNED fluid burners (a filtered powerplant
    // burning the gas the block makes); pooled fluid burners are handled below.
    const fueling = chosen?.energySource === "fluid" ? fluidFueling(chosen) : null;
    if ((chosen?.energySource === "burner" || fueling?.mode === "pinned") && chosen?.energyUsageW) {
      const pick =
        fueling?.mode === "pinned"
          ? q.fluidFuelEntry(fueling.fluid)
          : (() => {
              const all = fuelsForCategories(chosen.fuelCategories);
              return all.find((f) => f.name === data.fuels?.[r.name]) ?? defaultFuel(all);
            })();
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
    // Pooled fluid burners (#25): an unfiltered burns_fluid machine accepts ANY
    // fuel-valued fluid, so its demand is fungible energy — model it like heat,
    // as a pyops-fluid-fuel ingredient (1 unit = 1 MJ) the solver must balance.
    // A burn-fluid-* conversion recipe in the block (1 fluid → fuel_value MJ)
    // then gets sized to the draw — the player's choice of conversion decides
    // WHICH fluid burns; several split like any other multi-producer good. With
    // no conversion present the MJ falls out as a "Fluid fuel" import — the
    // signal to add one. energy_usage_w already includes the energy source's
    // effectivity (folded at import; Py's oil boiler dumps effectivity 2).
    if (fueling?.mode === "pool" && chosen?.energyUsageW) {
      const speed = (chosen.craftingSpeed ?? 1) * fx.speedMult;
      const energyRequired = r.energyRequired ?? 0.5;
      const mjPerExec = (chosen.energyUsageW * fx.consMult * energyRequired) / (speed * 1e6);
      if (mjPerExec > 0) ingredients.push({ kind: "fluid", name: FLUID_FUEL, amount: mjPerExec });
    }
    // Temperature-fed machines (#114): a burns_fluid:false source drains its
    // filter fluid for its heat content — real consumption of a REAL fluid
    // (uf6 for Py's reactors, sweet-syrup for compost plants), so inject it as
    // a solver ingredient the same way the pool draw is. Produced in-block it's
    // balanced like any ingredient; otherwise it surfaces as an import of the
    // feed fluid — previously the block showed no demand for it at all.
    if (fueling?.mode === "temperature" && chosen) {
      const speed = (chosen.craftingSpeed ?? 1) * fx.speedMult;
      const energyRequired = r.energyRequired ?? 0.5;
      const perMachine = temperatureDrainPerMachine(fueling, chosen.energyUsageW, fx.consMult);
      // one execution occupies energyRequired/speed machine-seconds
      const perExec = (perMachine * energyRequired) / speed;
      if (perExec > 0) ingredients.push({ kind: "fluid", name: fueling.fluid, amount: perExec });
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
    // Reactor neighbour bonus (#94): each adjacent working reactor adds
    // neighbour_bonus × base heat (Py's nuclear-reactor: 1 = +100%). The row's
    // assumed x×y farm layout scales its pyops-heat output by the grid's average
    // multiplier, so the solver needs fewer reactors. Only heat scales — the
    // bonus is free output; fuel burn stays per-reactor (count-based, below).
    // No layout stored = 1×1 = no bonus (the pre-#94 model). A null bonus (a
    // pre-#94 import) falls back to the engine default of 1.
    const heatMult =
      chosen?.kind === "reactor"
        ? reactorHeatMultiplier(chosen.neighbourBonus ?? 1, data.reactorLayouts?.[r.name])
        : 1;
    return {
      name: r.name,
      energyRequired: r.energyRequired ?? 0.5,
      ingredients,
      products: [
        ...r.products.map((c) => ({
          kind: c.kind,
          name: c.name,
          probability: c.probability,
          temperature: c.temperature,
          // productivity scales only the non-ignored part of each product (#93);
          // reactor farm layouts then scale heat output only (#94)
          amount:
            prodScaledAmount(
              c.amount ??
                (c.amountMin != null && c.amountMax != null ? (c.amountMin + c.amountMax) / 2 : 0),
              fx.prodMult,
              c.ignoredByProductivity,
            ) * (c.name === HEAT ? heatMult : 1),
        })),
        // ash/burnt result from self-fuel (not productivity-scaled — it's from burning)
        ...extraProducts,
      ],
    };
  });
  // Incidental spoilage (#20) is an OPERATIONAL estimate, not steady-state
  // recipe demand. At full throttle the nominal block balance is already exact;
  // spoilage happens when goods wait during demand gaps. Keep the LP untouched
  // and project the spoil results onto boundary byproducts after the solve.
  const targets = data.goals;
  // ── the solve (#91): v2 LP on the effect-adjusted defs ─────────────────────
  // Explicit doc state wins; a legacy doc (no `made`) derives it from its old
  // dispositions via the migration mapping the parity report validated. The
  // derived set is echoed back on the result so the editor persists it.
  // Supply-push (#121): when every recipe that can produce a pinned goal has an
  // exact COUNT pin, those counts completely determine the output, so the goal's
  // rate stops forcing a conflicting total. Without this the two fight — 2
  // foundries make 0.133/s, a 0.14/s goal needs 2.1, and an exact-count pin plus a
  // ≥-floor can't both hold → a spurious infeasibility over a rounding sliver.
  //
  // A mixed-source goal is different: an exact producer establishes its fixed
  // contribution while any unpinned producer can supply the remainder. Keep the
  // goal binding in that case (e.g. 800 kW of pinned fish turbines plus an
  // unpinned steam chain for the rest of a 1 MW goal). CAP pins also leave the
  // goal binding: their ceiling should produce an honest shortfall diagnosis.
  // The doc goal is untouched (naming, rollups); when all producers are fixed,
  // only the solver floor is relaxed and `goalSuperseded` reports the gap.
  const productsByRecipe = new Map(defs.map((d) => [d.name, d.products.map((p) => p.name)]));
  const countPinnedRecipes = new Set(
    (data.pins ?? []).flatMap((pin) => (pin.kind === "count" ? [pin.recipe] : [])),
  );
  const producersByGoal = new Map(
    targets.map((target) => [
      target.name,
      defs.flatMap((def) =>
        def.products.some((product) => product.name === target.name && product.amount > 0)
          ? [def.name]
          : [],
      ),
    ]),
  );
  const supersededGoals = new Map<string, { recipe: string; count: number }>();
  for (const p of data.pins ?? []) {
    if (p.kind !== "count") continue;
    for (const prod of productsByRecipe.get(p.recipe) ?? []) {
      const producers = producersByGoal.get(prod) ?? [];
      const outputIsFullyPinned =
        producers.length > 0 && producers.every((recipe) => countPinnedRecipes.has(recipe));
      if (
        outputIsFullyPinned &&
        targets.some((t) => t.name === prod && t.rate != null) &&
        !supersededGoals.has(prod)
      )
        supersededGoals.set(prod, { recipe: p.recipe, count: p.count });
    }
  }
  const goals = targets.map((t) => {
    const producedTemperatures = fluidTemperatureOptions.get(t.name) ?? [];
    const temperature =
      t.temperature != null &&
      Number.isFinite(t.temperature) &&
      producedTemperatures.includes(t.temperature)
        ? t.temperature
        : undefined;
    return {
      name: t.name,
      rate: supersededGoals.has(t.name) ? 0 : t.rate,
      direction: t.direction ?? (t.rate < 0 ? "consume" : "produce"),
      ...(temperature != null ? { temperature } : {}),
    };
  });
  const made =
    data.made ??
    migrateToLpInput({ targets: goals, recipes: defs, dispositions: data.dispositions }).made ??
    [];
  // doc pins are in buildings; convert to executions/sec with the row's real
  // per-building craft rate (speed × speed-effects ÷ energy) so pins follow
  // module/machine changes. Rows whose recipe left the block are ignored.
  const craftRate = (recipe: string) => {
    const s = setup.get(recipe);
    const def = defs.find((d) => d.name === recipe);
    if (!s || !def) return null;
    const speed = (s.chosen?.craftingSpeed ?? 1) * s.effects.speedMult;
    return speed / Math.max(1e-9, def.energyRequired ?? 0.5);
  };
  const pins: Pin[] = [];
  // drain pins constrain the ITEM (net = 0), not a recipe rate — collected
  // separately; the recipe on the pin is provenance for the UI badge
  const drains = [
    ...new Set((data.pins ?? []).flatMap((p) => (p.kind === "drain" ? [p.item] : []))),
  ];
  for (const p of data.pins ?? []) {
    if (p.kind === "drain") continue;
    if (p.kind === "share") {
      pins.push({ kind: "share", item: p.item, recipe: p.recipe, share: p.share, base: p.base });
      continue;
    }
    const perBuilding = craftRate(p.recipe);
    if (perBuilding == null) continue;
    pins.push({
      kind: p.kind === "count" ? "rate" : "cap",
      recipe: p.recipe,
      rate: p.count * perBuilding,
    });
  }
  // Gap report for each superseded goal: what the pinned buildings actually make
  // (exact, since a count pin fixes the rate) vs the original target, and how many
  // whole buildings the target WOULD need — the UI shows this as a soft note so
  // the relaxation isn't silent ("2 foundries make 0.13/s; 0.14/s needs 3").
  const goalSuperseded = [...supersededGoals].flatMap(([item, { recipe, count }]) => {
    const goalRate = targets.find((t) => t.name === item)?.rate ?? 0;
    const def = defs.find((d) => d.name === recipe);
    const perCraft = def?.products.filter((c) => c.name === item).reduce((s, c) => s + c.amount, 0);
    const perBuilding = (perCraft ?? 0) * (craftRate(recipe) ?? 0);
    if (perBuilding <= 0) return [];
    return [
      {
        item,
        goalRate,
        pinnedCount: count,
        actualRate: perBuilding * count,
        buildingsForGoal: Math.ceil(goalRate / perBuilding - 1e-9),
      },
    ];
  });
  const defaultTemp = (f: string) => refs.getFluid(f)?.defaultTemperature ?? null;
  // Sub-blocks v2 (#76): a COMPOSED group is solved as its own module and pulled
  // out of the parent solve, replaced by a synthetic recipe carrying only its
  // boundary contract (net imports → net exports). Member recipes and pins route
  // into their module; the parent solves normally over its own recipes + these
  // synthetics. Display-only groups (#7) are untouched.
  const composedGroups: ComposedGroup[] = (data.rowGroups ?? [])
    .filter((g) => g.composed)
    .map((g) => ({
      id: g.id,
      name: g.name,
      members: Object.entries(data.recipeGroups ?? {})
        .filter(([, gid]) => gid === g.id)
        .map(([r]) => r),
      goals: (g.goals ?? []).map((x) => ({ name: x.name, rate: x.rate })),
      ...(g.made ? { made: g.made } : {}),
    }));
  const compose = composedGroups.length
    ? await composeSubBlocks({ defs, groups: composedGroups, pins, defaultTemp })
    : {
        parentDefs: defs,
        parentPins: pins,
        subs: [] as SubBlockSolve[],
        memberGroupOf: new Map<string, number>(),
      };
  // Each composed module's OUTPUT good is claimed `made` at the parent (net ≥ 0):
  // the module is the committed in-block source, so the minimizing objective can't
  // idle it and import the good instead. Only the module's declared goals are made
  // — its forced co-products stay free, so they export as byproducts or feed a
  // parent consumer. Not persisted: the block's own `made` (echoed for migration)
  // is unchanged.
  const parentMade = compose.subs.length
    ? [...new Set([...made, ...composedGroups.flatMap((g) => g.goals.map((x) => x.name))])]
    : made;
  // Fluid-temperature identity (#110): expand ranged fluids into variant/pool
  // goods with selector pseudo-recipes — a pure input transformation; the LP
  // core is untouched. `fold` maps synthetic goods/recipes back for display.
  const { input: expandedInput, fold } = expandTemps(
    { goals, recipes: compose.parentDefs, made: parentMade, pins: compose.parentPins, drains },
    defaultTemp,
  );
  const lpInput: LpBlockInput = expandedInput;
  const rawResult = await solveBlockLp(lpInput);
  // root-cause cards for the balance card — every member is a clickable gesture.
  // Fold synthetic goods back to the bare fluid (the doc's made marks are bare
  // names, so actions work) and keep the temperature as a display qualifier.
  const diagnosis: (DiagnosisCard & {
    members: { qualifier?: string | null }[];
  })[] = (rawResult.status === "infeasible" ? await diagnoseBlock(lpInput) : []).map((c) => ({
    members: c.members.map((m) => ({
      ...m,
      prov: "item" in m.prov ? { ...m.prov, item: fold.bare(m.prov.item) } : m.prov,
      qualifier: "item" in m.prov ? fold.tempOf(m.prov.item) : null,
    })),
  }));
  // fold the solve result: selector rows vanish; variant/pool flows merge onto
  // the bare fluid name; unmade keeps the temp qualifier via the display map.
  const foldFlows = (flows: { name: string; kind: string; rate: number }[]) => {
    const merged = new Map<string, { kind: string; rate: number }>();
    for (const f of flows) {
      const bare = fold.bare(f.name);
      const cur = merged.get(bare) ?? { kind: f.kind, rate: 0 };
      cur.rate += f.rate;
      merged.set(bare, cur);
    }
    return [...merged].map(([name, v]) => ({ name, ...v }));
  };
  type QualifiedResultFlow = {
    name: string;
    kind: string;
    rate: number;
    temperatureMode?: "exact" | "range" | null;
    minTemp?: number | null;
    maxTemp?: number | null;
  };
  const selectorInputs = new Map<string, { fluid: string; temperature: number; rate: number }[]>();
  for (const row of rawResult.recipes) {
    const selector = fold.selectorOf(row.recipe);
    if (!selector || row.rate <= 1e-9) continue;
    const list = selectorInputs.get(selector.pool) ?? [];
    list.push({ fluid: selector.fluid, temperature: selector.temperature, rate: row.rate });
    selectorInputs.set(selector.pool, list);
  }
  const mergeQualified = (flows: QualifiedResultFlow[]) => {
    const merged = new Map<string, QualifiedResultFlow>();
    for (const flow of flows) {
      const key = `${flow.name}\u0000${flow.temperatureMode ?? ""}\u0000${flow.minTemp ?? ""}\u0000${flow.maxTemp ?? ""}`;
      const current = merged.get(key);
      if (current) current.rate += flow.rate;
      else merged.set(key, { ...flow });
    }
    return [...merged.values()].filter((flow) => flow.rate > 1e-9);
  };
  const qualifyFlows = (
    flows: { name: string; kind: string; rate: number }[],
    direction: "import" | "export",
  ): QualifiedResultFlow[] =>
    mergeQualified(
      flows.flatMap((flow) => {
        const name = fold.bare(flow.name);
        const qualifier = fold.qualifierOf(flow.name);
        if (qualifier?.mode === "exact")
          return [
            {
              ...flow,
              name,
              temperatureMode: "exact" as const,
              minTemp: qualifier.minTemp,
              maxTemp: qualifier.maxTemp,
            },
          ];
        if (qualifier?.mode === "range" && direction === "import")
          return [
            {
              ...flow,
              name,
              temperatureMode: "range" as const,
              minTemp: qualifier.minTemp,
              maxTemp: qualifier.maxTemp,
            },
          ];
        if (qualifier?.mode === "range") {
          const inputs = selectorInputs.get(flow.name) ?? [];
          const total = inputs.reduce((sum, input) => sum + input.rate, 0);
          if (total > 1e-9)
            return inputs.map((input) => ({
              name,
              kind: flow.kind,
              rate: (flow.rate * input.rate) / total,
              temperatureMode: "exact" as const,
              minTemp: input.temperature,
              maxTemp: input.temperature,
            }));
        }
        // A real fluid imported without an explicit prototype range is an Auto
        // consumer. Pseudo-fluids have no prototype default and remain bare.
        const fluid = flow.kind === "fluid" ? refs.getFluid(name) : null;
        if (direction === "import" && fluid?.defaultTemperature != null)
          return [
            {
              ...flow,
              name,
              temperatureMode: "range" as const,
              minTemp: null,
              maxTemp: null,
            },
          ];
        return [{ ...flow, name }];
      }),
    );
  const qualifiedRawImports = qualifyFlows(rawResult.imports, "import");
  const qualifiedRawExports = qualifyFlows(rawResult.exports, "export");
  const qualifiedGoals: Record<string, QualifiedResultFlow[]> = {};
  for (const goal of goals) {
    if (goal.direction === "consume" || goal.rate < 0 || !refs.getFluid(goal.name)) continue;
    const candidates = [...selectorInputs.entries()].flatMap(([pool, inputs]) => {
      const qualifier = fold.qualifierOf(pool);
      const expectedMin = goal.temperature ?? null;
      const expectedMax = goal.temperature ?? null;
      return fold.bare(pool) === goal.name &&
        qualifier?.mode === "range" &&
        qualifier.minTemp === expectedMin &&
        qualifier.maxTemp === expectedMax
        ? inputs.map((input) => ({
            name: goal.name,
            kind: "fluid",
            rate: input.rate,
            temperatureMode: "exact" as const,
            minTemp: input.temperature,
            maxTemp: input.temperature,
          }))
        : [];
    });
    if (candidates.length) qualifiedGoals[goal.name] = mergeQualified(candidates);
  }
  // unmade entries fold to bare names (icons/actions resolve); the temperature
  // qualifier survives in unmadeTemp for the strip label ("nothing makes water
  // ≤101°" vs plain "water")
  const unmadeTemp: Record<string, string> = {};
  const unmadeBare = [
    ...new Set(
      (rawResult.unmade ?? []).map((u) => {
        const bare = fold.bare(u);
        const t = fold.tempOf(u);
        if (t) unmadeTemp[bare] = t;
        return bare;
      }),
    ),
  ];
  // #76: fold each composed module's members back into the row set at their
  // EFFECTIVE rate = the module's nested run-rate × the parent's chosen run-rate
  // of that module's synthetic recipe. The synthetic recipes themselves never
  // render (the group header stands in for them); a module's goals/made with no
  // in-module producer surface in `unmade` alongside the parent's.
  const parentRecipes = rawResult.recipes.filter((r) => !fold.isSynthetic(r.recipe));
  const synRateOf = new Map(parentRecipes.map((r) => [r.recipe, r.rate]));
  const memberRows: { recipe: string; rate: number; machines1x: number }[] = [];
  const subUnmade: string[] = [];
  for (const sub of compose.subs) {
    const sr = synRateOf.get(sub.synthetic.name) ?? 0;
    for (const rr of sub.result.recipes) {
      if (sub.fold.isSynthetic(rr.recipe)) continue; // temp selectors inside the module
      memberRows.push({ recipe: rr.recipe, rate: rr.rate * sr, machines1x: rr.machines1x * sr });
    }
    for (const u of sub.unmade) subUnmade.push(u);
  }
  const solvedRecipes = [
    ...parentRecipes.filter((r) => !isSyntheticSubName(r.recipe)),
    ...memberRows,
  ];
  const allUnmade = [...new Set([...unmadeBare, ...subUnmade])];
  const result = {
    ...rawResult,
    ...(allUnmade.length ? { unmade: allUnmade } : {}),
    recipes: solvedRecipes,
    imports: foldFlows(rawResult.imports),
    exports: foldFlows(rawResult.exports),
    qualifiedImports: qualifiedRawImports,
    qualifiedExports: qualifiedRawExports,
    qualifiedGoals,
  };

  // Per-recipe rows for the grid: each recipe's ingredients/products at the
  // solved run-rate, the chosen machine (override or fastest) with a real count
  // (machine-seconds/sec ÷ speed), its power draw, and — for burners — the
  // chosen fuel and its consumption. Machine/fuel choice is display-only; it
  // never changes the solved rates, only how many buildings / how much fuel.
  const byName = new Map(fetched.map((r) => [r.name, r]));
  const defByName = new Map(defs.map((d) => [d.name, d])); // products already productivity-scaled
  let totalPowerW = 0;
  let totalHeatW = 0; // Py hard-mode "heat" machines — must be produced locally
  // Pollution rollup (#23): base emissions/min × count × energy-consumption
  // multiplier × pollution-module multiplier — the Factorio formula, minus the
  // per-fuel emissions multiplier (a fuel-choice nuance we approximate as 1).
  let totalPollutionPerMin = 0;
  const fuelTotals = new Map<string, { display: string | null; kind: string; perSec: number }>();
  const burntTotals = new Map<string, { display: string | null; perSec: number }>(); // burnt result (ash, …)
  // An infeasible/error solve has no usable rates, but the editor still needs
  // the selected machine, fuel, modules, and recipe I/O to remain reachable so
  // the player can repair the block. Add zero-rate presentation rows for every
  // enabled recipe the solver omitted. These are editor metadata only: the raw
  // result, boundary flows, and persistence still use `result.recipes`.
  const resultRecipeNames = new Set(result.recipes.map((r) => r.recipe));
  const rowRecipes = [
    ...result.recipes,
    ...fetched
      .filter((recipe) => !resultRecipeNames.has(recipe.name))
      .map((recipe) => ({ recipe: recipe.name, rate: 0, machines1x: 0 })),
  ];
  const rows = rowRecipes.map((rr) => {
    const def = byName.get(rr.recipe)!;
    const scaled = defByName.get(rr.recipe)!;
    const { chosen, machineModules, beaconCfgs, turdModules, effects: fx } = setup.get(rr.recipe)!;
    const speed = (chosen?.craftingSpeed ?? 1) * fx.speedMult;
    // fractional building requirement (machine-seconds/sec ÷ speed); the UI
    // shows this and the whole-machine build target alongside it
    const count = rr.machines1x / speed;
    const powerW = (chosen?.energyUsageW ?? 0) * count * fx.consMult;
    const pollutionPerMin =
      (chosen?.pollutionPerMin ?? 0) * Math.max(0, count) * fx.consMult * fx.pollutionMult;
    totalPollutionPerMin += pollutionPerMin;
    const beaconPowerW = fx.beaconPowerPerMachineW * count;
    if (count > 0) totalPowerW += beaconPowerW; // beacons are always electric

    let fuel: {
      name: string;
      display: string | null;
      kind: string;
      perSec: number;
      chosen: string;
      burnt: { name: string; display: string | null; perSec: number } | null;
      /** #25: the fungible pyops-fluid-fuel pool (perSec is MJ/s) — no per-row pick */
      pool?: boolean;
      /** #25: a filtered fluid burner, pinned to its one fluid — no per-row pick */
      pinned?: boolean;
      /** #114: a temperature-fed drain (modeled in the solve as a real
       * ingredient — never folded post-hoc) — no per-row pick */
      temperature?: boolean;
    } | null = null;
    const fueling = chosen?.energySource === "fluid" ? fluidFueling(chosen) : null;
    const burns =
      chosen?.energySource === "burner" ||
      (fueling && fueling.mode !== "none" && fueling.mode !== "temperature");
    if (fueling?.mode === "temperature" && chosen) {
      // #114: the drain is already a solver ingredient (see the defs loop) —
      // the chip mirrors it for the row; adding it to fuelTotals would double
      // count. Fixed-rate drains ignore consumption effects; scaling ones don't.
      const perSec =
        temperatureDrainPerMachine(fueling, chosen.energyUsageW, fx.consMult) * Math.max(0, count);
      fuel = {
        name: fueling.fluid,
        display: refs.getFluid(fueling.fluid)?.display ?? null,
        kind: "fluid",
        perSec,
        chosen: fueling.fluid,
        burnt: null,
        temperature: true,
      };
    } else if (burns && chosen?.energyUsageW) {
      if (fueling?.mode === "pool") {
        // fungible fluid fuel (#25): the draw is MJ/s of the pool; which fluid
        // fills it is the block's choice of burn-fluid-* conversion recipe, so
        // there's no per-row fuel pick
        fuel = {
          name: FLUID_FUEL,
          display: refs.getFluid(FLUID_FUEL)?.display ?? "Fluid fuel (MJ)",
          kind: "fluid",
          perSec: powerW / 1e6, // MJ/s = MW
          chosen: FLUID_FUEL,
          burnt: null,
          pool: true,
        };
      } else {
        const pinned = fueling?.mode === "pinned";
        const all = pinned
          ? [q.fluidFuelEntry(fueling.fluid)].filter((f) => f != null)
          : fuelsForCategories(chosen.fuelCategories);
        const pick = pinned
          ? all[0]
          : (all.find((f) => f.name === data.fuels?.[rr.recipe]) ?? defaultFuel(all));
        if (pick?.fuelValueJ) {
          const perSec = powerW / pick.fuelValueJ; // J/s ÷ J/unit = units/s (effectivity folded into energy_usage_w)
          // burning yields a burnt result 1:1 (coal → ash, fuel-cell → depleted-cell)
          const burnt = pick.burntResult
            ? {
                name: pick.burntResult,
                display: refs.getItem(pick.burntResult)?.display ?? null,
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
            ...(pinned ? { pinned: true } : {}),
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
      }
    } else if (chosen?.energySource === "electric" && count > 0) {
      totalPowerW += powerW;
    } else if (chosen?.energySource === "heat" && count > 0) {
      // heat-powered building (Py hard mode): needs heat delivered locally — it
      // doesn't draw the electric grid and doesn't burn its own fuel.
      totalHeatW += powerW;
    }

    // Spoil-buffer sizing (#19): a spoiling step is passive — items sit in
    // storage until they rot, so the chest space needed is throughput × spoil
    // time (rr.rate items/s enter; each occupies a slot for energyRequired s).
    const spoilSeconds = def.kind === "spoiling" ? (def.energyRequired ?? 0) : null;
    const spoil =
      spoilSeconds != null
        ? (() => {
            const input = def.ingredients[0]?.name;
            const stackSize = (input && refs.getItem(input)?.stackSize) || null;
            const buffer = rr.rate * spoilSeconds;
            return {
              seconds: spoilSeconds,
              buffer, // items resident mid-spoil at steady state
              stackSize,
              stacks: stackSize ? buffer / stackSize : null,
            };
          })()
        : null;

    // Reactor rows (#94): surface the assumed layout + the multiplier it yields,
    // so the row chip can show the math ("2×2 → ×3 heat") and offer the picker.
    const reactor =
      chosen?.kind === "reactor"
        ? (() => {
            const layout = data.reactorLayouts?.[rr.recipe] ?? REACTOR_LAYOUT_DEFAULT;
            const neighbourBonus = chosen.neighbourBonus ?? 1;
            return {
              layout,
              neighbourBonus,
              multiplier: reactorHeatMultiplier(neighbourBonus, layout),
            };
          })()
        : null;

    return {
      recipe: rr.recipe,
      display: def.display ?? rr.recipe,
      rate: rr.rate,
      spoil,
      reactor,
      machine: chosen && {
        name: chosen.name,
        display: chosen.display,
        energySource: chosen.energySource,
        count,
        powerW,
        craftingSpeed: chosen.craftingSpeed,
        tileWidth: chosen.tileWidth,
        tileHeight: chosen.tileHeight,
        moduleSlots: chosen.moduleSlots,
      },
      fuel,
      modules: machineModules,
      turdModules: turdModules.map((m) => ({ name: m.name, display: m.display })),
      beacons: beaconCfgs,
      beaconPowerW,
      effects: { speed: fx.speedBonus, productivity: fx.prodBonus, consumption: fx.consBonus },
      ingredients: def.ingredients.map((c) => {
        const fluid = c.kind === "fluid" ? refs.getFluid(c.name) : null;
        const acceptedMin = c.minTemp ?? fluid?.defaultTemperature ?? null;
        const selectedTemperature = data.fluidTemperatures?.[rr.recipe]?.[c.name] ?? null;
        const producedTemperatures = fluidTemperatureOptions.get(c.name) ?? [];
        return {
          name: c.name,
          kind: c.kind,
          display: c.display,
          rate: c.amount * rr.rate,
          // planned exact temperature, or the effective accepted range. An
          // unspecified Factorio ingredient starts at the fluid default.
          temp:
            c.kind === "fluid"
              ? selectedTemperature == null
                ? fmtTempRange(acceptedMin, c.maxTemp)
                : fmtTemp(selectedTemperature)
              : null,
          ...(c.kind === "fluid"
            ? {
                acceptedTemperature: fmtTempRange(acceptedMin, c.maxTemp),
                selectedTemperature,
                favoriteTemperature: favoriteFluidTemperatures[c.name] ?? null,
                hasTemperatureVariants: producedTemperatures.length > 1,
                temperatureOptions: producedTemperatures.filter(
                  (temperature) =>
                    (acceptedMin == null || temperature >= acceptedMin) &&
                    (c.maxTemp == null || temperature <= c.maxTemp),
                ),
              }
            : {}),
        };
      }),
      // product rates from the productivity-scaled defs (the real output)
      products: def.products.map((c, i) => {
        const fluid = c.kind === "fluid" ? refs.getFluid(c.name) : null;
        const producedTemperature = c.temperature ?? fluid?.defaultTemperature ?? null;
        const averageAmount =
          c.amount ??
          (c.amountMin != null && c.amountMax != null ? (c.amountMin + c.amountMax) / 2 : 0);
        const scaledAmount = scaled.products[i]?.amount ?? 0;
        const amountScale = averageAmount !== 0 ? scaledAmount / averageAmount : 1;
        const flowScale = amountScale * (c.probability ?? 1) * rr.rate;
        const powerRange =
          c.name === ELECTRICITY && c.amountMin != null && c.amountMax != null
            ? { rateMin: c.amountMin * flowScale, rateMax: c.amountMax * flowScale }
            : {};
        return {
          name: c.name,
          kind: c.kind,
          display: c.display,
          rate: scaledAmount * (c.probability ?? 1) * rr.rate,
          ...powerRange,
          // A product without an explicit temperature is emitted at its fluid
          // prototype's default. Show it only when this fluid has real variants.
          temp:
            c.kind === "fluid" && (fluidTemperatureOptions.get(c.name)?.length ?? 0) > 1
              ? fmtTemp(producedTemperature)
              : null,
        };
      }),
    };
  });
  const power = {
    totalW: totalPowerW,
    pollutionPerMin: totalPollutionPerMin,
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
  // Estimated incidental spoil results join ordinary byproducts. They are not
  // goals, so factory-wide balancing can pool/report their current rate but can
  // never scale this block merely to satisfy demand for the spoiled result.
  const incidentalSpoilage = Object.entries(data.spoilRates ?? {}).flatMap(([source, rate]) => {
    if (!(rate > 0)) return [];
    const item = refs.getItem(source);
    if (!item?.spoilResult) return [];
    const cur = flowNet.get(item.spoilResult) ?? { kind: "item", net: 0 };
    cur.net += rate; // Factorio item spoil_result is a 1:1 conversion.
    flowNet.set(item.spoilResult, cur);
    return [
      {
        source,
        result: item.spoilResult,
        rate,
      },
    ];
  });
  // Fold electric draw into the balance as electricity consumption (1 unit =
  // 1 MJ → rate/s = MW). Generating recipes in-block produce it through the
  // solver; any shortfall shows as an "Electricity" import you can click to
  // add a generator recipe. Same netting rule as fuel: no auto-spawning.
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
  // Raw LP flows carry the temperature identity. Post-solve accounting can add
  // ordinary fuel, burnt-result, spoilage, and electricity flows or partially
  // net an LP flow away. Preserve qualifiers on the surviving LP portion, then
  // qualify only the genuinely additional remainder.
  const reconcileQualified = (
    flows: { name: string; kind: string; rate: number }[],
    qualified: QualifiedResultFlow[],
    direction: "import" | "export",
  ): QualifiedResultFlow[] =>
    mergeQualified(
      flows.flatMap((flow) => {
        const sources = qualified.filter((candidate) => candidate.name === flow.name);
        const total = sources.reduce((sum, candidate) => sum + candidate.rate, 0);
        if (total <= EPS) return qualifyFlows([flow], direction);
        const retained = Math.min(flow.rate, total);
        const distributed = sources.map((source) => ({
          ...source,
          rate: (retained * source.rate) / total,
        }));
        return flow.rate > retained + EPS
          ? [...distributed, ...qualifyFlows([{ ...flow, rate: flow.rate - retained }], direction)]
          : distributed;
      }),
    );
  const qualifiedImports = reconcileQualified(imports, qualifiedRawImports, "import");
  const qualifiedExports = reconcileQualified(exports, qualifiedRawExports, "export");
  // Keep incidental spoilage as a canonical byproduct for factory balancing and
  // persistence. When its result is also a positive goal, however, presenting it
  // again under Exports duplicates that goal. The editor and in-game summary use
  // this folded view while boundaryFlows continues to use the canonical exports.
  const positiveGoalNames = new Set(
    data.goals
      .filter((goal) => goal.direction !== "consume" && goal.rate > 0)
      .map((goal) => goal.name),
  );
  const incidentalGoalRates = new Map<string, number>();
  for (const spoilage of incidentalSpoilage) {
    if (!positiveGoalNames.has(spoilage.result)) continue;
    incidentalGoalRates.set(
      spoilage.result,
      (incidentalGoalRates.get(spoilage.result) ?? 0) + spoilage.rate,
    );
  }
  const displayExports = exports.flatMap((flow) => {
    const rate = flow.rate - (incidentalGoalRates.get(flow.name) ?? 0);
    return rate > EPS ? [{ ...flow, rate }] : [];
  });
  // A negative goal is itself the block's visible consume/import contract. Keep
  // the canonical import in `imports` for factory projections and flow math,
  // but do not repeat the same good in the editor's Imports list.
  const negativeGoalNames = new Set(
    data.goals
      .filter((goal) => goal.direction === "consume" || goal.rate < 0)
      .map((goal) => goal.name),
  );
  const displayImports = imports
    .filter((flow) => !negativeGoalNames.has(flow.name))
    .sort((a, b) => {
      if (a.name === ELECTRICITY) return -1;
      if (b.name === ELECTRICITY) return 1;
      return b.rate - a.rate || byNameAsc(a, b);
    });
  const boundaryTemp = (flow: QualifiedResultFlow) => {
    if (flow.kind !== "fluid" || (fluidTemperatureOptions.get(flow.name)?.length ?? 0) <= 1)
      return null;
    return flow.temperatureMode === "exact"
      ? fmtTemp(flow.minTemp)
      : flow.temperatureMode === "range"
        ? fmtTempRange(flow.minTemp, flow.maxTemp)
        : null;
  };
  const qualifiedDisplayImports = qualifiedImports
    .filter((flow) => !negativeGoalNames.has(flow.name))
    .map((flow) => ({ ...flow, temp: boundaryTemp(flow) }))
    .sort((a, b) => b.rate - a.rate || byNameAsc(a, b));
  const qualifiedDisplayExports = qualifiedExports.map((flow) => ({
    ...flow,
    temp: boundaryTemp(flow),
  }));
  const fuelItems = [...fuelTotals.keys()]; // for the 🔥 tag in the UI
  const burntItems = [...burntTotals.keys()]; // ash / depleted cells from burning

  // Imports of a good some enabled recipe IN THIS BLOCK produces — the
  // tell-tale of a plan importing instead of making (a free byproduct + a
  // reprocessing recipe lets the LP import the byproduct and idle the real
  // producers). The chip offers one click to mark the good made.
  const inBlockProducerGoods = new Set(
    compose.parentDefs.flatMap((d) =>
      d.products.flatMap((p) => (p.amount > 0 ? [fold.bare(p.name)] : [])),
    ),
  );
  const importedProducible = imports
    .map((f) => f.name)
    .filter((n) => inBlockProducerGoods.has(n) && !n.startsWith("pyops-"));

  // Which imports are craftable in-block (a recipe exists to make them) vs. true
  // raws (nothing produces them — you must supply them). Drives the import tint.
  const producible = imports
    .filter((f) => refs.recipesProducing(f.name).length > 0)
    .map((f) => f.name);

  // Surface incompatible enabled producer→consumer routes. Temperature identity
  // prevents these pairs from balancing each other now, so the producer will
  // idle or export unless another consumer accepts its output. The warning helps
  // explain that outcome when several temperatures of one fluid share a block.
  const fluidProducers = new Map<string, { recipe: string; temp: number }[]>();
  for (const r of fetched)
    for (const p of r.products)
      if (p.kind === "fluid" && p.temperature != null) {
        const list = fluidProducers.get(p.name) ?? [];
        list.push({ recipe: r.name, temp: p.temperature });
        fluidProducers.set(p.name, list);
      }
  const tempWarnings: {
    producer: string; // recipe making the out-of-range temperature
    consumer: string; // recipe whose ingredient can't accept it
    item: string; // the fluid
    temp: number; // the producer's output temperature
    needs: string; // the consumer's accepted range, formatted
    /** true when ANOTHER in-block producer does satisfy the range — the silent
     * partial mismatch the old block-level check missed entirely */
    partial: boolean;
  }[] = [];
  for (const r of fetched) {
    for (const c of r.ingredients) {
      if (c.kind !== "fluid" || (c.minTemp == null && c.maxTemp == null)) continue;
      const producers = fluidProducers.get(c.name);
      if (!producers?.length) continue; // imported — temperature is the player's problem
      const lo = c.minTemp ?? -Infinity;
      const hi = c.maxTemp ?? Infinity;
      const anyOk = producers.some((p) => p.temp >= lo && p.temp <= hi);
      const seen = new Set<string>(); // a recipe can emit the same fluid+temp more than once
      for (const p of producers) {
        if (p.temp >= lo && p.temp <= hi) continue;
        const key = `${p.recipe}@${p.temp}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tempWarnings.push({
          producer: p.recipe,
          consumer: r.name,
          item: c.name,
          temp: p.temp,
          needs: fmtTempRange(c.minTemp, c.maxTemp)!,
          partial: anyOk,
        });
      }
    }
  }

  // Display-name maps for the result — recipes and goods are SEPARATE namespaces
  // (#113). Py routinely names a recipe after its main product (recipe `coal-gas`
  // "Coal gas from coal" vs fluid `coal-gas` "Coal gas"), so one flat map would
  // let whichever wrote last clobber the other; recipe rows then rendered the
  // good's label. `display` holds goods (items/fluids), `recipeDisplay` recipes.
  const display: Record<string, string> = {};
  const recipeDisplay: Record<string, string> = {};
  for (const r of fetched) if (r.display) recipeDisplay[r.name] = r.display;
  // Disabled recipes (#73) aren't in the solve, but their rows still render — map
  // their display names too so the UI never falls back to the raw recipe id.
  for (const name of disabled) {
    const d = refs.getRecipe(name)?.display;
    if (d) recipeDisplay[name] = d;
  }
  const itemDisp = (name: string) =>
    refs.getItem(name)?.display ?? refs.getFluid(name)?.display ?? null;
  for (const name of [
    ...goalNames(data),
    ...imports.map((f) => f.name),
    ...exports.map((f) => f.name),
    // made marks + diagnosis items may not appear in the flows — map them so
    // link chips and IIS cards always show localized names
    ...made,
    ...(result.unmade ?? []),
    ...diagnosis.flatMap((c) => c.members.flatMap((m) => ("item" in m.prov ? [m.prov.item] : []))),
    // internally-linked fluids named by a temperature warning aren't in the
    // flows above — map them too so the warning text shows localized names
    ...tempWarnings.map((w) => w.item),
    // #76: a composed module's contract goods (some fully consumed inside, so
    // absent from the parent flows) need labels for the sub-block header
    ...compose.subs.flatMap((s) => [...s.imports, ...s.exports].map((f) => f.name)),
  ]) {
    const d = itemDisp(name);
    if (d) display[name] = d;
  }
  // the fluid-fuel pool's fluids row only exists after a data re-sync — keep the
  // label readable on older imports
  display[FLUID_FUEL] ??= "Fluid fuel (MJ)";
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
  const buildCost = refs.buildCost([...buildingCounts].map(([name, count]) => ({ name, count })));

  // #76: per composed sub-block, its solve status and boundary contract — the
  // group header renders the module face (contract + an infeasible badge). The
  // member rows themselves are already in `rows` at their effective rate.
  const subBlocks = compose.subs.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    ...(s.message ? { message: s.message } : {}),
    machineSeconds: s.machineSeconds,
    imports: s.imports,
    exports: s.exports,
    unmade: s.unmade,
  }));

  const goalTemperatureChoices = Object.fromEntries(
    targets.flatMap((goal) => {
      const fluid = refs.getFluid(goal.name);
      const options = fluidTemperatureOptions.get(goal.name) ?? [];
      if (!fluid || options.length <= 1) return [];
      const selected = goals.find((candidate) => candidate.name === goal.name)?.temperature ?? null;
      return [
        [
          goal.name,
          {
            acceptedTemperature: fmtTempRange(fluid.defaultTemperature, null)!,
            selectedTemperature: selected,
            favoriteTemperature: favoriteFluidTemperatures[goal.name] ?? null,
            temperatureOptions: options,
          },
        ] as const,
      ];
    }),
  );

  return {
    ...result,
    imports,
    qualifiedImports,
    displayImports,
    qualifiedDisplayImports,
    exports,
    qualifiedExports,
    displayExports,
    qualifiedDisplayExports,
    rows,
    subBlocks,
    display,
    recipeDisplay,
    producible,
    // imports the block could be making itself (see above) — chip warning + fix
    importedProducible,
    // the block's effective made set (explicit or migrated) — the editor
    // hydrates this into legacy docs so the next save persists it
    made,
    // temperature qualifier per unmade item (#110): "water" unmade at "≤101°"
    unmadeTemp,
    // goals whose rate a count pin superseded (#121) — the soft supply-push note
    goalSuperseded,
    diagnosis,
    power,
    fuelItems,
    burntItems,
    tempWarnings,
    incidentalSpoilage,
    buildCost,
    goalTemperatureChoices,
    broken,
    missing,
    // module-suggestion hints are a per-project preference (Settings). The
    // editor resolves suggestion rows lazily; this gates the ambient icon.
    moduleHints,
  };
}

/** Keep the editor transport focused on data needed for its first paint. Machine
 * and fuel picker choices are reference-data catalogs, not solve output; sending
 * them on every row makes large mall blocks grow by hundreds of kilobytes. The
 * raw LP recipe list is likewise an internal intermediate duplicated by `rows`. */
export function editorBlockResult(result: Awaited<ReturnType<typeof computeBlock>>) {
  const { recipes: _recipes, ...editor } = result;
  return editor;
}

/** Compute module auto-fill hints from an already-solved block.
 *
 * This deliberately does not invoke the LP solver. Module eligibility and
 * research availability are relatively expensive SQLite/reference-data work,
 * but they are presentation hints rather than inputs to the solve (only the
 * modules stored in the document affect production). Keeping this as a second,
 * lazy editor request lets the authoritative solve + save finish first while
 * still deriving suggestions from its exact recipe rates.
 */
export function computeModuleSuggestions(
  rawData: SolveInput,
  solvedRows: { recipe: string; rate: number; machine: string | null }[],
): Record<string, string[]> {
  const data = normalizeBlockData(rawData) as SolveInput;
  if (!solvedRows.length) return {};

  const refs = q.createBlockSolveContext(data.recipes);
  const settings = q.metaAll();
  const fillMiners = settings.autofill_miners === "1";
  const recipes = new Map(
    data.recipes
      .map((name) => refs.getRecipe(name))
      .filter((r): r is NonNullable<ReturnType<typeof q.getRecipe>> => !!r)
      .map((r) => [r.name, r]),
  );
  const candidates = [...recipes.values()].filter((r) => fillMiners || r.kind !== "mining");
  if (!candidates.length) return {};

  // One module-table scan and one research-availability pass for the whole
  // block. Creative/editor modules have no producer and therefore stay out.
  const placeable = q.placeableModules();
  const available = refs.unlockedItems(placeable.map((m) => m.name));
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
  const researchProd = refs.productivityBonuses();
  const activeTurd = q.activeTurdModules();
  const turdFor = (machine: { name: string; allowedModuleCategories: string[] | null }) =>
    activeTurd.filter((mod) => {
      if (!machine.allowedModuleCategories?.includes(mod.category ?? "")) return false;
      const tier = /-mk0(\d)$/.exec(mod.name);
      return !tier || machine.name.endsWith(`-mk0${tier[1]}`);
    });

  const out: Record<string, string[]> = {};
  for (const row of solvedRows) {
    const recipe = recipes.get(row.recipe);
    if (!recipe || (!fillMiners && recipe.kind === "mining")) continue;
    const chosen = refs.machinesForRecipe(recipe.name).find((m) => m.name === row.machine);
    if (!chosen || chosen.moduleSlots <= 0) continue;

    const fits = q.modulePlacementFilter(chosen, recipe);
    const pool = placeable.filter((m) => available.has(m.name) && fits(m));
    if (!pool.length) continue;

    const beaconCfgs = (data.beacons?.[recipe.name] ?? []).filter(
      (b) => beaconDb.has(b.beacon) && b.count > 0,
    );
    const turdModules = turdFor(chosen);
    const bare = computeEffects(
      recipe.allowProductivity,
      [],
      beaconCfgs,
      moduleDb,
      beaconDb,
      turdModules,
      {
        recipeProd: researchProd.recipes.get(recipe.name) ?? 0,
        miningProd: recipe.kind === "mining" ? researchProd.mining : 0,
        maxProductivity: recipe.maximumProductivity,
      },
    );
    // recipe rate × craft time = machine-seconds/sec at 1× speed. Divide by
    // the module-less machine speed so beacon/TURD effects remain represented.
    const baseCount =
      (row.rate * (recipe.energyRequired ?? 0.5)) / ((chosen.craftingSpeed ?? 1) * bare.speedMult);
    const fill = pickAutoModules({
      slots: chosen.moduleSlots,
      allowProductivity: recipe.allowProductivity,
      pool,
      baseCount,
      baseSpeedMult: bare.speedMult,
    });
    const current = (data.modules?.[recipe.name] ?? [])
      .filter((name) => moduleDb.has(name))
      .slice(0, chosen.moduleSlots);
    if (fill.length && [...fill].sort().join("\u0001") !== [...current].sort().join("\u0001"))
      out[recipe.name] = fill;
  }
  return out;
}

/** Persist a block's input doc + refresh its cached flows/machines/power. When the
 * solve is `broken` (a referenced recipe/good vanished) the last-good cache is KEPT
 * (null = leave untouched) so the factory aggregates stay correct and re-enabling
 * the mod restores the block; the input + per-block reference fingerprint are still
 * written. Shared by every save path so they all degrade the same way. */
export async function persistBlock(
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
      pollutionPerMin: r.broken ? null : r.power.pollutionPerMin,
      // leave the stored status untouched on a broken solve (cache preserved)
      solveStatus: r.broken ? undefined : r.status,
      // cache the WHY alongside an infeasible status (#91); solved clears it
      solveDiagnosis: r.broken ? undefined : r.status === "infeasible" ? (r.diagnosis ?? []) : null,
      // A broken solve preserves the previous flows/machines, so it must also
      // preserve their old generation stamp. Marking last-good projections as
      // current would make SQLite claim older-context values are valid.
      dataFingerprint: r.broken ? undefined : q.blockReferenceFingerprint(data),
    },
    r.broken ? null : [...boundaryFlows(goalFlows(data), r)],
    r.broken ? null : machineReqs(r.rows),
  );
}

/** A block row's `updatedAt` as epoch seconds (the editor's hydration point). */
export function blockUpdatedAt(id: number): number | null {
  const row = q.getBlock(id);
  return row?.updatedAt ? Math.floor(row.updatedAt.getTime() / 1000) : null;
}

/** Multi-tab / undo staleness guard (#90): when the stored block row is NEWER
 * than `baseUpdatedAt` (the row the editor hydrated from, epoch seconds), the
 * save must be rejected — a stale editor (second tab, or one that idled through
 * an undo/external write) would otherwise clobber the newer state wholesale.
 * Returns the conflict payload to send back, or null when the save may proceed. */
export function blockSaveConflict(
  id: number,
  baseUpdatedAt: number,
): { conflict: true; id: number; name: string; updatedAt: number } | null {
  const cur = q.getBlock(id);
  const curAt = cur?.updatedAt ? Math.floor(cur.updatedAt.getTime() / 1000) : null;
  if (cur && curAt != null && curAt > baseUpdatedAt)
    return { conflict: true, id: cur.id, name: cur.name, updatedAt: curAt };
  return null;
}

/** Push a block's solved summary to the game so the mod can render an in-game
 * build sheet (Helmod-style): the buildings + counts (each clickable for a
 * configured blueprint), plus inputs/outputs and power. Fire-and-forget; returns
 * whether a peer was reachable. */
/** Solve a saved block and push it to the in-game Helmod-style summary panel,
 * including the per-good belts/inserters + top-level logistics descriptor. Shared
 * by the web "show in game" button (`bridgeShowBlockFn`) and the `gameShowBlock`
 * MCP dev tool, so both exercise the exact same payload path. */
export async function showBlockInGame(id: number) {
  const row = q.getBlock(id);
  if (!row) return { sent: false as const, name: null };
  const input = normalizeBlockData(row.data as SolveInput) as SolveInput;
  const r = await computeBlock(input);

  // Energy pseudo-goods are shown as the power/heat lines, not as I/O rows
  // (they aren't real prototypes, so an in-game icon tag wouldn't resolve).
  const PSEUDO = new Set([HEAT, "pyops-electricity", FLUID_FUEL]);
  // Logistics for the in-game summary's Helmod-style belt/inserter readout: belts
  // to carry each item, and inserters/loaders to feed one building (recipe rows
  // only). Sized against the same picks as the web Logistics control.
  const ctx = q.logisticsContext();
  const logi = resolveLogistics(ctx);
  const moverName = logi.moverKind === "loader" ? logi.loader?.name : logi.inserter?.name;
  const logistics = logi.belt
    ? { belt: logi.belt.name, mover: moverName ?? null, moverKind: logi.moverKind }
    : null;
  // The web Logistics control's picks (belt tier, inserter vs loader, stacking)
  // size the counts, but its SHOW toggles do not gate them: the in-game panel
  // has its own toggle button, and slaving the payload to the web display prefs
  // made that button dead until belts were also switched on in the web (the
  // prefs default off, so out of the box the toggle rendered nothing).
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
    base.belts = rl.belts;
    if (machineCount > 0) base.inserters = rl.devices;
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
      // The pooled fluid-fuel draw (#25) is a pseudo-good, not a prototype — its
      // real fluid flows through the block's burn-fluid-* conversion instead.
      if (row.fuel && !row.fuel.pool) {
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
  const outputs = [...goalFlows(input).filter((g) => g.rate > 0), ...r.displayExports]
    .filter((f) => !PSEUDO.has(f.name))
    .map(boundary);
  const inputs = r.imports.filter((f) => !PSEUDO.has(f.name)).map(boundary);

  ensureBridge();
  return {
    sent: sendToPeer({
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
  ensureBridge();
  return { sent: sendToPeer({ type: "cmd.hide_block", payload: {} }) };
}

/** Re-solve stale saved blocks and refresh their cached flows — used after a
 * global change (TURD selection, research, data sync). Returns how many were re-solved.
 * A system cache refresh, not a user edit: it runs with undo tracking OFF so
 * the wholesale block-row rewrites never land on the undo stack (#90). */
export async function resolveAllBlocks() {
  return withUndoAction(
    "resolve all blocks",
    async () => {
      const refreshAll = solveProjectionVersionNeedsRefresh();
      const all = q.listBlocks();
      const generation = currentSolveGeneration();
      const stale = all.filter((block) => (refreshAll || block.stale) && !block.broken);
      for (const b of stale) {
        const row = q.getBlock(b.id);
        if (!row) continue;
        const data = row.data as SolveInput;
        const r = await computeBlock(data);
        // broken blocks keep their last-good cache (persistBlock passes null flows)
        await persistBlock(
          { id: b.id, name: row.name, iconKind: row.iconKind, iconName: row.iconName },
          data,
          r,
        );
      }
      markSolveGenerationResolved(generation);
      return stale.length;
    },
    { undo: false },
  );
}

/** Cheap crash/upgrade recovery guard for projection readers. */
export async function ensureSolvedProjections(): Promise<number> {
  return solveGenerationNeedsRefresh() ? resolveAllBlocks() : 0;
}
