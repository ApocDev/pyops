import { sqliteTable, integer, text, real, index, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const bool = (name?: string) => integer(name as string, { mode: "boolean" });

/* ── Factorio reference data (pass 1: real prototypes) ─────────────────────────
 * Loaded from `data-raw-dump.json` by src/db/import-factorio.ts.
 * Quality is intentionally not modelled (Py has none). Fluid temperatures ARE:
 * ingredients carry a min/max range, products an exact temperature.
 * Synthetic recipes (mining/boiling/burning/spoiling) + temp variants = pass 2.
 */

export const items = sqliteTable(
  "items",
  {
    name: text().primaryKey(),
    display: text(), // localized name ("Iron plate")
    subgroup: text(),
    order: text(),
    stackSize: integer("stack_size"),
    weight: real("weight"), // rocket-lift weight (null = not set in data → default_item_weight)
    fuelValueJ: real("fuel_value_j"),
    fuelCategory: text("fuel_category"),
    // normalization sources for pass-2 synthetic recipes
    spoilResult: text("spoil_result"),
    spoilTicks: integer("spoil_ticks"),
    burntResult: text("burnt_result"),
    plantResult: text("plant_result"),
  },
  (t) => [index("items_subgroup_idx").on(t.subgroup)],
);

export const fluids = sqliteTable("fluids", {
  name: text().primaryKey(),
  display: text(),
  order: text(),
  defaultTemperature: real("default_temperature"),
  maxTemperature: real("max_temperature"),
  fuelValueJ: real("fuel_value_j"),
  heatCapacityJ: real("heat_capacity_j"),
});

export const recipes = sqliteTable(
  "recipes",
  {
    name: text().primaryKey(),
    display: text(),
    // real | mining | pumping | boiling | burning | generating | launch | planting | research | spoiling
    kind: text().notNull().default("real"),
    category: text(),
    energyRequired: real("energy_required"), // craft time (s) at speed 1
    enabled: bool("enabled").notNull().default(true),
    hidden: bool("hidden").notNull().default(false),
    allowProductivity: bool("allow_productivity").notNull().default(false),
    // RecipePrototype.maximum_productivity — caps total productivity (null = engine
    // default +300%). Py raises it to 1e6 on nearly every recipe (10344/10392).
    maximumProductivity: real("maximum_productivity"),
    allowedModuleCategories: text("allowed_module_categories", { mode: "json" }).$type<
      string[] | null
    >(),
    mainProduct: text("main_product"),
    subgroup: text(),
    order: text(),
    sourceEntity: text("source_entity"), // for synthetic recipes (pass 2)
  },
  (t) => [index("recipes_category_idx").on(t.category), index("recipes_kind_idx").on(t.kind)],
);

export const recipeIngredients = sqliteTable(
  "recipe_ingredients",
  {
    recipe: text().notNull(),
    idx: integer().notNull(),
    kind: text().notNull(), // item | fluid
    name: text().notNull(),
    amount: real().notNull(),
    minTemp: real("min_temp"), // fluid temperature range (required min)
    maxTemp: real("max_temp"), // fluid temperature range (allowed max)
  },
  (t) => [
    primaryKey({ columns: [t.recipe, t.idx] }),
    index("ing_recipe_idx").on(t.recipe),
    index("ing_name_idx").on(t.name),
  ],
);

export const recipeProducts = sqliteTable(
  "recipe_products",
  {
    recipe: text().notNull(),
    idx: integer().notNull(),
    kind: text().notNull(),
    name: text().notNull(),
    amount: real(), // null when amount_min/max used
    amountMin: real("amount_min"),
    amountMax: real("amount_max"),
    probability: real().notNull().default(1),
    temperature: real(), // exact produced temperature (fluids)
    // AMOUNT of this product not scaled by productivity (Factorio 2.0 semantics:
    // the first N units are catalytic — Kovarex outputs 41 u-235 with 40 ignored,
    // so productivity applies to just 1 — see #93). NOT a flag.
    ignoredByProductivity: real("ignored_by_productivity").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.recipe, t.idx] }),
    index("prod_recipe_idx").on(t.recipe),
    index("prod_name_idx").on(t.name),
  ],
);

export const recipeCategories = sqliteTable("recipe_categories", {
  name: text().primaryKey(),
});

