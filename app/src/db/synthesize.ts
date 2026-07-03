/**
 * Pass-2 importer: SYNTHETIC recipes for everything the game does without a
 * crafting recipe — run by importFactorioDump() right after pass 1.
 *
 *  - electricity as a pseudo-fluid (`pyops-electricity`, 1 unit = 1 MJ, so a
 *    rate of X/s reads as X MW) — generators/solar produce it, and computeBlock
 *    folds machine power draw into the balance as consumption of it
 *  - generating: one recipe per (generator × available input-fluid temperature),
 *    since turbine output depends on steam temp; burner generators become
 *    burner machines (fuel handled by the existing fuel system)
 *  - boiling: "per-MW" recipes (machine crafting_speed = its MW) so boilers of
 *    different sizes share one recipe per (output fluid, target temp)
 *  - mining: resource → products, drills as machines (modules work)
 *  - pumping: offshore pump → water
 *  - fluid fuel: `pyops-fluid-fuel` (1 unit = 1 MJ) — the fungible pool that
 *    unfiltered `burns_fluid` machines draw from, fed by one `burn-fluid-*`
 *    conversion recipe per fuel-valued fluid (#25)
 *  - spoiling: passive item → spoil_result conversions (no machine)
 *  - planting: seed → plant harvest in an agricultural tower (Factorio 2.0 /
 *    Space Age); tower crafting_speed = its (2·radius+1)²−1 parallel growth
 *    cells, recipe time = the plant's growth_ticks
 *  - launch: rocket parts + payload → the payload's rocket_launch_products,
 *    payload count scaled by rocket_lift_weight / item weight (capped by the
 *    rocket inventory), in the rocket silo
 *
 * All rows carry recipes.kind + source_entity so the UI can tell them apart.
 */
import type Database from "better-sqlite3";
import { temperatureFedDrain, type TempFedDrain } from "./fluid-energy.ts";

export const ELECTRICITY = "pyops-electricity";
export const HEAT = "pyops-heat";
/** The fungible fluid-fuel energy pool (#25), 1 unit = 1 MJ. Unfiltered
 * `burns_fluid` machines draw MJ from it; one `burn-fluid-*` conversion recipe
 * per fuel-valued fluid feeds it. */
export const FLUID_FUEL = "pyops-fluid-fuel";

type Raw = Record<string, Record<string, any>>;
type Ctx = {
  /** localized display for an entity/item/fluid name */
  display: (name: string) => string | null;
  parseSI: (s: unknown) => number | null;
};

const arr = <T = any>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

type NormResult = { kind: string; name: string; amount: number; probability: number };
/** Normalize a minable/recipe result list: `results` (object or legacy
 * `[name, amount]` form, `amount_min`/`amount_max` averaged) or the legacy
 * `result`/`count` pair. */
const normResults = (src: { results?: unknown; result?: string; count?: number }): NormResult[] => {
  if (src.results) {
    return arr<any>(src.results)
      .map((c) => ({
        kind: c.type ?? "item",
        name: c.name ?? c[0],
        amount:
          c.amount ?? (c.amount_min != null ? (c.amount_min + c.amount_max) / 2 : (c[1] ?? 1)),
        probability: c.probability ?? 1,
      }))
      .filter((c) => c.name);
  }
  if (src.result)
    return [{ kind: "item", name: src.result, amount: src.count ?? 1, probability: 1 }];
  return [];
};

