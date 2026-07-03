/**
 * Pass-1 importer: parse Factorio's `data-raw-dump.json` (from `factorio --dump-data`)
 * into the SQLite db. REAL prototypes only — synthetic recipes (mining/boiling/burning/
 * spoiling) and fluid temperature variants come in pass 2.
 *
 * `importFactorioDump({ dumpPath, dbUrl })` is called in-process by the server-side
 * data sync (src/server/dump.ts).
 *
 * Idempotent: clears the reference tables and re-inserts. Uses raw better-sqlite3
 * prepared statements in one transaction (fast for ~10k recipes / ~60k rows).
 */
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { synthesizePass2 } from "./synthesize.ts";
import { PROJECTS_DIR } from "../server/paths.server.ts";

const DEFAULT_DUMP = join(homedir(), ".factorio", "script-output", "data-raw-dump.json");

// All prototype types that are "items" (can be inventory contents / recipe components).
const ITEM_TYPES = [
  "item",
  "ammo",
  "capsule",
  "gun",
  "module",
  "tool",
  "armor",
  "repair-tool",
  "mining-tool",
  "rail-planner",
  "item-with-entity-data",
  "item-with-label",
  "item-with-inventory",
  "item-with-tags",
  "selection-tool",
  "blueprint",
  "copy-paste-tool",
  "deconstruction-item",
  "upgrade-item",
  "blueprint-book",
  "spidertron-remote",
  "space-platform-starter-pack",
];
const MACHINE_TYPES = ["assembling-machine", "furnace", "rocket-silo"] as const;

/** Parse a Factorio SI value string ("150kW", "2MJ", "2.1kJ") to its base number (W or J). */
function parseSI(s: unknown): number | null {
  if (s == null) return null;
  if (typeof s === "number") return s;
  if (typeof s !== "string") return null;
  const m = /^\s*([\d.]+)\s*([yzafpnµumkKMGTPEZY]?)\s*([WJ])?/.exec(s);
  if (!m) return null;
  const mult: Record<string, number> = {
    "": 1,
    k: 1e3,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    P: 1e15,
    m: 1e-3,
    µ: 1e-6,
    u: 1e-6,
    n: 1e-9,
  };
  return parseFloat(m[1]) * (mult[m[2] ?? ""] ?? 1);
}

type Component = { type?: string; name: string; amount?: number; [k: string]: unknown };
/** Components may be object `{type,name,amount}` or legacy array `[name, amount]`. */
function normComponent(c: unknown): Component {
  if (Array.isArray(c)) return { type: "item", name: c[0], amount: c[1] };
  return c as Component;
}
/** Lua serializes an empty table as `{}` (object), not `[]`. Coerce to array. */
const arr = <T = any>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
/** Non-empty string list → JSON text; empty/missing → NULL (= "no restriction"). */
const jsonList = (x: unknown): string | null => {
  const a = arr<string>(x);
  return a.length ? JSON.stringify(a) : null;
};

const TABLES = [
  "recipe_ingredients",
  "recipe_products",
  "recipes",
  "items",
  "fluids",
  "recipe_categories",
  "crafting_machines",
  "machine_categories",
  "machine_fuel_categories",
  "mining_drills",
  "drill_resource_categories",
  "modules",
  "module_limitations",
  "beacons",
  "belts",
  "loaders",
  "inserters",
  "tech_stack_bonuses",
  "technologies",
  "tech_unlocks",
  "tech_ingredients",
  "tech_prerequisites",
  "turd_replacements",
  "meta",
];

const COUNT_TABLES = [
  "recipes",
  "recipe_ingredients",
  "recipe_products",
  "items",
  "fluids",
  "recipe_categories",
  "crafting_machines",
  "machine_categories",
  "mining_drills",
  "modules",
  "module_limitations",
  "beacons",
  "belts",
  "loaders",
  "inserters",
  "technologies",
  "tech_unlocks",
];