export const craftingMachines = sqliteTable("crafting_machines", {
  name: text().primaryKey(),
  display: text(),
  kind: text().notNull(), // assembling-machine | furnace | rocket-silo
  craftingSpeed: real("crafting_speed").notNull(),
  // Placed tile footprint, derived from the prototype selection/collision box.
  // The block UI uses the perimeter (2w + 2h) as a conservative count of
  // adjacent inserter/loader/pipe access positions. Null on legacy imports
  // until the next game-data sync.
  tileWidth: integer("tile_width"),
  tileHeight: integer("tile_height"),
  moduleSlots: integer("module_slots").notNull().default(0),
  energyUsageW: real("energy_usage_w"),
  energySource: text("energy_source"), // electric | burner | ...
  pollutionPerMin: real("pollution_per_min"), // emissions_per_minute.pollution at base speed (#23)
  // module eligibility (empty/null = no restriction): which effect kinds the
  // machine accepts, and which module categories fit its slots (Py creature
  // buildings only take their own creature modules)
  allowedEffects: text("allowed_effects", { mode: "json" }).$type<string[] | null>(),
  allowedModuleCategories: text("allowed_module_categories", { mode: "json" }).$type<
    string[] | null
  >(),
  // Reactor neighbour bonus (#94): extra heat output per adjacent working
  // reactor, from the ReactorPrototype (Py's nuclear-reactor dumps 1 = +100%).
  // Only set for kind "reactor"; null elsewhere (and on pre-#94 imports, where
  // the engine-default 1 applies).
  neighbourBonus: real("neighbour_bonus"),
  // Fluid energy sources (#25). `burns_fluid` = 1 when the machine burns fluid
  // by its fuel_value (Py: glassworks, smelter, antimony drills, oil boiler);
  // 0 when it consumes its filter fluid by temperature instead (Py: uf6
  // reactors, compost plants, the solar tower) — those aren't fuel burners.
  // `fluid_fuel_filter` = the energy source fluid_box's filter: a filtered
  // burner is pinned to exactly that fluid (Py oil/gas powerplants); an
  // unfiltered one accepts ANY fuel-valued fluid (the pyops-fluid-fuel pool).
  // Both null on non-fluid energy sources and on pre-#25 imports.
  burnsFluid: integer("burns_fluid"),
  fluidFuelFilter: text("fluid_fuel_filter"),
  // Temperature-fed drain (#114), for `burns_fluid = 0` sources (see
  // db/fluid-energy.ts for the shapes and math). `fluid_fuel_per_sec` = a FIXED
  // drain of the filter fluid in units/s per running machine (an explicit
  // fluid_usage_per_tick, or the engine's derivation from maximum_temperature —
  // Py's uf6 reactors ≈60/s, neutron absorbers ≈2/s, the solar tower 60/s).
  // `fluid_fuel_energy_j` = usable J per unit of the filter fluid
  // ((usable-temperature cap − default_temperature) × heat_capacity, without
  // effectivity): when per_sec is null (scale_fluid_usage — Py's compost
  // plants), the drain is the effectivity-folded draw ÷ this. Both null on
  // fuel burners and pre-#114 imports (re-sync the data to populate).
  fluidFuelPerSec: real("fluid_fuel_per_sec"),
  fluidFuelEnergyJ: real("fluid_fuel_energy_j"),
});

export const machineCategories = sqliteTable(
  "machine_categories",
  {
    machine: text().notNull(),
    category: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.machine, t.category] }),
    index("mc_category_idx").on(t.category),
  ],
);

export const machineFuelCategories = sqliteTable(
  "machine_fuel_categories",
  {
    machine: text().notNull(),
    fuelCategory: text("fuel_category").notNull(),
  },
  (t) => [primaryKey({ columns: [t.machine, t.fuelCategory] })],
);

export const miningDrills = sqliteTable("mining_drills", {
  name: text().primaryKey(),
  miningSpeed: real("mining_speed").notNull(),
  moduleSlots: integer("module_slots").notNull().default(0),
  energyUsageW: real("energy_usage_w"),
  energySource: text("energy_source"),
});

export const drillResourceCategories = sqliteTable(
  "drill_resource_categories",
  {
    drill: text().notNull(),
    resourceCategory: text("resource_category").notNull(),
  },
  (t) => [primaryKey({ columns: [t.drill, t.resourceCategory] })],
);

export const modules = sqliteTable("modules", {
  name: text().primaryKey(),
  display: text(),
  category: text(),
  hidden: bool("hidden").notNull().default(false), // TURD modules are hidden (game-inserted)
  tier: integer(),
  effSpeed: real("eff_speed").notNull().default(0),
  effProductivity: real("eff_productivity").notNull().default(0),
  effConsumption: real("eff_consumption").notNull().default(0),
  effPollution: real("eff_pollution").notNull().default(0),
});

