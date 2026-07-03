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
 *  - spoiling: passive item → spoil_result conversions (no machine)
 *
 * All rows carry recipes.kind + source_entity so the UI can tell them apart.
 */
import type Database from "better-sqlite3";

export const ELECTRICITY = "pyops-electricity";
export const HEAT = "pyops-heat";

type Raw = Record<string, Record<string, any>>;
type Ctx = {
  /** localized display for an entity/item/fluid name */
  display: (name: string) => string | null;
  parseSI: (s: unknown) => number | null;
};

const arr = <T = any>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

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
      `INSERT OR REPLACE INTO recipe_products (recipe,idx,kind,name,amount,probability,temperature,ignored_by_productivity) VALUES (?,?,?,?,?,1,?,0)`,
    ),
    fluid: db.prepare(
      `INSERT OR IGNORE INTO fluids (name,display,default_temperature,heat_capacity_j) VALUES (?,?,NULL,NULL)`,
    ),
    machine: db.prepare(
      `INSERT OR REPLACE INTO crafting_machines (name,display,kind,crafting_speed,module_slots,energy_usage_w,energy_source,pollution_per_min,allowed_effects,allowed_module_categories,neighbour_bonus) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
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
      .prepare(`SELECT default_temperature dt, heat_capacity_j hc FROM fluids WHERE name = ?`)
      .get(name) as { dt: number | null; hc: number | null } | undefined;

  const counts = { mining: 0, pumping: 0, boiling: 0, generating: 0, burning: 0, spoiling: 0 };

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
    products?: { kind: string; name: string; amount: number; temperature?: number | null }[];
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
      ins.prod.run(r.name, i, c.kind, c.name, c.amount, c.temperature ?? null),
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
    );
    ins.machineCat.run(m.name, m.category);
    for (const fc of m.fuelCategories ?? []) ins.machineFuel.run(m.name, fc);
  };

  const tx = db.transaction(() => {
    /* ── electricity + heat pseudo-fluids ─────────────────────────────────── */
    ins.fluid.run(ELECTRICITY, "Electricity (MJ)");
    ins.fluid.run(HEAT, "Heat (MJ)");

    /* ── mining: resource → products, drills as machines ─────────────────── */
    const drillsByCat = new Map<string, string[]>();
    for (const [name, d] of Object.entries(raw["mining-drill"] ?? {})) {
      for (const rc of arr<string>(d.resource_categories)) {
        drillsByCat.set(rc, [...(drillsByCat.get(rc) ?? []), name]);
        machine({
          name,
          kind: "mining-drill",
          speed: d.mining_speed ?? 1,
          moduleSlots: d.module_slots ?? 0,
          energyUsageW: parseSI(d.energy_usage),
          energySource: d.energy_source?.type ?? null,
          fuelCategories: arr<string>(d.energy_source?.fuel_categories),
          allowedModuleCategories: arr<string>(d.allowed_module_categories),
          category: `mine:${rc}`,
          pollutionPerMin: d.energy_source?.emissions_per_minute?.pollution ?? 0,
        });
      }
    }
    for (const [name, res] of Object.entries(raw.resource ?? {})) {
      const minable = res.minable;
      if (!minable) continue;
      const cat = res.category ?? "basic-solid";
      if (!drillsByCat.has(cat)) continue; // nothing can mine it
      const results = minable.results
        ? arr<any>(minable.results)
        : minable.result
          ? [{ type: "item", name: minable.result, amount: minable.count ?? 1 }]
          : [];
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
        products: results.map((c) => ({
          kind: c.type ?? "item",
          name: c.name ?? c[0],
          amount:
            c.amount ?? (c.amount_min != null ? (c.amount_min + c.amount_max) / 2 : (c[1] ?? 1)),
        })),
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
  });

  tx();
  return counts;
}
