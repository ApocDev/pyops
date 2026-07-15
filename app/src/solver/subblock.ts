/**
 * Sub-blocks v2 (#76): real composition — a group of recipe rows solved as its
 * OWN small block (its own hidden internal goals + made set + pins), exposing
 * only its boundary flows to the parent.
 *
 * Where #7 sub-blocks are display-only (the parent solve still sees the flat
 * recipe set), a COMPOSED sub-block is a separately-solved module:
 *   1. its member recipes are solved with `solveBlockLp` exactly like a
 *      top-level block — internal goals size it, its intermediates stay hidden;
 *   2. the solve's net imports/exports (at the solved rates, with temperature
 *      qualifiers retained) become a synthetic "recipe" — ingredients = net imports, products =
 *      net exports INCLUDING the module's goal output — with `energyRequired` =
 *      the module's total machine-seconds so the parent's objective weighs its
 *      real cost;
 *   3. the parent then solves normally over its REAL recipes + these synthetic
 *      sub-block recipes, scaling each module as a single black box.
 *
 * The module's internal goals are NOT parent goals: the parent consumes the
 * module's output the way it consumes any recipe product (surplus exports as a
 * byproduct, so co-products stay visible; intermediates never surface). A
 * sub-block's members are a subset of one parent block's recipes and are solved
 * first, in isolation — a sub-block can never depend on its parent, so the whole
 * thing stays deterministic and cycle-safe.
 *
 * Pure module — no db, no React — so the nested-solve contract is unit-tested in
 * isolation (subblock.test.ts), including the flat-equivalence property: a
 * 2-level compose reproduces the equivalent flat block's boundary flows.
 */
import { solveBlockLp, type Flow, type LpBlockResult, type Pin, type RecipeDef } from "./lp.ts";
import { expandTemps, type TempFold, type TempRecipeDef } from "./temps.ts";
import type { TemperatureQualifier } from "./temperature-flow.ts";

/** Flows below this are solver noise, not real boundary traffic. */
const EPS = 1e-9;

/** Internal-only synthetic-recipe name for a composed group (never rendered as a
 * row — the group header stands in for it). The separator can't occur in a real
 * recipe id. */
const SYN_PREFIX = "subblock";
export const syntheticRecipeName = (id: number) => `${SYN_PREFIX}${id}`;
export const isSyntheticSubName = (name: string) => name.startsWith(SYN_PREFIX);
/** The group id behind a synthetic sub-block recipe name, or null. */
export const syntheticSubId = (name: string): number | null =>
  isSyntheticSubName(name) ? Number(name.slice(SYN_PREFIX.length)) : null;

/** One composed group to solve as a module. `members` are the LIVE member recipe
 * names (present in the parent `defs`, i.e. not disabled). `made === undefined`
 * means "auto": every good any member produces is claimed in-block, so the module
 * makes its own intermediates and imports only true raws. */
export type ComposedGroup = {
  id: number;
  name: string;
  members: string[];
  goals: { name: string; rate: number }[];
  made?: string[];
  pins?: Pin[];
};

/** A solved composed sub-block: its nested solve, the base-name boundary contract
 * with structured temperature qualifiers, and the synthetic recipe the parent consumes. */
export type SubBlockSolve = {
  id: number;
  name: string;
  status: LpBlockResult["status"];
  message?: string;
  /** the nested solve over the member recipes (temp-expanded rates; temp
   * selectors still present — fold via `.fold`) */
  result: LpBlockResult;
  fold: TempFold;
  /** net imports of the module at the solved scale (base names + qualifiers) */
  imports: (Flow & TemperatureQualifier)[];
  /** net exports — goal output PLUS forced co-products (base names + qualifiers) */
  exports: (Flow & TemperatureQualifier)[];
  /** total machine-seconds/s at the solved scale — the synthetic recipe's cost */
  machineSeconds: number;
  /** module goals / made marks with no in-module producer (bare names) */
  unmade: string[];
  /** the parent-facing synthetic recipe (ingredients = imports, products = exports) */
  synthetic: TempRecipeDef;
};

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : 1);

/** Every good any recipe in `defs` produces (amount > 0). The auto-`made` set for
 * a module: it covers its own intermediates and only imports true raws. */
export const producedGoods = (defs: RecipeDef[]): string[] => {
  const out = new Set<string>();
  for (const d of defs) for (const p of d.products) if (p.amount > 0) out.add(p.name);
  return [...out];
};

/** Solve one composed sub-block and derive its boundary contract + synthetic
 * recipe. `defs` are the module's member RecipeDefs (already effect-adjusted by
 * the caller). Pure aside from the shared HiGHS solve. */