export const moduleLimitations = sqliteTable(
  "module_limitations",
  {
    module: text().notNull(),
    recipe: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.module, t.recipe] })],
);

/* Py beacon system: the vanilla beacon entity is hidden; the real choices are
 * (diet-)beacon-AM{1..5}-FM{1..5} variants, each with its own distribution
 * effectivity + power draw and 2 module slots. `profile` is the per-count
 * effectivity falloff (vanilla 1/sqrt(n)); Py enforces one beacon per machine. */
export const beacons = sqliteTable("beacons", {
  name: text().primaryKey(),
  display: text(),
  distributionEffectivity: real("distribution_effectivity"),
  moduleSlots: integer("module_slots").notNull().default(0),
  energyUsageW: real("energy_usage_w"),
  hidden: bool("hidden").notNull().default(false),
  allowedEffects: text("allowed_effects", { mode: "json" }).$type<string[] | null>(),
  allowedModuleCategories: text("allowed_module_categories", { mode: "json" }).$type<
    string[] | null
  >(),
  profile: text({ mode: "json" }).$type<number[] | null>(),
});

/* ── Logistics prototypes (belts, loaders, inserters) ─────────────────────────
 * For the per-block logistics display (#21): how many belts carry an item in/out
 * of a row, and how many inserters/loaders feed each building at the planned rate.
 * Belt/loader throughput = speed × 480 × placed-stack. Inserter throughput uses
 * the swing model ported from inserter-throughput-lib (see server/logistics.ts);
 * the raw kinematics live here, the math lives in that module. */
export const belts = sqliteTable("belts", {
  name: text().primaryKey(),
  display: text(),
  order: text(),
  speed: real().notNull(), // tiles/tick (prototype `speed`); full-belt items/s = speed × 480
});

/** Loaders move a full belt's worth of items with no inserter swing — modelled as
 * a super-fast "inserter" in the UI, but throughput is belt-speed based (= belts). */
export const loaders = sqliteTable("loaders", {
  name: text().primaryKey(),
  display: text(),
  order: text(),
  speed: real().notNull(), // tiles/tick; same throughput basis as a belt of that speed
});

export const inserters = sqliteTable("inserters", {
  name: text().primaryKey(),
  display: text(),
  order: text(),
  rotationSpeed: real("rotation_speed").notNull(), // RealOrientation per tick
  extensionSpeed: real("extension_speed").notNull(), // tiles per tick
  // pickup/drop hand positions relative to the inserter (vectors); the swing model
  // needs their lengths + the orientation between them.
  pickupX: real("pickup_x").notNull(),
  pickupY: real("pickup_y").notNull(),
  dropX: real("drop_x").notNull(),
  dropY: real("drop_y").notNull(),
  bulk: bool("bulk").notNull().default(false), // bulk inserter → bulk-inserter-capacity bonus applies
  baseStackBonus: integer("base_stack_bonus").notNull().default(0), // prototype inserter_stack_size_bonus
  maxBeltStackSize: integer("max_belt_stack_size").notNull().default(1), // per-inserter belt-stacking cap
});

/** Tech effects that raise belt/inserter stack sizes — `belt-stack-size-bonus`,
 * `inserter-stack-size-bonus`, `bulk-inserter-capacity-bonus`. Summed over the
 * in-effect tech set (per the research horizon) to derive the current placed-stack
 * for belts and the hand stack size for inserters. */
export const techStackBonuses = sqliteTable(
  "tech_stack_bonuses",
  {
    technology: text().notNull(),
    effect: text().notNull(), // belt | inserter | bulk-inserter
    modifier: real().notNull(),
  },
  (t) => [primaryKey({ columns: [t.technology, t.effect] })],
);

/** Tech effects that grant flat productivity — `mining-drill-productivity-bonus`
 * (recipe = '' → applies to every mining recipe) and Factorio 2.0
 * `change-recipe-productivity` (a specific recipe). Summed over the in-effect
 * tech set (per the research horizon), like tech_stack_bonuses. */
export const techProductivityBonuses = sqliteTable(
  "tech_productivity_bonuses",
  {
    technology: text().notNull(),
    recipe: text().notNull().default(""), // '' = mining-drill productivity
    modifier: real().notNull(),
  },
  (t) => [primaryKey({ columns: [t.technology, t.recipe] }), index("tpb_recipe_idx").on(t.recipe)],
);