export type ImportSummary = {
  dump: string;
  dbUrl: string;
  ms: number;
  counts: Record<string, number>;
};

/** Parse the dump (+ sibling *-locale.json files) and replace the reference
 * tables in one transaction. Safe to call from the running server. */
export function importFactorioDump(
  opts: { dumpPath?: string; dbUrl?: string } = {},
): ImportSummary {
  const DUMP = opts.dumpPath ?? DEFAULT_DUMP;
  const DB_URL = opts.dbUrl ?? process.env.DATABASE_URL ?? join(PROJECTS_DIR, "default.db");

  const raw = JSON.parse(readFileSync(DUMP, "utf8")) as Record<string, Record<string, any>>;

  // Locale: load every <type>-locale.json ({ names, descriptions }) for display names.
  const SO_DIR = dirname(DUMP);
  type Locale = { names?: Record<string, string>; descriptions?: Record<string, string> };
  const localeByKind: Record<string, Locale> = {};
  for (const f of readdirSync(SO_DIR)) {
    if (!f.endsWith("-locale.json")) continue;
    try {
      localeByKind[f.slice(0, -"-locale.json".length)] = JSON.parse(
        readFileSync(join(SO_DIR, f), "utf8"),
      );
    } catch {
      /* skip */
    }
  }
  // Fallback display for recipes/machines that inherit a product/item name.
  const productDisplay: Record<string, string> = {};
  for (const t of [...ITEM_TYPES, "fluid"]) {
    const names = localeByKind[t]?.names;
    if (names) for (const [n, d] of Object.entries(names)) productDisplay[n] ??= d;
  }

  const db = new Database(DB_URL);
  db.pragma("journal_mode = WAL");

  const ins = {
    recipe: db.prepare(
      `INSERT INTO recipes (name,display,kind,category,energy_required,enabled,hidden,allow_productivity,allowed_module_categories,main_product,subgroup,"order",source_entity) VALUES (@name,@display,@kind,@category,@energy_required,@enabled,@hidden,@allow_productivity,@allowed_module_categories,@main_product,@subgroup,@order,@source_entity)`,
    ),
    ing: db.prepare(
      `INSERT INTO recipe_ingredients (recipe,idx,kind,name,amount,min_temp,max_temp) VALUES (@recipe,@idx,@kind,@name,@amount,@min_temp,@max_temp)`,
    ),
    prod: db.prepare(
      `INSERT INTO recipe_products (recipe,idx,kind,name,amount,amount_min,amount_max,probability,temperature,ignored_by_productivity) VALUES (@recipe,@idx,@kind,@name,@amount,@amount_min,@amount_max,@probability,@temperature,@ignored_by_productivity)`,
    ),
    item: db.prepare(
      `INSERT OR IGNORE INTO items (name,display,subgroup,"order",stack_size,weight,fuel_value_j,fuel_category,spoil_result,spoil_ticks,burnt_result,plant_result) VALUES (@name,@display,@subgroup,@order,@stack_size,@weight,@fuel_value_j,@fuel_category,@spoil_result,@spoil_ticks,@burnt_result,@plant_result)`,
    ),
    fluid: db.prepare(
      `INSERT INTO fluids (name,display,"order",default_temperature,max_temperature,fuel_value_j,heat_capacity_j) VALUES (@name,@display,@order,@default_temperature,@max_temperature,@fuel_value_j,@heat_capacity_j)`,
    ),
    recipeCat: db.prepare(`INSERT OR IGNORE INTO recipe_categories (name) VALUES (?)`),
    machine: db.prepare(
      `INSERT INTO crafting_machines (name,display,kind,crafting_speed,module_slots,energy_usage_w,energy_source,pollution_per_min,allowed_effects,allowed_module_categories) VALUES (@name,@display,@kind,@crafting_speed,@module_slots,@energy_usage_w,@energy_source,@pollution_per_min,@allowed_effects,@allowed_module_categories)`,
    ),
    machineCat: db.prepare(
      `INSERT OR IGNORE INTO machine_categories (machine,category) VALUES (?,?)`,
    ),
    machineFuel: db.prepare(
      `INSERT OR IGNORE INTO machine_fuel_categories (machine,fuel_category) VALUES (?,?)`,
    ),
    drill: db.prepare(
      `INSERT INTO mining_drills (name,mining_speed,module_slots,energy_usage_w,energy_source) VALUES (@name,@mining_speed,@module_slots,@energy_usage_w,@energy_source)`,
    ),
    drillCat: db.prepare(
      `INSERT OR IGNORE INTO drill_resource_categories (drill,resource_category) VALUES (?,?)`,
    ),
    module: db.prepare(
      `INSERT INTO modules (name,display,category,hidden,tier,eff_speed,eff_productivity,eff_consumption,eff_pollution) VALUES (@name,@display,@category,@hidden,@tier,@eff_speed,@eff_productivity,@eff_consumption,@eff_pollution)`,
    ),
    moduleLim: db.prepare(`INSERT OR IGNORE INTO module_limitations (module,recipe) VALUES (?,?)`),
    beacon: db.prepare(
      `INSERT INTO beacons (name,display,distribution_effectivity,module_slots,energy_usage_w,hidden,allowed_effects,allowed_module_categories,profile) VALUES (@name,@display,@distribution_effectivity,@module_slots,@energy_usage_w,@hidden,@allowed_effects,@allowed_module_categories,@profile)`,
    ),
    tech: db.prepare(
      `INSERT INTO technologies (name,display,description,"order",unit_count,enabled,is_turd) VALUES (@name,@display,@description,@order,@unit_count,@enabled,@is_turd)`,
    ),
    techPrereq: db.prepare(
      `INSERT OR IGNORE INTO tech_prerequisites (technology,prerequisite) VALUES (?,?)`,
    ),
    techUnlock: db.prepare(`INSERT OR IGNORE INTO tech_unlocks (technology,recipe) VALUES (?,?)`),
    techIng: db.prepare(
      `INSERT OR IGNORE INTO tech_ingredients (technology,name,amount) VALUES (?,?,?)`,
    ),
    belt: db.prepare(
      `INSERT OR IGNORE INTO belts (name,display,"order",speed) VALUES (@name,@display,@order,@speed)`,
    ),
    loader: db.prepare(
      `INSERT OR IGNORE INTO loaders (name,display,"order",speed) VALUES (@name,@display,@order,@speed)`,
    ),
    inserter: db.prepare(
      `INSERT OR IGNORE INTO inserters (name,display,"order",rotation_speed,extension_speed,pickup_x,pickup_y,drop_x,drop_y,bulk,base_stack_bonus,max_belt_stack_size) VALUES (@name,@display,@order,@rotation_speed,@extension_speed,@pickup_x,@pickup_y,@drop_x,@drop_y,@bulk,@base_stack_bonus,@max_belt_stack_size)`,
    ),
    techStack: db.prepare(
      `INSERT OR REPLACE INTO tech_stack_bonuses (technology,effect,modifier) VALUES (?,?,?)`,
    ),
    meta: db.prepare(`INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)`),
    turdRepl: db.prepare(
      `INSERT OR IGNORE INTO turd_replacements (sub_tech, old_recipe, new_recipe) VALUES (?,?,?)`,
    ),
  };

  const load = db.transaction(() => {
    for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run();

    // recipes (+ ingredients, products)
    for (const [name, r] of Object.entries(raw.recipe ?? {})) {
      const results = arr(r.results).map(normComponent);
      const mainProduct =
        r.main_product && r.main_product !== ""
          ? r.main_product
          : results.length === 1
            ? results[0].name
            : undefined;
      ins.recipe.run({
        name,
        display:
          localeByKind.recipe?.names?.[name] ??
          (mainProduct ? productDisplay[mainProduct] : undefined) ??
          null,
        kind: "real",
        category: r.category ?? "crafting",
        energy_required: r.energy_required ?? 0.5,
        enabled: r.enabled === false ? 0 : 1,
        hidden: r.hidden ? 1 : 0,
        allow_productivity: r.allow_productivity ? 1 : 0,
        allowed_module_categories: jsonList(r.allowed_module_categories),
        main_product: r.main_product ?? null,
        subgroup: r.subgroup ?? null,
        order: r.order ?? null,
        source_entity: null,
      });
      arr(r.ingredients)
        .map(normComponent)
        .forEach((c: Component, i: number) =>
          ins.ing.run({
            recipe: name,
            idx: i,
            kind: c.type ?? "item",
            name: c.name,
            amount: c.amount ?? 0,
            min_temp: (c.minimum_temperature as number) ?? null,
            max_temp: (c.maximum_temperature as number) ?? null,
          }),
        );
      arr(r.results)
        .map(normComponent)
        .forEach((c: Component, i: number) =>
          ins.prod.run({
            recipe: name,
            idx: i,
            kind: c.type ?? "item",
            name: c.name,
            amount: c.amount ?? null,
            amount_min: (c.amount_min as number) ?? null,
            amount_max: (c.amount_max as number) ?? null,
            probability: (c.probability as number) ?? 1,
            temperature: (c.temperature as number) ?? null,
            // Factorio 2.0: an AMOUNT (the catalytic part of the product that
            // productivity never multiplies), not a flag. Kovarex: u-235 out 41
            // with ignored 40. Tolerate a legacy boolean `true` = all ignored.
            ignored_by_productivity:
              typeof c.ignored_by_productivity === "number"
                ? c.ignored_by_productivity
                : c.ignored_by_productivity
                  ? (c.amount ??
                    (((c.amount_min as number) ?? 0) + ((c.amount_max as number) ?? 0)) / 2)
                  : 0,
          }),
        );
    }

    // items (across all item-subtype prototypes)
    for (const type of ITEM_TYPES) {
      for (const [name, it] of Object.entries(raw[type] ?? {})) {
        ins.item.run({
          name,
          display: localeByKind.item?.names?.[name] ?? productDisplay[name] ?? null,
          subgroup: it.subgroup ?? null,
          order: it.order ?? null,
          stack_size: it.stack_size ?? null,
          weight: typeof it.weight === "number" ? it.weight : null,
          fuel_value_j: parseSI(it.fuel_value),
          fuel_category: it.fuel_category ?? null,
          spoil_result: it.spoil_result ?? null,
          spoil_ticks: it.spoil_ticks ?? null,
          burnt_result: it.burnt_result ?? null,
          plant_result: it.plant_result ?? null,
        });
      }
    }

    // fluids
    for (const [name, f] of Object.entries(raw.fluid ?? {})) {
      ins.fluid.run({
        name,
        display: localeByKind.fluid?.names?.[name] ?? null,
        order: f.order ?? null,
        default_temperature: f.default_temperature ?? null,
        max_temperature: f.max_temperature ?? null,
        fuel_value_j: parseSI(f.fuel_value),
        heat_capacity_j: parseSI(f.heat_capacity),
      });
    }

    // recipe categories
    for (const name of Object.keys(raw["recipe-category"] ?? {})) ins.recipeCat.run(name);

    // crafting machines (+ categories + fuel categories)
    for (const kind of MACHINE_TYPES) {
      for (const [name, m] of Object.entries(raw[kind] ?? {})) {
        const cats = arr<string>(m.crafting_categories);
        if (cats.length === 0) continue;
        ins.machine.run({
          name,
          display: localeByKind.entity?.names?.[name] ?? productDisplay[name] ?? null,
          kind,
          crafting_speed: m.crafting_speed ?? 1,
          module_slots: m.module_slots ?? 0,
          energy_usage_w: parseSI(m.energy_usage),
          energy_source: m.energy_source?.type ?? null,
          pollution_per_min: m.energy_source?.emissions_per_minute?.pollution ?? 0,
          allowed_effects: jsonList(m.allowed_effects),
          allowed_module_categories: jsonList(m.allowed_module_categories),
        });
        for (const c of cats) ins.machineCat.run(name, c);
        for (const fc of arr<string>(m.energy_source?.fuel_categories))
          ins.machineFuel.run(name, fc);
      }
    }

    // mining drills (+ resource categories)
    for (const [name, d] of Object.entries(raw["mining-drill"] ?? {})) {
      ins.drill.run({
        name,
        mining_speed: d.mining_speed ?? 1,
        module_slots: d.module_slots ?? 0,
        energy_usage_w: parseSI(d.energy_usage),
        energy_source: d.energy_source?.type ?? null,
      });
      for (const rc of arr<string>(d.resource_categories)) ins.drillCat.run(name, rc);
    }

    // modules (+ limitations)
    for (const [name, mod] of Object.entries(raw.module ?? {})) {
      const e = mod.effect ?? {};
      ins.module.run({
        name,
        display: localeByKind.item?.names?.[name] ?? productDisplay[name] ?? null,
        category: mod.category ?? null,
        hidden: mod.hidden ? 1 : 0,
        tier: mod.tier ?? null,
        eff_speed: e.speed ?? 0,
        eff_productivity: e.productivity ?? 0,
        eff_consumption: e.consumption ?? 0,
        eff_pollution: e.pollution ?? 0,
      });
      for (const rec of arr<string>(mod.limitation)) ins.moduleLim.run(name, rec);
    }

    // beacons
    for (const [name, b] of Object.entries(raw.beacon ?? {})) {
      ins.beacon.run({
        name,
        display: localeByKind.entity?.names?.[name] ?? productDisplay[name] ?? null,
        distribution_effectivity: b.distribution_effectivity ?? null,
        module_slots: b.module_slots ?? 0,
        energy_usage_w: parseSI(b.energy_usage),
        hidden: b.hidden ? 1 : 0,
        allowed_effects: jsonList(b.allowed_effects),
        allowed_module_categories: jsonList(b.allowed_module_categories),
        profile: Array.isArray(b.profile) && b.profile.length ? JSON.stringify(b.profile) : null,
      });
    }

    // logistics prototypes (belts, loaders, inserters) — skip hidden ones (Py hides
    // the vanilla loaders in favour of the AAI ones; EE/test entities are hidden too).
    const isHidden = (e: any) => e?.hidden === true || arr<string>(e?.flags).includes("hidden");
    const entityDisplay = (name: string) =>
      localeByKind.entity?.names?.[name] ?? productDisplay[name] ?? null;
    const vecX = (p: any, d: number) => (Array.isArray(p) ? (p[0] ?? d) : (p?.x ?? d));
    const vecY = (p: any, d: number) => (Array.isArray(p) ? (p[1] ?? d) : (p?.y ?? d));

    for (const [name, b] of Object.entries(raw["transport-belt"] ?? {})) {
      if (isHidden(b)) continue;
      ins.belt.run({
        name,
        display: entityDisplay(name),
        order: b.order ?? null,
        speed: b.speed ?? 0,
      });
    }
    for (const kind of ["loader", "loader-1x1", "loader-1x2"]) {
      for (const [name, l] of Object.entries(raw[kind] ?? {})) {
        if (isHidden(l)) continue;
        ins.loader.run({
          name,
          display: entityDisplay(name),
          order: l.order ?? null,
          speed: l.speed ?? 0,
        });
      }
    }
    for (const [name, it] of Object.entries(raw.inserter ?? {})) {
      if (isHidden(it)) continue;
      ins.inserter.run({
        name,
        display: entityDisplay(name),
        order: it.order ?? null,
        rotation_speed: it.rotation_speed ?? 0,
        extension_speed: it.extension_speed ?? 0,
        pickup_x: vecX(it.pickup_position, 0),
        pickup_y: vecY(it.pickup_position, -1),
        drop_x: vecX(it.insert_position, 0),
        drop_y: vecY(it.insert_position, 1),
        bulk: it.bulk ? 1 : 0,
        base_stack_bonus: it.inserter_stack_size_bonus ?? 0,
        max_belt_stack_size: it.max_belt_stack_size ?? 1,
      });
    }

    // technologies (+ prerequisites + recipe unlocks)
    const STACK_EFFECT: Record<string, string> = {
      "belt-stack-size-bonus": "belt",
      "inserter-stack-size-bonus": "inserter",
      "bulk-inserter-capacity-bonus": "bulk-inserter",
    };
    for (const [name, t] of Object.entries(raw.technology ?? {})) {
      ins.tech.run({
        name,
        display: localeByKind.technology?.names?.[name] ?? null,
        description: localeByKind.technology?.descriptions?.[name] ?? null,
        order: t.order ?? null,
        unit_count: t.unit?.count ?? null,
        enabled: t.enabled === false ? 0 : 1,
        is_turd: t.is_turd ? 1 : 0,
      });
      for (const pre of arr<string>(t.prerequisites)) ins.techPrereq.run(name, pre);
      const stackAcc: Record<string, number> = {};
      for (const eff of arr<any>(t.effects)) {
        if (eff?.type === "unlock-recipe" && eff.recipe) ins.techUnlock.run(name, eff.recipe);
        const key = STACK_EFFECT[eff?.type];
        if (key && typeof eff.modifier === "number")
          stackAcc[key] = (stackAcc[key] ?? 0) + eff.modifier;
      }
      for (const [key, mod] of Object.entries(stackAcc)) ins.techStack.run(name, key, mod);
      for (const ing of arr<any>(t.unit?.ingredients)) {
        const sn = Array.isArray(ing) ? ing[0] : ing.name;
        const sa = Array.isArray(ing) ? ing[1] : ing.amount;
        if (sn) ins.techIng.run(name, sn, sa ?? 1);
      }
    }

    // TURD recipe replacements smuggled through the dump by the helper mod
    for (const rep of arr<any>(raw["mod-data"]?.["pyops-turd-replacements"]?.data?.replacements)) {
      if (rep?.sub && rep.old && rep.new) ins.turdRepl.run(rep.sub, rep.old, rep.new);
    }

    ins.meta.run("factorio_version", String(raw.recipe ? "" : "") || "unknown");
    ins.meta.run("imported_from", DUMP);
    // rocket-logistics constants (utility-constants.default) for the launches/min display
    const uc = raw["utility-constants"]?.default ?? {};
    ins.meta.run("rocket_lift_weight", String(uc.rocket_lift_weight ?? 1_000_000));
    ins.meta.run("default_item_weight", String(uc.default_item_weight ?? 100));
  });

  const t0 = Date.now();
  load();
  // pass 2: synthetic recipes (mining/pumping/boiling/generating/spoiling + electricity)
  const synthetic = synthesizePass2(db, raw, {
    display: (name) =>
      localeByKind.entity?.names?.[name] ??
      localeByKind.fluid?.names?.[name] ??
      productDisplay[name] ??
      null,
    parseSI,
  });
  const count = (t: string) => (db.prepare(`SELECT count(*) c FROM ${t}`).get() as { c: number }).c;
  const counts = Object.fromEntries(COUNT_TABLES.map((t) => [t, count(t)]));
  db.close();
  return { dump: DUMP, dbUrl: DB_URL, ms: Date.now() - t0, counts: { ...counts, ...synthetic } };
}