export function synthesizePass2(db: Database.Database, raw: Raw, ctx: Ctx): Record<string, number> {
  const { display, parseSI } = ctx;

  const ins = {
    recipe: db.prepare(
      `INSERT OR REPLACE INTO recipes (name,display,kind,category,energy_required,enabled,hidden,allow_productivity,main_product,subgroup,"order",source_entity) VALUES (@name,@display,@kind,@category,@energy_required,1,0,@allow_productivity,@main_product,NULL,NULL,@source_entity)`,
    ),
    ing: db.prepare(
      `INSERT OR REPLACE INTO recipe_ingredients (recipe,idx,kind,name,amount,min_temp,max_temp) VALUES (?,?,?,?,?,?,?)`,
    ),
    prod: db.prepare(
      `INSERT OR REPLACE INTO recipe_products (recipe,idx,kind,name,amount,probability,temperature,ignored_by_productivity) VALUES (?,?,?,?,?,?,?,0)`,
    ),
    fluid: db.prepare(
      `INSERT OR IGNORE INTO fluids (name,display,default_temperature,heat_capacity_j) VALUES (?,?,NULL,NULL)`,
    ),
    machine: db.prepare(
      `INSERT OR REPLACE INTO crafting_machines (name,display,kind,crafting_speed,module_slots,energy_usage_w,energy_source,pollution_per_min,allowed_effects,allowed_module_categories,neighbour_bonus,burns_fluid,fluid_fuel_filter,fluid_fuel_per_sec,fluid_fuel_energy_j) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ),
    machineCat: db.prepare(
      `INSERT OR IGNORE INTO machine_categories (machine,category) VALUES (?,?)`,
    ),
    machineFuel: db.prepare(
      `INSERT OR IGNORE INTO machine_fuel_categories (machine,fuel_category) VALUES (?,?)`,
    ),
  };

  const fluidInfo = (name: string) =>
    db
      .prepare(
        `SELECT default_temperature dt, max_temperature mt, heat_capacity_j hc FROM fluids WHERE name = ?`,
      )
      .get(name) as { dt: number | null; mt: number | null; hc: number | null } | undefined;

  const counts = {
    mining: 0,
    pumping: 0,
    boiling: 0,
    generating: 0,
    burning: 0,
    spoiling: 0,
    planting: 0,
    launching: 0,
  };

  const recipe = (r: {
    name: string;
    display: string;
    kind: string;
    category: string | null;
    energy: number;
    source: string;
    ingredients?: {
      kind: string;
      name: string;
      amount: number;
      minTemp?: number | null;
      maxTemp?: number | null;
    }[];
    products?: {
      kind: string;
      name: string;
      amount: number;
      probability?: number | null;
      temperature?: number | null;
    }[];
    mainProduct?: string | null;
  }) => {
    ins.recipe.run({
      name: r.name,
      display: r.display,
      kind: r.kind,
      category: r.category,
      energy_required: r.energy,
      allow_productivity: r.kind === "mining" ? 1 : 0,
      main_product: r.mainProduct ?? r.products?.[0]?.name ?? null,
      source_entity: r.source,
    });
    (r.ingredients ?? []).forEach((c, i) =>
      ins.ing.run(r.name, i, c.kind, c.name, c.amount, c.minTemp ?? null, c.maxTemp ?? null),
    );
    (r.products ?? []).forEach((c, i) =>
      ins.prod.run(r.name, i, c.kind, c.name, c.amount, c.probability ?? 1, c.temperature ?? null),
    );
  };

  /** Register a synthetic machine (drill/boiler/generator/pump). */
  const machine = (m: {
    name: string;
    kind: string;
    speed: number;
    moduleSlots?: number;
    energyUsageW?: number | null;
    energySource?: string | null;
    fuelCategories?: string[];
    allowedModuleCategories?: string[] | null;
    category: string;
    pollutionPerMin?: number | null;
    /** reactors only (#94): extra heat per adjacent working reactor */
    neighbourBonus?: number | null;
    /** fluid energy sources (#25): fuel_value burner vs temperature-fed */
    burnsFluid?: number | null;
    /** fluid energy sources (#25): the fluid_box filter pinning the fuel */
    fluidFuelFilter?: string | null;
    /** temperature-fed sources (#114): fixed drain, units/s per machine */
    fluidFuelPerSec?: number | null;
    /** temperature-fed sources (#114): usable J per unit of the filter fluid */
    fluidFuelEnergyJ?: number | null;
  }) => {
    ins.machine.run(
      m.name,
      display(m.name),
      m.kind,
      m.speed,
      m.moduleSlots ?? 0,
      m.energyUsageW ?? null,
      m.energySource ?? null,
      m.pollutionPerMin ?? 0,
      null,
      m.allowedModuleCategories?.length ? JSON.stringify(m.allowedModuleCategories) : null,
      m.neighbourBonus ?? null,
      m.burnsFluid ?? null,
      m.fluidFuelFilter ?? null,
      m.fluidFuelPerSec ?? null,
      m.fluidFuelEnergyJ ?? null,
    );
    ins.machineCat.run(m.name, m.category);
    for (const fc of m.fuelCategories ?? []) ins.machineFuel.run(m.name, fc);
  };

  /** The #25 fluid-energy-source fields + effectivity for a raw `energy_source`.
   * Fuel drawn = energy / effectivity, so callers divide their usage by `eff`
   * (Py: oil-boiler-mk01 dumps effectivity 2; the mo-mine drill dumps 8). */
  const energySourceInfo = (es: any) => ({
    eff: es?.type === "burner" || es?.type === "fluid" ? (es.effectivity ?? 1) : 1,
    burnsFluid: es?.type === "fluid" ? (es.burns_fluid ? 1 : 0) : null,
    fluidFuelFilter: es?.type === "fluid" ? ((es.fluid_box?.filter as string) ?? null) : null,
  });

  /** Temperature-fed drain (#114) for a raw fluid `energy_source`, resolved
   * against the filter fluid already imported by pass 1 (Py's solar tower comes
   * through the boiler path here; the reactors/compost plants through pass 1).
   * `usageW` is the RAW prototype draw — the helper folds effectivity itself. */
  const tempFedDrain = (
    es: any,
    usageW: number | null,
  ): { fluidFuelPerSec: number | null; fluidFuelEnergyJ: number | null } => {
    let d: TempFedDrain = { perSec: null, energyJPerUnit: null };
    const filter = es?.type === "fluid" ? (es.fluid_box?.filter as string | undefined) : undefined;
    if (filter && !es.burns_fluid) {
      const fi = fluidInfo(filter);
      d = temperatureFedDrain(
        es,
        usageW,
        fi ? { defaultTemperature: fi.dt, maxTemperature: fi.mt, heatCapacityJ: fi.hc } : null,
      );
    }
    return { fluidFuelPerSec: d.perSec, fluidFuelEnergyJ: d.energyJPerUnit };
  };

  const tx = db.transaction(() => {
    /* ── electricity + heat + fluid-fuel pseudo-fluids ────────────────────── */
    ins.fluid.run(ELECTRICITY, "Electricity (MJ)");
    ins.fluid.run(HEAT, "Heat (MJ)");
    ins.fluid.run(FLUID_FUEL, "Fluid fuel (MJ)");

    /* ── mining: resource → products, drills as machines ─────────────────── */
    const drillsByCat = new Map<string, string[]>();
    for (const [name, d] of Object.entries(raw["mining-drill"] ?? {})) {
      const es = energySourceInfo(d.energy_source);
      const usage = parseSI(d.energy_usage);
      for (const rc of arr<string>(d.resource_categories)) {
        drillsByCat.set(rc, [...(drillsByCat.get(rc) ?? []), name]);
        machine({
          name,
          kind: "mining-drill",
          speed: d.mining_speed ?? 1,
          moduleSlots: d.module_slots ?? 0,
          // fuel draw = energy / effectivity (Py's mo-mine dumps effectivity 8)
          energyUsageW: usage != null ? usage / es.eff : null,
          energySource: d.energy_source?.type ?? null,
          fuelCategories: arr<string>(d.energy_source?.fuel_categories),
          allowedModuleCategories: arr<string>(d.allowed_module_categories),
          category: `mine:${rc}`,
          pollutionPerMin: d.energy_source?.emissions_per_minute?.pollution ?? 0,
          burnsFluid: es.burnsFluid,
          fluidFuelFilter: es.fluidFuelFilter,
          ...tempFedDrain(d.energy_source, usage),
        });
      }
    }
    for (const [name, res] of Object.entries(raw.resource ?? {})) {
      const minable = res.minable;
      if (!minable) continue;
      const cat = res.category ?? "basic-solid";
      if (!drillsByCat.has(cat)) continue; // nothing can mine it
      const results = normResults(minable);
      if (!results.length) continue;
      const ingredients = minable.required_fluid
        ? [
            {
              kind: "fluid",
              name: minable.required_fluid as string,
              amount: (minable.fluid_amount ?? 0) / 10,
            },
          ]
        : [];
      recipe({
        name: `mine-${name}`,
        display: `Mine ${display(name) ?? name}`,
        kind: "mining",
        category: `mine:${cat}`,
        energy: minable.mining_time ?? 1,
        source: name,
        ingredients,
        products: results,
      });
      counts.mining++;
    }

    /* ── pumping: offshore pumps → water ─────────────────────────────────── */
    for (const [name, p] of Object.entries(raw["offshore-pump"] ?? {})) {
      const perSec = (p.pumping_speed ?? 20) * 60;
      machine({ name, kind: "offshore-pump", speed: 1, category: `pump:${name}` });
      recipe({
        name: `pump-${name}`,
        display: `Pump water (${display(name) ?? name})`,
        kind: "pumping",
        category: `pump:${name}`,
        energy: 1,
        source: name,
        products: [{ kind: "fluid", name: "water", amount: perSec }],
      });
      counts.pumping++;
    }

    /* ── boiling: water/fluid → fluid @ target temp, per-MW recipes ──────── */
    // machine speed = its MW, so boilers of different sizes share one recipe
    for (const [name, b] of Object.entries(raw.boiler ?? {})) {
      const inFluid = b.fluid_box?.filter as string | undefined;
      const outFluid = (b.output_fluid_box?.filter as string | undefined) ?? inFluid;
      const target = b.target_temperature as number | undefined;
      const energyW = parseSI(b.energy_consumption);
      if (!inFluid || !outFluid || !target || !energyW) continue;
      const fi = fluidInfo(outFluid);
      const heatPerUnit = (target - (fi?.dt ?? 15)) * (fi?.hc ?? 200) || 0;
      if (heatPerUnit <= 0) continue;
      const perMW = 1e6 / heatPerUnit; // units/s boiled per MW of heat
      const src = b.energy_source ?? {};
      const eff = src.effectivity ?? 1;
      const esInfo = energySourceInfo(src);
      const cat = `boil:${outFluid}@${target}`;
      machine({
        name,
        kind: "boiler",
        speed: energyW / 1e6, // MW
        energyUsageW: src.type === "void" ? null : energyW / eff,
        energySource: src.type === "void" ? null : (src.type ?? null),
        fuelCategories: arr<string>(src.fuel_categories),
        category: cat,
        pollutionPerMin: src.emissions_per_minute?.pollution ?? 0,
        // Py's oil-boiler-mk01 is a pool fluid burner (burns_fluid, no filter,
        // effectivity 2); the solar tower is temperature-fed (burns_fluid absent,
        // fluid_usage_per_tick 1 → a fixed 60/s of solar-concentration, #114)
        burnsFluid: esInfo.burnsFluid,
        fluidFuelFilter: esInfo.fluidFuelFilter,
        ...tempFedDrain(src, energyW),
      });
      recipe({
        name: `boil-${outFluid}-${target}`,
        display: `Boil ${display(outFluid) ?? outFluid} (${target}°)`,
        kind: "boiling",
        category: cat,
        energy: 1,
        source: name,
        ingredients: [{ kind: "fluid", name: inFluid, amount: perMW }],
        products: [{ kind: "fluid", name: outFluid, amount: perMW, temperature: target }],
      });
      counts.boiling++;
    }

    /* ── generating: fluid @ temp → electricity, per generator × temp ────── */
    // temps a fluid is actually produced at (recipe products + boiler targets)
    const producedTemps = (fluid: string): number[] => {
      const rows = db
        .prepare(
          `SELECT DISTINCT temperature t FROM recipe_products WHERE name = ? AND temperature IS NOT NULL`,
        )
        .all(fluid) as { t: number }[];
      return rows.map((r) => r.t).sort((a, b) => a - b);
    };
    for (const [name, g] of Object.entries(raw.generator ?? {})) {
      const filter = g.fluid_box?.filter as string | undefined;
      if (!filter) continue;
      const fi = fluidInfo(filter);
      const usagePerSec = (g.fluid_usage_per_tick ?? 0) * 60;
      const eff = g.effectivity ?? 1;
      const maxT = g.maximum_temperature ?? Infinity;
      const minT = g.fluid_box?.minimum_temperature ?? -Infinity;
      if (!usagePerSec) continue;
      machine({ name, kind: "generator", speed: 1, category: `generate:${name}` });
      const temps = producedTemps(filter).filter((t) => t >= minT);
      for (const t of temps.length ? temps : []) {
        const energyPerUnit = (Math.min(t, maxT) - (fi?.dt ?? 15)) * (fi?.hc ?? 200);
        if (energyPerUnit <= 0) continue;
        const mw = (usagePerSec * energyPerUnit * eff) / 1e6;
        recipe({
          name: `generate-${name}-${t}`,
          display: `${display(name) ?? name} power (${t}°)`,
          kind: "generating",
          category: `generate:${name}`,
          energy: 1,
          source: name,
          ingredients: [
            { kind: "fluid", name: filter, amount: usagePerSec, minTemp: t, maxTemp: t },
          ],
          products: [{ kind: "fluid", name: ELECTRICITY, amount: mw }],
        });
        counts.generating++;
      }
    }
    // burner generators: fuel side is the machine's burner (existing fuel system)
    for (const [name, g] of Object.entries(raw["burner-generator"] ?? {})) {
      const maxP = parseSI(g.max_power_output);
      if (!maxP) continue;
      const eff = g.burner?.effectivity ?? 1;
      machine({
        name,
        kind: "generator",
        speed: 1,
        energyUsageW: maxP / eff,
        energySource: "burner",
        fuelCategories: arr<string>(g.burner?.fuel_categories),
        category: `generate:${name}`,
      });
      recipe({
        name: `generate-${name}`,
        display: `${display(name) ?? name} power`,
        kind: "generating",
        category: `generate:${name}`,
        energy: 1,
        source: name,
        products: [{ kind: "fluid", name: ELECTRICITY, amount: maxP / 1e6 }],
      });
      counts.generating++;
    }
    // solar: free power (peak production — derate for day/night yourself)
    for (const [name, s] of Object.entries(raw["solar-panel"] ?? {})) {
      const peak = parseSI(s.production);
      if (!peak) continue;
      machine({ name, kind: "generator", speed: 1, category: `generate:${name}` });
      recipe({
        name: `generate-${name}`,
        display: `${display(name) ?? name} power (peak)`,
        kind: "generating",
        category: `generate:${name}`,
        energy: 1,
        source: name,
        products: [{ kind: "fluid", name: ELECTRICITY, amount: peak / 1e6 }],
      });
      counts.generating++;
    }

    /* ── heat sources: reactors burn fuel → heat (pyops-heat), per-MW ────────
       Py hard-mode heat-powered machines consume pyops-heat; these reactors
       (py-burner, py-coal-powerplant, nuclear-reactor) are the local sources. */
    for (const [name, r] of Object.entries(raw.reactor ?? {})) {
      const consW = parseSI(r.consumption ?? r.max_energy_usage);
      const es = r.energy_source ?? {};
      if (!consW || es.type !== "burner") continue; // fuel-burning heat sources only
      const eff = es.effectivity ?? 1;
      machine({
        name,
        kind: "reactor",
        speed: 1,
        energyUsageW: consW / eff, // fuel draw (effectivity 5× on Py burners)
        energySource: "burner",
        fuelCategories: arr<string>(es.fuel_categories),
        category: `heat:${name}`,
        // extra heat per adjacent working reactor (#94) — engine default 1;
        // Py's nuclear-reactor dumps an explicit 1 (+100% per neighbour)
        neighbourBonus: typeof r.neighbour_bonus === "number" ? r.neighbour_bonus : 1,
      });
      recipe({
        name: `generate-heat-${name}`,
        display: `${display(name) ?? name} heat`,
        kind: "generating",
        category: `heat:${name}`,
        energy: 1,
        source: name,
        products: [{ kind: "fluid", name: HEAT, amount: consW / 1e6 }], // MW of heat
      });
      counts.generating++;
    }

    /* ── burning: item → burnt_result (in any burner; no machine of its own) ─ */
    const burnables = db
      .prepare(`SELECT name, display, burnt_result br FROM items WHERE burnt_result IS NOT NULL`)
      .all() as { name: string; display: string | null; br: string }[];
    for (const it of burnables) {
      recipe({
        name: `burn-${it.name}`,
        display: `${it.display ?? it.name} burns to`,
        kind: "burning",
        category: null,
        energy: 1,
        source: it.name,
        ingredients: [{ kind: "item", name: it.name, amount: 1 }],
        products: [{ kind: "item", name: it.br, amount: 1 }],
      });
      counts.burning++;
    }

    /* ── fluid fuel (#25): fluid → its fuel_value in pyops-fluid-fuel MJ ──────
       One conversion per fuel-valued fluid (59 in the Py dump, coal-gas 0.2 MJ
       up to kerosene/diesel 1.5 MJ). Unfiltered burns_fluid machines draw MJ
       from the pool as a solver-modeled ingredient; adding a Burn recipe to the
       block decides WHICH fluid fills the demand (splits/dispositions handle
       several, like any other multi-producer good). No machine of its own —
       the burn happens inside the consuming machine. Fluids never leave a
       burnt result (confirmed against the dump), so the conversion is pure. */
    const fuelFluids = db
      .prepare(`SELECT name, display, fuel_value_j fv FROM fluids WHERE fuel_value_j IS NOT NULL`)
      .all() as { name: string; display: string | null; fv: number }[];
    for (const f of fuelFluids) {
      recipe({
        name: `burn-fluid-${f.name}`,
        display: `Burn ${f.display ?? f.name}`,
        kind: "burning",
        category: null,
        energy: 1,
        source: f.name,
        ingredients: [{ kind: "fluid", name: f.name, amount: 1 }],
        products: [{ kind: "fluid", name: FLUID_FUEL, amount: f.fv / 1e6 }],
      });
      counts.burning++;
    }

    /* ── spoiling: passive item → spoil_result ───────────────────────────── */
    const spoilables = db
      .prepare(
        `SELECT name, display, spoil_result sr, spoil_ticks st FROM items WHERE spoil_result IS NOT NULL`,
      )
      .all() as { name: string; display: string | null; sr: string; st: number | null }[];
    for (const it of spoilables) {
      recipe({
        name: `spoil-${it.name}`,
        display: `${it.display ?? it.name} spoils`,
        kind: "spoiling",
        category: null, // no machine — happens on its own
        energy: (it.st ?? 3600) / 60,
        source: it.name,
        ingredients: [{ kind: "item", name: it.name, amount: 1 }],
        products: [{ kind: "item", name: it.sr, amount: 1 }],
      });
      counts.spoiling++;
    }

    /* ── planting: seed → plant harvest, agricultural towers as machines ─────
       An agricultural tower keeps (2·radius+1)²−1 growth-grid cells planted in
       parallel (the center cell is the tower itself), so that count is its
       crafting_speed and the recipe's time is one plant's growth_ticks — the
       same "machine speed encodes size" trick the boiler recipes use.
       Gated on data presence: no towers in the mod set → no planting recipes. */
    const towers = Object.entries(raw["agricultural-tower"] ?? {});
    if (towers.length) {
      for (const [name, t] of towers) {
        const radius = t.radius ?? 1;
        const es = energySourceInfo(t.energy_source);
        const usage = parseSI(t.energy_usage);
        machine({
          name,
          kind: "agricultural-tower",
          speed: (2 * radius + 1) ** 2 - 1, // parallel growth cells
          energyUsageW: usage != null ? usage / es.eff : null,
          energySource: t.energy_source?.type ?? null,
          fuelCategories: arr<string>(t.energy_source?.fuel_categories),
          category: "plant:agriculture",
          pollutionPerMin: t.energy_source?.emissions_per_minute?.pollution ?? 0,
          burnsFluid: es.burnsFluid,
          fluidFuelFilter: es.fluidFuelFilter,
          ...tempFedDrain(t.energy_source, usage),
        });
      }
      const seeds = db
        .prepare(`SELECT name, display, plant_result pr FROM items WHERE plant_result IS NOT NULL`)
        .all() as { name: string; display: string | null; pr: string }[];
      for (const seed of seeds) {
        const plant = raw.plant?.[seed.pr];
        const growthTicks = plant?.growth_ticks as number | undefined;
        if (!plant?.minable || !growthTicks || growthTicks <= 0) continue;
        const results = normResults(plant.minable);
        if (!results.length) continue;
        recipe({
          name: `plant-${seed.name}`,
          display: `Grow ${display(seed.pr) ?? seed.display ?? seed.pr}`,
          kind: "planting",
          category: "plant:agriculture",
          energy: growthTicks / 60,
          source: seed.pr,
          ingredients: [{ kind: "item", name: seed.name, amount: 1 }],
          products: results,
        });
        counts.planting++;
      }
    }

    /* ── rocket launch: rocket parts + payload → rocket_launch_products ──────
       One recipe per (silo × launchable item), covering a whole launch:
       rocket_parts_required × the silo's fixed-recipe products, plus as many
       payload items as one rocket lifts — min(⌊rocket_lift_weight / item
       weight⌋, rocket inventory slots × stack_size), at least 1 — yielding
       that many sets of the item's rocket_launch_products. The launch
       sequence itself is ~40.33 s (YAFC's constant). */
    const uc = raw["utility-constants"]?.default ?? {};
    const liftWeight = (uc.rocket_lift_weight as number) ?? 1_000_000;
    const defaultItemWeight = (uc.default_item_weight as number) ?? 100;
    const itemRow = db.prepare(`SELECT display, stack_size ss, weight w FROM items WHERE name = ?`);
    const machineExists = db.prepare(`SELECT 1 FROM crafting_machines WHERE name = ?`);
    // every item prototype (any subtype) that yields products when launched
    const launchables = new Map<string, any[]>();
    for (const protos of Object.values(raw)) {
      for (const [iname, it] of Object.entries(protos)) {
        const lp = arr<any>(it?.rocket_launch_products);
        if (lp.length && !launchables.has(iname)) launchables.set(iname, lp);
      }
    }
    for (const [siloName, s] of Object.entries(raw["rocket-silo"] ?? {})) {
      if (launchables.size === 0) break;
      const fixedRecipe = s.fixed_recipe ? raw.recipe?.[s.fixed_recipe] : undefined;
      const parts = fixedRecipe ? normResults(fixedRecipe) : [];
      if (!parts.length) continue; // silo without a rocket-part recipe
      const partsRequired = (s.rocket_parts_required as number) ?? 100; // engine default
      const slots = (s.to_be_inserted_to_rocket_inventory_size as number) ?? 1;
      const cat = `launch:${siloName}`;
      // pass 1 already imported the silo as a crafting machine (it has
      // crafting_categories); just add it to the launch category. Register it
      // ourselves only if pass 1 skipped it (no crafting_categories).
      if (machineExists.get(siloName)) ins.machineCat.run(siloName, cat);
      else {
        const es = energySourceInfo(s.energy_source);
        const usage = parseSI(s.energy_usage);
        machine({
          name: siloName,
          kind: "rocket-silo",
          speed: s.crafting_speed ?? 1,
          moduleSlots: s.module_slots ?? 0,
          energyUsageW: usage != null ? usage / es.eff : null,
          energySource: s.energy_source?.type ?? null,
          fuelCategories: arr<string>(s.energy_source?.fuel_categories),
          category: cat,
          pollutionPerMin: s.energy_source?.emissions_per_minute?.pollution ?? 0,
          burnsFluid: es.burnsFluid,
          fluidFuelFilter: es.fluidFuelFilter,
          ...tempFedDrain(s.energy_source, usage),
        });
      }
      for (const [payload, lp] of launchables) {
        const row = itemRow.get(payload) as
          | { display: string | null; ss: number | null; w: number | null }
          | undefined;
        if (!row) continue; // not an imported item
        const weight = row.w ?? defaultItemWeight;
        const perLaunch = Math.max(
          1,
          Math.min(weight > 0 ? Math.floor(liftWeight / weight) : Infinity, slots * (row.ss ?? 1)),
        );
        recipe({
          name: `launch-${siloName}-${payload}`,
          display: `Launch ${row.display ?? payload}`,
          kind: "launch",
          category: cat,
          energy: 40.33, // launch sequence duration
          source: siloName,
          ingredients: [
            ...parts.map((p) => ({ kind: p.kind, name: p.name, amount: p.amount * partsRequired })),
            { kind: "item", name: payload, amount: perLaunch },
          ],
          products: lp.map((c) => ({
            kind: c.type ?? "item",
            name: c.name,
            amount:
              (c.amount ?? (c.amount_min != null ? (c.amount_min + c.amount_max) / 2 : 1)) *
              perLaunch,
            probability: c.probability ?? 1,
            temperature: c.temperature ?? null,
          })),
          mainProduct: lp[0]?.name ?? null,
        });
        counts.launching++;
      }
    }
  });

  tx();
  return counts;
}