export const technologies = sqliteTable("technologies", {
  name: text().primaryKey(),
  display: text(),
  description: text(), // localised description; Factorio rich-text markup — strip before display
  order: text(),
  unitCount: real("unit_count"), // research cost multiplier (unit.count)
  enabled: bool("enabled").notNull().default(true),
  // Pyanodon TURD: the importer marks master techs from each selectable sub-tech's
  // planner prerequisites [master, turd-select-<name>] (and honors the legacy
  // dump is_turd marker when present).
  isTurd: bool("is_turd").notNull().default(false),
});

export const techPrerequisites = sqliteTable(
  "tech_prerequisites",
  {
    technology: text().notNull(),
    prerequisite: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.technology, t.prerequisite] }),
    index("tp_prereq_idx").on(t.prerequisite),
  ],
);

export const techUnlocks = sqliteTable(
  "tech_unlocks",
  {
    technology: text().notNull(),
    recipe: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.technology, t.recipe] }), index("tu_recipe_idx").on(t.recipe)],
);

/** Science packs required to research a technology (from unit.ingredients). */
export const techIngredients = sqliteTable(
  "tech_ingredients",
  {
    technology: text().notNull(),
    name: text().notNull(),
    amount: real().notNull(),
  },
  (t) => [primaryKey({ columns: [t.technology, t.name] }), index("ti_tech_idx").on(t.technology)],
);

export const meta = sqliteTable("meta", {
  key: text().primaryKey(),
  value: text(),
});

/** YAFC-style cost analysis (LP shadow prices): one row per good/recipe.
 * Goods get an intrinsic cost; recipes get their execution cost (ingredients +
 * logistics) plus two explorer measures (#97): `recipe-flow` (the dual of the
 * recipe's LP constraint — how much a sensible economy runs it) and
 * `recipe-waste` (the 0–1 share of input value the recipe destroys). Recipe
 * names can collide with item names (e.g. iron-plate), so the key is
 * (scope, name). Recomputed after every data import. */
export const costAnalysis = sqliteTable(
  "cost_analysis",
  {
    scope: text().notNull(), // good | recipe | recipe-flow | recipe-waste
    name: text().notNull(),
    kind: text().notNull(), // item | fluid | recipe
    cost: real().notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.name] })],
);

