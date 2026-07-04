/**
 * Block computation core — server-only (import protection keeps it out of any
 * client bundle). The solve → machines/fuel/power pipeline (`computeBlock`),
 * block persistence with cached flows (`persistBlock`), the in-game summary
 * push (`showBlockInGame`/`hideBlockInGame`), and the bulk re-solve
 * (`resolveAllBlocks`). Extracted from factorio.ts so the server-fn layer
 * stays client-importable while this module imports the query layer statically.
 */
import type { RecipeDef } from "../solver/lp";
import type { Disposition } from "../solver/migrate";
import { expandTemps } from "../solver/temps";
import { solveBlockLp, type LpBlockInput, type Pin } from "../solver/lp";
import {
  composeSubBlocks,
  isSyntheticSubName,
  type ComposedGroup,
  type SubBlockSolve,
} from "../solver/subblock";
import { diagnoseBlock, type DiagnosisCard } from "../solver/diagnose";
import { migrateToLpInput } from "../solver/migrate";

/** A pin as stored in the block doc (#91): counts are in BUILDINGS (what the
 * user sees on the row); the solve converts to executions/sec via the row's
 * per-building craft rate, so module/beacon changes re-derive the rate. */
export type DocPin =
  | { kind: "count" | "cap"; recipe: string; count: number }
  | { kind: "share"; recipe: string; item: string; share: number; base?: "total" | "remaining" };
import { computeEffects, type BeaconConfig } from "./effects";
import { resolveLogistics, rowLogistics } from "../lib/logistics";
import { prodScaledAmount } from "../lib/productivity";
import { reactorHeatMultiplier, REACTOR_LAYOUT_DEFAULT, type ReactorLayout } from "../lib/reactor";
import { goalNames, normalizeBlockData } from "../lib/goals";
import { fmtTemp, fmtTempRange } from "../lib/format";
import type { Goal } from "../db/schema.ts";
import * as q from "../db/queries.server.ts";
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
function targetBoundaryFlow(item: string, kind: string, rate: number, stock?: boolean) {
  return rate >= 0
    ? { item, kind, role: stock ? "stock" : "primary", rate }
    : { item, kind, role: "import", rate: -rate };
}

/** The full cached boundary-flow list for a solved block: the goals (each a primary
 * output sized to its rate), the surplus byproducts, and the imports. Centralized so
 * every save path emits the same shape. The solver excludes goals from its own
 * exports, so they never double-count here. */
export function boundaryFlows(
  goals: { name: string; kind: string; rate: number; stock?: boolean }[],
  r: {
    exports: { name: string; kind: string; rate: number }[];
    imports: { name: string; kind: string; rate: number }[];
  },
) {
  return [
    ...goals.map((g) => targetBoundaryFlow(g.name, g.kind, g.rate, g.stock)),
    ...r.exports.map((f) => ({ item: f.name, kind: f.kind, role: "byproduct", rate: f.rate })),
    ...r.imports.map((f) => ({ item: f.name, kind: f.kind, role: "import", rate: f.rate })),
  ];
}

/** Resolve a block's goals to `{ name, kind, rate }` for the boundary cache (the
 * good's kind is needed so the flow icons correctly). */