export async function solveSubBlock(
  group: ComposedGroup,
  defs: TempRecipeDef[],
  defaultTemp: (fluid: string) => number | null,
): Promise<SubBlockSolve> {
  const made = group.made ?? producedGoods(defs);
  const { input, fold } = expandTemps(
    { goals: group.goals, recipes: defs, made, pins: group.pins ?? [] },
    defaultTemp,
  );
  const result = await solveBlockLp(input);

  // Boundary contract: the RAW net per good over the (temp-expanded) member
  // recipes at the solved rates, folded to bare fluid names. Taking the raw net
  // — not the solver's exports, which subtract the goal's own rate — means the
  // module's goal output is a PRODUCT of the contract (what physically leaves the
  // module for the parent to consume), while forced co-products stay visible and
  // intermediates cancel. Temp selectors net to zero on their bare fluid.
  const rateOf = new Map(result.recipes.map((r) => [r.recipe, r.rate]));
  const net = new Map<string, { kind: string; rate: number }>();
  const add = (name: string, kind: string, delta: number) => {
    const cur = net.get(name) ?? { kind, rate: 0 };
    cur.rate += delta;
    net.set(name, cur);
  };
  for (const d of input.recipes) {
    const rate = rateOf.get(d.name) ?? 0;
    if (Math.abs(rate) < EPS) continue;
    for (const ing of d.ingredients) add(ing.name, ing.kind, -ing.amount * rate);
    for (const p of d.products) add(p.name, p.kind, (p.amount ?? 0) * (p.probability ?? 1) * rate);
  }
  const selectorInputs = new Map<string, { temperature: number; rate: number }[]>();
  for (const row of result.recipes) {
    const selector = fold.selectorOf(row.recipe);
    if (!selector || row.rate <= EPS) continue;
    const inputs = selectorInputs.get(selector.pool) ?? [];
    inputs.push({ temperature: selector.temperature, rate: row.rate });
    selectorInputs.set(selector.pool, inputs);
  }
  const imports: (Flow & TemperatureQualifier)[] = [];
  const exports: (Flow & TemperatureQualifier)[] = [];
  for (const [key, e] of net) {
    const name = fold.bare(key);
    const qualifier = fold.qualifierOf(key);
    const temperature = qualifier
      ? {
          temperatureMode: qualifier.mode,
          minTemp: qualifier.minTemp,
          maxTemp: qualifier.maxTemp,
        }
      : {};
    if (e.rate < -EPS) imports.push({ name, kind: e.kind, rate: -e.rate, ...temperature });
    else if (e.rate > EPS && qualifier?.mode === "range") {
      const inputs = selectorInputs.get(key) ?? [];
      const total = inputs.reduce((sum, input) => sum + input.rate, 0);
      if (total > EPS)
        for (const input of inputs)
          exports.push({
            name,
            kind: e.kind,
            rate: (e.rate * input.rate) / total,
            temperatureMode: "exact",
            minTemp: input.temperature,
            maxTemp: input.temperature,
          });
      else exports.push({ name, kind: e.kind, rate: e.rate, ...temperature });
    } else if (e.rate > EPS) exports.push({ name, kind: e.kind, rate: e.rate, ...temperature });
  }
  imports.sort(byName);
  exports.sort(byName);

  const machineSeconds = result.recipes.reduce((s, r) => s + Math.max(0, r.machines1x), 0);
  const synthetic: TempRecipeDef = {
    name: syntheticRecipeName(group.id),
    energyRequired: machineSeconds,
    ingredients: imports.map((f) => ({
      kind: f.kind,
      name: f.name,
      amount: f.rate,
      minTemp: f.minTemp,
      maxTemp: f.maxTemp,
    })),
    products: exports.map((f) => ({
      kind: f.kind,
      name: f.name,
      amount: f.rate,
      temperature: f.temperatureMode === "exact" ? f.minTemp : null,
    })),
  };
  const unmade = [...new Set((result.unmade ?? []).map((u) => fold.bare(u)))];
  return {
    id: group.id,
    name: group.name,
    status: result.status,
    ...(result.message ? { message: result.message } : {}),
    result,
    fold,
    imports,
    exports,
    machineSeconds,
    unmade,
    synthetic,
  };
}

/** Solve every composed group and assemble the parent's recipe set: the parent
 * keeps its own (non-member) recipes and gains one synthetic recipe per module.
 * Member recipes and pins are routed into their module. Returns everything the
 * caller needs to run the parent solve and then scale each module's member rows
 * by the parent's chosen run-rate of its synthetic. */
export async function composeSubBlocks(args: {
  defs: TempRecipeDef[];
  groups: ComposedGroup[];
  pins: Pin[];
  defaultTemp: (fluid: string) => number | null;
}): Promise<{
  parentDefs: TempRecipeDef[];
  parentPins: Pin[];
  subs: SubBlockSolve[];
  /** live member recipe → its group id */
  memberGroupOf: Map<string, number>;
}> {
  const defByName = new Map(args.defs.map((d) => [d.name, d]));
  const memberGroupOf = new Map<string, number>();
  for (const g of args.groups)
    for (const m of g.members) if (defByName.has(m)) memberGroupOf.set(m, g.id);

  const subs: SubBlockSolve[] = [];
  for (const g of args.groups) {
    const members = g.members.filter((m) => defByName.has(m));
    if (!members.length) continue; // a composed group with no live members is inert
    const memberSet = new Set(members);
    const memberDefs = members.map((m) => defByName.get(m)!);
    const memberPins = args.pins.filter((p) => memberSet.has(p.recipe));
    subs.push(
      await solveSubBlock({ ...g, members, pins: memberPins }, memberDefs, args.defaultTemp),
    );
  }

  const parentDefs = [
    ...args.defs.filter((d) => !memberGroupOf.has(d.name)),
    ...subs.map((s) => s.synthetic),
  ];
  const parentPins = args.pins.filter((p) => !memberGroupOf.has(p.recipe));
  return { parentDefs, parentPins, subs, memberGroupOf };
}