/* ── App data (scaffold demo — to be replaced by plans/tasks tables) ──────────── */
export const todos = sqliteTable("todos", {
  id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
  title: text().notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

/* ── User blocks ──────────────────────────────────────────────────────────────
 * A block = its INPUT (the recipes + per-recipe building/fuel/disposition choices,
 * stored as a JSON config doc) plus a CACHE of its solved I/O in block_flows, so
 * the factory overview aggregates across blocks without re-solving any of them.
 * The solver only runs when a block is opened/edited (save persists input + flows).
 */
/** One beacon configuration on a recipe row: which beacon variant, the modules
 * inside it, and how many of that beacon affect each machine. */
export type BeaconConfig = { beacon: string; modules: string[]; count: number };

/** One output goal of a block: a good the block is sized to produce at `rate`
 * (a solver target). A good you don't target is a byproduct, not a goal.
 * `rate` is ALWAYS per-second (the solver's canonical unit); `unit` is only the
 * display/input window the user chose for it (#10) — absent means "/s".
 *
 * A STOCK goal (#38) means "keep `stock` on hand" instead of a throughput target:
 * its rate is derived (`stock / window`, the buffer-refill window in seconds,
 * default 10 min), so the solver still sees an ordinary per-second rate — the
 * machines are sized to rebuild the buffer within the window. Its boundary flow
 * is cached with role "stock" so factory views can mark refill demands. */
export type RateUnit = "s" | "min" | "h";
export type CampaignConfidence = "expected" | "90" | "95";
export type TemporaryCampaign = {
  /** Shared planning window in seconds. Goal rates derive from quantity/window. */
  duration: number;
  /** Finite amount requested for every goal, keyed by the goal's internal name. */
  quantities: Record<string, number>;
  /** Expected-value solve, or an operational Poisson reserve for a finite target. */
  confidence: CampaignConfidence;
  /** A completed campaign remains as history while its block is disabled. */
  completedAt?: string;
};
export type Goal = {
  name: string;
  rate: number;
  /** Exact produced temperature required for a fluid goal. Missing means the
   * fluid's full real temperature range is acceptable. */
  temperature?: number;
  /** Stable intent when rate is zero. Older documents infer this from the sign. */
  direction?: "produce" | "consume";
  unit?: RateUnit;
  stock?: number; // "keep N on hand" — presence makes this a stock goal
  window?: number; // refill window in seconds (default 600); rate = stock / window
  /** Factory-computed gross production needed to cover internal consumers while
   * preserving the user's stock/window target. Effective rate is the larger. */
  factoryRate?: number;
};

export type BlockData = {
  // Output goals, each a solver target. goals[0] names the block and anchors the
  // rate-scaling tools; it's also the DEFAULT icon source. See lib/goals.ts for the
  // migration from the legacy { target, rate, extraGoals } shape.
  goals: Goal[];
  /** A finite production campaign uses the normal rate solver while active, but
   * derives each goal from a total quantity over one shared duration. */
  campaign?: TemporaryCampaign;
  // Explicit block icon (#40): any item/fluid the user picked, independent of the
  // goals. Unset = the icon follows the first goal (the pre-#40 behavior). The
  // resolved choice is cached in the blocks.icon_kind/icon_name columns on save.
  icon?: { kind: string; name: string };
  recipes: string[];
  // Recipes present in the block but toggled off (#73): kept in `recipes` (so
  // their machine/fuel/module choices survive) but excluded from the solve, so
  // they contribute no flows or machine counts. Used to A/B two recipes or to
  // stage future rows without deleting them.
  disabledRecipes?: string[];
  // Sub-blocks (#7): named, collapsible groups of recipe rows. `recipeGroups`
  // maps recipe → group id; members are kept contiguous in `recipes` order (see
  // lib/row-groups.ts). Display-only by default; a group can be PROMOTED to a
  // real, separately-solved module (#76, `composed`) with its own hidden internal
  // goals — the parent then consumes only its boundary contract (solver/subblock.ts).
  rowGroups?: {
    id: number;
    name: string;
    composed?: boolean;
    goals?: Goal[];
    made?: string[];
  }[];
  recipeGroups?: Record<string, number>;
  // Incidental spoilage estimates (#20): item → expected rot rate (/s) while
  // backed up. They do not alter the LP; spoil_result joins boundary byproducts.
  spoilRates?: Record<string, number>;
  /** Factory-level preference for this block. Higher-priority blocks satisfy
   * shared demand before lower-priority fallbacks. */
  supplyPriority?: number;
  /** Optional per-good overrides for multiproduct blocks. Missing entries
   * inherit the block-wide supplyPriority. */
  supplyPriorities?: Record<string, number>;
  // Legacy per-item overrides (pre-#91). New docs write `made`/`pins` instead;
  // a doc carrying only dispositions has its made set derived server-side on
  // solve and adopted by the editor (lazy migration).
  dispositions?: Record<string, string>;
  // Items this block claims in-block production for (#91): net ≥ 0 in the
  // solve — production covers consumption, surplus exports, imports forbidden.
  made?: string[];
  // Per-row pins (#91), in building counts: count = always run exactly N
  // buildings; cap = at most N (built ceiling); share = this consumer takes a
  // fraction of the item's production (base "remaining" = after count-pinned
  // consumers' fixed intake; default).
  pins?: (
    | { kind: "count" | "cap"; recipe: string; count: number }
    | { kind: "share"; recipe: string; item: string; share: number; base?: "total" | "remaining" }
    // drain: this recipe absorbs the item's surplus (net = 0 on the item) —
    // the byproduct-disposal gesture; the recipe names the designated sink
    | { kind: "drain"; recipe: string; item: string }
  )[];
  machines?: Record<string, string>; // recipe → chosen machine
  fuels?: Record<string, string>; // recipe → chosen fuel
  /** Per-recipe fluid routing intent. A selected temperature narrows that
   * ingredient to an exact temperature; absence keeps the prototype's accepted
   * range (Auto). Fluid prototypes themselves remain canonical. */
  fluidTemperatures?: Record<string, Record<string, number>>;
  // Reactor farm layout per reactor recipe row (#94): the assumed x×y grid whose
  // neighbour bonus scales the row's heat output (absent = 1×1, no bonus).
  reactorLayouts?: Record<string, { x: number; y: number }>;
  modules?: Record<string, string[]>; // recipe → modules in the machine's slots
  beacons?: Record<string, BeaconConfig[]>; // recipe → beacons affecting each machine
};

export const blocks = sqliteTable("blocks", {
  id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  iconKind: text("icon_kind"), // item | fluid | recipe — defaults to first product
  iconName: text("icon_name"),
  data: text({ mode: "json" }).$type<BlockData>().notNull(),
  // cached IIS diagnosis cards from the last infeasible solve (#91) — the
  // sidebar and agent tools can say WHY without re-solving; null when solved.
  // Written only by the solve path (persistBlock), like every cache column.
  solveDiagnosis: text("solve_diagnosis", { mode: "json" }).$type<
    | {
        members: {
          prov: { type: string; item?: string; recipe?: string; rate?: number; share?: number };
          shortBy: number;
        }[];
      }[]
    | null
  >(),
  // Whole-block on/off (#73): a disabled block still opens and solves for editing,
  // but is excluded from every factory-wide rollup (totals, coherence, suppliers)
  // and dimmed in the sidebar. Used to stage future blocks or park alternatives.
  enabled: bool("enabled").notNull().default(true),
  electricityW: real("electricity_w"),
  // cached last-solve pollution rollup (#23), like electricity_w — the factory
  // header sums it with zero solving; null until solved with pollution data
  pollutionPerMin: real("pollution_per_min"),
  // last solve's status (solved | relaxed | underdetermined | infeasible) so the
  // sidebar/tabs can flag a block's health without re-solving it; null until solved
  solveStatus: text("solve_status"),
  dataFingerprint: text("data_fingerprint"), // reference-data version the cache was solved against
  sortOrder: integer("sort_order"),
  groupId: integer("group_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

/** Folders for organising blocks in the sidebar (parent_id reserved for nesting). */
export const blockGroups = sqliteTable("block_groups", {
  id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  parentId: integer("parent_id"),
  sortOrder: integer("sort_order"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

/** Block snapshots (#85): named restore points for a block's full definition.
 * `data` is the block's editor doc — the SAME serialization as the export
 * envelope's `ExportedBlock.doc` (#82), with the face fields (name/icon/enabled)
 * as columns, so a snapshot row converts to an exported block trivially.
 * `kind` is "manual" (user-created, kept until deleted) or "auto" (taken before
 * destructive/structural writes — delete, restore, resize, big edits — capped at
 * the newest 20 per block). Rows deliberately survive block deletion, doubling
 * as a recycle bin. No undo triggers: snapshot bookkeeping is not a planning
 * edit (#90) — only a RESTORE (which writes the blocks table) is undoable. */
export const blockSnapshots = sqliteTable(
  "block_snapshots",
  {
    id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
    blockId: integer("block_id").notNull(),
    kind: text().notNull(), // "manual" | "auto"
    label: text(), // user's label (manual) or what triggered it (auto)
    name: text().notNull(), // block name at capture
    iconKind: text("icon_kind"),
    iconName: text("icon_name"),
    enabled: bool("enabled").notNull().default(true),
    data: text({ mode: "json" }).$type<BlockData>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  },
  (t) => [index("block_snapshots_block_idx").on(t.blockId)],
);

/** TURD recipe replacements (exported by the pyops-dump helper as mod-data):
 * selecting `subTech` swaps `oldRecipe` for `newRecipe` in-game, so the old
 * one should be demoted in pickers once the choice is made. */
export const turdReplacements = sqliteTable(
  "turd_replacements",
  {
    subTech: text("sub_tech").notNull(),
    oldRecipe: text("old_recipe").notNull(),
    newRecipe: text("new_recipe").notNull(),
  },
  (t) => [primaryKey({ columns: [t.subTech, t.oldRecipe] }), index("tr_old_idx").on(t.oldRecipe)],
);

/** The player's TURD choice per master tech (one sub-tech each, or none). */
export const turdSelections = sqliteTable("turd_selections", {
  masterTech: text("master_tech").primaryKey(),
  subTech: text("sub_tech").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

/** Saved module+beacon loadouts, applied to a recipe row in one click.
 * `icon` is the module item shown on the preset's chip (derived from the
 * loadout at save time). `isDefault` marks a template to auto-apply to NEW
 * recipe rows: the first compatible default (name order) is baked into the
 * row's picks at add time, falling back to auto-fill when none fits. */
export const modulePresets = sqliteTable("module_presets", {
  id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  modules: text({ mode: "json" }).$type<string[]>().notNull(),
  beacons: text({ mode: "json" }).$type<BeaconConfig[]>().notNull(),
  icon: text(),
  isDefault: bool("is_default").notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

/** Cached solved I/O per block — the factory index aggregates this. */
export const blockFlows = sqliteTable(
  "block_flows",
  {
    blockId: integer("block_id").notNull(),
    item: text().notNull(),
    kind: text().notNull(), // item | fluid
    role: text().notNull(), // primary | byproduct | import
    rate: real().notNull(),
    /** Planner-only fluid identity at the block boundary. Exact producers have
     * min=max; range consumers keep their accepted bounds. Null mode is a
     * temperature-insensitive good or a legacy cache awaiting re-solve. */
    temperatureMode: text("temperature_mode").$type<"exact" | "range">(),
    minTemp: real("min_temp"),
    maxTemp: real("max_temp"),
  },
  (t) => [index("bf_item_role_idx").on(t.item, t.role), index("bf_block_idx").on(t.blockId)],
);

/** Cached machine requirement per block — how many of each machine the block's
 * solve needs (fractional), per RECIPE that machine runs. Recipe-keyed so the
 * factory can ask "how many furnaces do I need smelting iron" rather than just
 * "how many furnaces". Mirrors block_flows; compared against built_machines. */
export const blockMachines = sqliteTable(
  "block_machines",
  {
    blockId: integer("block_id").notNull(),
    machine: text().notNull(),
    recipe: text().notNull(), // the recipe this machine count is for
    count: real().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.blockId, t.machine, t.recipe] }),
    index("bm_machine_idx").on(t.machine),
  ],
);

/** How many of each machine the player has actually built, keyed by the recipe
 * it's set to craft (empty string = no/unknown recipe: idle furnaces, mining
 * drills, labs). Pushed from the game over the bridge (state.built). Authoritative
 * full snapshot — replace, not merge. */
export const builtMachines = sqliteTable(
  "built_machines",
  {
    name: text().notNull(),
    recipe: text().notNull(),
    count: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.name, t.recipe] })],
);

/** Live per-second production/consumption rates from the game's flow statistics,
 * pushed over the bridge (state.stats). Force-wide (summed across surfaces) — the
 * factory ledger compares these actuals against its planned rates. Authoritative
 * full snapshot — replace, not merge. */
export const productionStats = sqliteTable("production_stats", {
  name: text().primaryKey(),
  kind: text().notNull(), // item | fluid
  produced: real().notNull(), // items/s actually made (last-minute average)
  consumed: real().notNull(), // items/s actually used
});

/* ── Assistant conversations (persisted chats) ──────────────────────────
 * Per-project: a chat history you can leave and resume. `parts` is the
 * JSON-serialized AI-SDK UIMessage parts; `seq` orders messages within a chat.
 * Provisioned on existing project dbs by an idempotent ensure (see
 * db/conversations.ts) so they don't need a manual push. */
export const conversations = sqliteTable("conversations", {
  id: text().primaryKey(), // client-generated uuid
  title: text(),
  model: text(), // optional per-conversation model override
  reasoningEffort: text("reasoning_effort"), // optional OpenRouter reasoning effort
  // Real token usage from the most recent completed turn, straight from
  // OpenRouter. Anchors compaction + the context gauge to actual counts instead
  // of a chars/4 estimate. `last_model_id` is the concrete model that served it
  // (a `~…-latest` alias resolves to e.g. anthropic/claude-sonnet-4.6).
  lastInputTokens: integer("last_input_tokens"),
  lastOutputTokens: integer("last_output_tokens"),
  lastTotalTokens: integer("last_total_tokens"),
  lastModelId: text("last_model_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

export const conversationMessages = sqliteTable(
  "conversation_messages",
  {
    id: text().primaryKey(), // the UIMessage id
    conversationId: text("conversation_id").notNull(),
    role: text().notNull(), // user | assistant | system
    parts: text().notNull(), // JSON-stringified AI-SDK UIMessage parts
    seq: integer().notNull(), // order within the conversation
  },
  (t) => [index("cm_conv_idx").on(t.conversationId)],
);

/* ── Tasks & notes ──────────────────────────────────────────────────────
 * Per-project planning aids, distinct from this repo's GitHub issue tracker (which
 * is for dev work).
 *
 * A `task` is a "thing to do": a title + markdown description, its own checklist
 * of `task_steps`, and optionally child tasks (self-FK via parent_id) for bigger
 * breakdowns — a "milestone" is simply a parent task. Children render as an
 * indented checklist on their parent and are themselves full tasks you can open.
 *
 * `notes` are a separate, deliberately-dumb scratch surface (quick calcs,
 * reminders) — title + free-form body, no hierarchy.
 *
 * Entity links (a task → recipe/item/fluid/research/block/…) and assistant tools
 * come in a later pass. Provisioned on existing project dbs by an idempotent
 * ensure (db/tasks.ts) so they don't need a manual push. */
export const tasks = sqliteTable(
  "tasks",
  {
    id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
    parentId: integer("parent_id"), // self-FK: this task is a child (subtask) of another
    title: text(),
    body: text(), // markdown description of what to do
    // workflow state: open | in_progress | done | closed (closed = don't care). The
    // legacy `done` bool is kept in lockstep (done === status==='done') for compat.
    status: text().notNull().default("open"),
    done: bool("done").notNull().default(false),
    // advisory LLM-assigned priority (low|medium|high|critical, null = unranked) —
    // computed/recomputable state, never user-owned truth.
    priority: text(),
    priorityReason: text("priority_reason"),
    priorityAt: integer("priority_at", { mode: "timestamp" }),
    sortOrder: integer("sort_order"),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  },
  (t) => [index("task_parent_idx").on(t.parentId)],
);

/** Lightweight checklist steps within a task — its own to-do items, distinct from
 * child tasks (which are full tasks shown indented). */
export const taskSteps = sqliteTable(
  "task_steps",
  {
    id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
    taskId: integer("task_id").notNull(),
    text: text().notNull(),
    done: bool("done").notNull().default(false),
    sortOrder: integer("sort_order"),
  },
  (t) => [index("task_steps_task_idx").on(t.taskId)],
);

/** Free-form scratch notes — a separate surface from tasks (no steps, no tree). */
export const notes = sqliteTable("notes", {
  id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
  title: text(),
  body: text(), // markdown-ish scratch content
  sortOrder: integer("sort_order"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

/* ── Undo system (#90) ──────────────────────────────────────────────────
 * Trigger-based inverse log per sqlite.org/undoredo.html: AFTER INSERT/UPDATE/
 * DELETE triggers on the USER-PLANNING tables (blocks, block_groups,
 * module_presets, tasks, task_steps, task_links, notes — never imported
 * reference data, caches like block_flows/block_machines, or the undo tables
 * themselves) write the inverse SQL statement into `undo_log`. The triggers
 * live in the migration (drizzle can't model triggers); they only fire while a
 * row exists in `undo_current` — the current-action marker opened by
 * `withUndoAction` (server/undo.server.ts) — so any write that bypasses the
 * wrapper is simply untracked (fail-soft), never logged as an orphan.
 *
 * NOTE: adding a column to a triggered table requires regenerating that
 * table's triggers in the same migration — `undo.test.ts` has a coverage
 * check that fails when a trigger goes stale. */

/** One undo step = one user action (possibly many row changes). Linear stack:
 * undo pops strictly from the top. Retention keeps the last 50. */
export const undoActions = sqliteTable("undo_actions", {
  id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text().notNull(), // human description ("Delete block \"Iron Pulp\"")
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

/** Inverse statements, written by the triggers. Executing an action's rows in
 * reverse id order inside one transaction reverts the action. `tbl`/`rowId`
 * identify the touched row so undoLast can report changed block ids. */
export const undoLog = sqliteTable(
  "undo_log",
  {
    id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
    actionId: integer("action_id").notNull(),
    tbl: text().notNull(),
    rowId: integer("row_id").notNull(),
    stmt: text().notNull(), // the inverse SQL statement
  },
  (t) => [index("undo_log_action_idx").on(t.actionId)],
);

/** The current-action marker: at most one row (id = 1). Present only while a
 * tracked `withUndoAction` runs; the triggers' WHEN clause checks it. */
export const undoCurrent = sqliteTable("undo_current", {
  id: integer({ mode: "number" }).primaryKey(),
  actionId: integer("action_id").notNull(),
});

/** Entity links on a task: a polymorphic reference to a domain object, rendered
 * as an icon+display chip. `ref_kind` selects how `ref_name` resolves — an
 * internal name for item/fluid/recipe/technology, or the block id (as text) for
 * a block. (plan / in-world-entity / assistant-conversation refs come later.) */
export const taskLinks = sqliteTable(
  "task_links",
  {
    id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
    taskId: integer("task_id").notNull(),
    refKind: text("ref_kind").notNull(), // item | fluid | recipe | technology | block
    refName: text("ref_name").notNull(), // internal name, or block id as text
    sortOrder: integer("sort_order"),
  },
  (t) => [
    index("task_links_task_idx").on(t.taskId),
    index("task_links_ref_idx").on(t.refKind, t.refName),
  ],
);