export function goalFlows(
  data: SolveInput,
): { name: string; kind: string; rate: number; stock?: boolean }[] {
  return data.goals.map((g) => ({
    name: g.name,
    kind: q.getFluid(g.name) ? "fluid" : "item",
    rate: g.rate,
    stock: g.stock != null,
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
  spoilRates?: Record<string, number>; // item → planned rot rate /s (#20), extra pinned surplus
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
  /** whole-machine mode (#98): every row's building count is an integer the
   * solve commits to (machines may idle); rates stay exact. */
  wholeMachines?: boolean;
  machines?: Record<string, string>; // recipe → chosen machine (else fastest)
  fuels?: Record<string, string>; // recipe → chosen fuel (else cheapest available)
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
    : data.recipes
        .filter((name) => !disabled.has(name))
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
  // Research-driven productivity (#92): mining-productivity levels + Factorio
  // 2.0 change-recipe-productivity techs, gated by the research horizon exactly
  // like machine availability (everything in FUTURE, reached techs otherwise).
  const researchProd = q.productivityBonuses();

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
    } else if (chosen.energySource === "burner") {
      const all = q.fuelsForCategories(chosen.fuelCategories);
      const pick = all.find((f) => f.name === data.fuels?.[r.name]) ?? defaultFuel(all);
      if (pick?.fuelValueJ) {
        const perSec = (chosen.energyUsageW ?? 0) / pick.fuelValueJ;
        effectivityEconomy = perSec * Math.max(0, q.goodCosts([pick.name]).get(pick.name) ?? 0);
      }
    } else if (chosen.energySource === "fluid") {
      const f = fluidFueling(chosen);
      const pick = f.mode === "pinned" ? q.fluidFuelEntry(f.fluid) : null;
      if (f.mode === "pool") {
        // MJ/s drawn from the pool, at the pool's LP price per MJ
        effectivityEconomy =
          ((chosen.energyUsageW ?? 0) / 1e6) *
          Math.max(0, q.goodCosts([FLUID_FUEL]).get(FLUID_FUEL) ?? 0);
      } else if (pick?.fuelValueJ) {
        const perSec = (chosen.energyUsageW ?? 0) / pick.fuelValueJ;
        effectivityEconomy = perSec * Math.max(0, q.goodCosts([pick.name]).get(pick.name) ?? 0);
      } else if (f.mode === "temperature" && f.perSec == null && f.energyJ && chosen.energyUsageW) {
        // #114: only ENERGY-FOLLOWING drains benefit from consumption modules;
        // fixed-rate ones (perSec set) consume the same regardless
        const perSec = chosen.energyUsageW / f.energyJ;
        effectivityEconomy = perSec * Math.max(0, q.goodCosts([f.fluid]).get(f.fluid) ?? 0);
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
        {
          recipeProd: researchProd.recipes.get(r.name) ?? 0,
          miningProd: r.kind === "mining" ? researchProd.mining : 0,
          maxProductivity: r.maximumProductivity,
        },
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
    // Applies to solid burners and PINNED fluid burners (a filtered powerplant
    // burning the gas the block makes); pooled fluid burners are handled below.
    const fueling = chosen?.energySource === "fluid" ? fluidFueling(chosen) : null;
    if ((chosen?.energySource === "burner" || fueling?.mode === "pinned") && chosen?.energyUsageW) {
      const pick =
        fueling?.mode === "pinned"
          ? q.fluidFuelEntry(fueling.fluid)
          : (() => {
              const all = q.fuelsForCategories(chosen.fuelCategories);
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
  // Planned spoil losses (#20): each entry pins EXTRA net production of the item
  // (surplus that rots away), on top of any goal it may also have. The rotted
  // surplus never reaches the boundary flows — the solver excludes pinned items
  // from exports — which is right: spoiled goods aren't available to other blocks.
  const spoilTargets = Object.entries(data.spoilRates ?? {}).filter(([, r]) => r > 0);
  const targets = spoilTargets.length
    ? (() => {
        const merged = new Map(data.goals.map((g) => [g.name, { ...g }]));
        for (const [name, r] of spoilTargets) {
          const g = merged.get(name);
          if (g) g.rate += r;
          else merged.set(name, { name, rate: r });
        }
        return [...merged.values()];
      })()
    : data.goals;
  // ── the solve (#91): v2 LP on the effect-adjusted defs ─────────────────────
  // Explicit doc state wins; a legacy doc (no `made`) derives it from its old
  // dispositions via the migration mapping the parity report validated. The
  // derived set is echoed back on the result so the editor persists it.
  const goals = targets.map((t) => ({ name: t.name, rate: t.rate }));
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
  for (const p of data.pins ?? []) {
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
  // whole-machine mode (#98): hand the LP each row's real per-building rate so
  // it can commit to integer counts
  const machineRates = data.wholeMachines
    ? Object.fromEntries(
        defs.flatMap((d) => {
          const per = craftRate(d.name);
          return per != null && per > 0 ? [[d.name, per]] : [];
        }),
      )
    : undefined;
  const defaultTemp = (f: string) => q.getFluid(f)?.defaultTemperature ?? null;
  // Sub-blocks v2 (#76): a COMPOSED group is solved as its own module and pulled
  // out of the parent solve, replaced by a synthetic recipe carrying only its
  // boundary contract (net imports → net exports). Member recipes, pins and
  // whole-machine rates route into their module; the parent solves normally over
  // its own recipes + these synthetics. Display-only groups (#7) are untouched.
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
    ? await composeSubBlocks({ defs, groups: composedGroups, pins, machineRates, defaultTemp })
    : {
        parentDefs: defs,
        parentPins: pins,
        parentMachineRates: machineRates,
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
    { goals, recipes: compose.parentDefs, made: parentMade, pins: compose.parentPins },
    defaultTemp,
  );
  const lpInput: LpBlockInput = {
    ...expandedInput,
    ...(compose.parentMachineRates ? { machineRates: compose.parentMachineRates } : {}),
  };
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
    // whole-machine mode (#98): the LP committed to an integer count (the row
    // may idle); otherwise the exact fractional requirement
    const count = result.wholeMachines?.[rr.recipe] ?? rr.machines1x / speed;
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
    let availableFuels: {
      name: string;
      display: string | null;
      kind: string;
      fuelValueJ: number | null;
      favorite: boolean;
    }[] = [];
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
        display: q.getFluid(fueling.fluid)?.display ?? null,
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
        // there's no per-row fuel pick (availableFuels stays empty)
        fuel = {
          name: FLUID_FUEL,
          display: q.getFluid(FLUID_FUEL)?.display ?? "Fluid fuel (MJ)",
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
          : q.fuelsForCategories(chosen.fuelCategories);
        // a fuel is the favorite when it's the stored pick for any of the machine's
        // fuel categories (solid fuels carry exactly one category); a pinned fluid
        // is forced by the machine, so favorites don't apply
        const favSet = new Set(
          chosen.fuelCategories.map((c) => favoriteFuels[c]).filter((n): n is string => !!n),
        );
        availableFuels = all.map((f) => ({
          name: f.name,
          display: f.display,
          kind: f.kind,
          fuelValueJ: f.fuelValueJ,
          favorite: !pinned && favSet.has(f.name),
        }));
        const pick = pinned
          ? all[0]
          : (all.find((f) => f.name === data.fuels?.[rr.recipe]) ?? defaultFuel(all));
        if (pick?.fuelValueJ) {
          const perSec = powerW / pick.fuelValueJ; // J/s ÷ J/unit = units/s (effectivity folded into energy_usage_w)
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
            const stackSize = (input && q.getItem(input)?.stackSize) || null;
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
        // accepted temperature range, for the chip label (fluids only)
        temp: c.kind === "fluid" ? fmtTempRange(c.minTemp, c.maxTemp) : null,
      })),
      // product rates from the productivity-scaled defs (the real output)
      products: def.products.map((c, i) => ({
        name: c.name,
        kind: c.kind,
        display: c.display,
        rate: (scaled.products[i]?.amount ?? 0) * (c.probability ?? 1) * rr.rate,
        // produced temperature, for the chip label (fluids only)
        temp: c.kind === "fluid" ? fmtTemp(c.temperature) : null,
      })),
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

  // Fluid temperature sanity (#110 interim): the solver links fluids by NAME,
  // pooling every temperature variant into one good, so a producer whose output
  // temperature falls outside a consumer's accepted range is silently blended in
  // (e.g. dt-he3's 3000° neutrons pooled into a 4000°-only MHD generator). Flag
  // every mismatched producer→consumer pair — per PRODUCER, so one in-range
  // producer can no longer mask another that's out of range (the old check
  // warned only when NO in-block temperature satisfied the range). The full
  // per-temperature identity model lands with the solver rewrite (#91).
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
          needs: fmtTempRange(c.minTemp, c.maxTemp) ?? "any°",
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
    const d = q.getRecipe(name)?.display;
    if (d) recipeDisplay[name] = d;
  }
  const itemDisp = (name: string) => q.getItem(name)?.display ?? q.getFluid(name)?.display ?? null;
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
  const buildCost = q.buildCost([...buildingCounts].map(([name, count]) => ({ name, count })));

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

  return {
    ...result,
    imports,
    exports,
    rows,
    subBlocks,
    display,
    recipeDisplay,
    producible,
    // the block's effective made set (explicit or migrated) — the editor
    // hydrates this into legacy docs so the next save persists it
    made,
    // temperature qualifier per unmade item (#110): "water" unmade at "≤101°"
    unmadeTemp,
    diagnosis,
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
      dataFingerprint: q.blockReferenceFingerprint(data),
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
  const outputs = [...goalFlows(input).filter((g) => g.rate > 0), ...r.exports]
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

/** Re-solve every saved block and refresh its cached flows — used after a
 * global change (TURD selection, research). Returns how many were re-solved.
 * A system cache refresh, not a user edit: it runs with undo tracking OFF so
 * the wholesale block-row rewrites never land on the undo stack (#90). */
export async function resolveAllBlocks() {
  return withUndoAction(
    "resolve all blocks",
    async () => {
      const all = q.listBlocks();
      for (const b of all) {
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
      return all.length;
    },
    { undo: false },
  );
}
