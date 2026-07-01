/**
 * Read-only tools the planning agent calls to interrogate the Pyanodons data.
 *
 * These are thin, token-economical wrappers over the query layer (db/queries.ts):
 * they resolve fuzzy names, rank recipe candidates, and classify additives — the
 * minimum surface to reason about "how do I make X" without mutating anything.
 * The query layer is imported dynamically so better-sqlite3 stays server-only.
 *
 * The same tool bodies back two front doors: this in-app agent (Vercel AI SDK)
 * and the MCP route (`routes/mcp.ts`), which registers every tool in `agentTools`
 * for external MCP clients (e.g. Claude driving the running game to debug the
 * integration). Keep them pure-ish.
 */
import { tool } from "ai";
import { z } from "zod";

import { classifyAdditive } from "./additives.ts";
import { normalizeBlockData, primaryGoal, primaryRate } from "../lib/goals.ts";

const lib = () => import("../db/queries.ts");
const tasksLib = () => import("../db/tasks.ts");
const bridge = () => import("./bridge/inspect.ts");
const gameLib = () => import("./factorio.ts");

/** Electricity & heat are energy pseudo-fluids surfaced separately as powerW/heatW.
 * recipeIo (and thus the stoichiometric chainStatus) never lists them as recipe
 * ingredients, so they must be filtered from open-inputs/byproducts; in submitBlock
 * they're likewise dropped from the solver's import list (shown via powerW/heatW). */
const PSEUDO_GOODS = new Set(["pyops-electricity", "pyops-heat"]);

/** "100 molten-iron + 3 borax" — compact io for the model (internal names = stable handles). */
function io(parts: { name: string; amount: number }[]): string {
  if (!parts.length) return "—";
  return parts.map((p) => `${+p.amount.toFixed(3)} ${p.name}`).join(" + ");
}

export const searchGoods = tool({
  description:
    "Resolve a fuzzy item/fluid name to its internal name(s). Always call this first to get the exact internal name (e.g. 'iron-plate') before using other tools — never guess names.",
  inputSchema: z.object({
    query: z.string().describe("Partial or display name, e.g. 'iron plate' or 'molten'"),
    limit: z.number().int().min(1).max(40).default(15),
  }),
  execute: async ({ query, limit }) => {
    const q = await lib();
    return q
      .searchAll(query, limit)
      .map((g) => ({ name: g.name, display: g.display, kind: g.kind }));
  },
});

export const factoryBlocks = tool({
  description:
    "List the blocks that already exist in the user's factory: what each PRODUCES (makes/primary), has spare (byproducts), and imports. Consult this BEFORE drafting — if an existing block already makes a good you need, import it from that block instead of rebuilding it. recipeGraph already marks goods covered by a block; this gives the fuller picture (rates, byproducts you could consume).",
  inputSchema: z.object({}),
  execute: async () => (await lib()).factoryBlocks(),
});

/* ── Speculative production graph (seam-based, factory-aware) ──────────────── */

// A good with at least this many distinct consumers is a "global product" — a
// natural seam (make once, distribute) rather than something to build inline.
const SEAM_FANOUT = 25;

export const recipeGraph = tool({
  description:
    "Production graph for a target good — the way to PLAN a chain. In ONE call it walks the recipes that build the target and returns a FLAT map { good -> {candidates|leaf} } (cycle-safe; reconstruct the tree by following each candidate's `in` names). It expands the block's private intermediates and STOPS at natural SEAMS, which it marks for you: global products (high fan-out — shared by many recipes), raw resources, goods already produced by an existing block (fromBlock), the depth limit, and a node budget. A good used by only ~1 recipe is private and stays inline (even fluids). Seams are where you decide: import (from an existing block or external) / make a separate sub-block / or expand inline (call recipeGraph again on that good). YOU choose the cuts — the marks are signals. Each node carries consumers (fan-out), fluid, additive, and fromBlock. Use this FIRST when drafting; then submitBlock.",
  inputSchema: z.object({
    target: z.string().describe("Internal good name to build, e.g. 'iron-plate'"),
    depth: z.number().int().min(1).max(20).default(14).describe("Max depth to expand"),
    candidatesPerGood: z.number().int().min(1).max(10).default(6),
    nodeBudget: z
      .number()
      .int()
      .min(10)
      .max(150)
      .default(55)
      .describe("Stop expanding after this many goods (keeps complex targets bounded)"),
  }),
  execute: async ({ target, depth, candidatesPerGood, nodeBudget }) => {
    const q = await lib();
    const suppliers = q.goodSuppliers(); // good -> existing blocks that output it
    const cutoff = q.spoilImportCutoff();
    const goods: Record<string, unknown> = {};
    const seen = new Set<string>([target]);
    const queue: { good: string; d: number }[] = [{ good: target, d: 0 }];
    while (queue.length && Object.keys(goods).length < nodeBudget) {
      const { good, d } = queue.shift()!;
      const counts = q.goodGraphCounts(good);
      const verdict = classifyAdditive(good, counts.consumers);
      const fluid = !!q.getFluid(good);
      const supplier = suppliers.get(good);
      const fromBlock = supplier?.map((s) => ({ block: s.blockName, id: s.blockId, role: s.role }));
      // barreling recipes are storage plumbing, not production
      const cands = q.recipeCandidates(good, "produce").filter((r) => !r.name.includes("barrel"));

      // SEAM TEST — a good is a seam when it's SHARED (high fan-out), already
      // made, raw, or out of budget. Fan-out is the signal, NOT fluid-ness: a
      // good used by ~1 recipe is private and builds inline even if it's a fluid.
      const seamReason =
        good === target
          ? null
          : cands.length === 0
            ? "raw / no recipe — import"
            : fromBlock
              ? `made by block ${fromBlock.map((b) => `#${b.id} ${b.block}`).join(", ")} — import from there`
              : counts.consumers >= SEAM_FANOUT
                ? `global product (${counts.consumers} consumers) — seam: import or own block`
                : d >= depth
                  ? "depth limit"
                  : null;

      const spoil = q.goodSpoilage(good); // can't be imported from afar if it rots fast
      const node: Record<string, unknown> = {
        kind: fluid ? "fluid" : "item",
        consumers: counts.consumers,
        additive: verdict.additive,
        ...(fromBlock ? { fromBlock } : {}),
        ...(spoil ? { spoils: { ...spoil, mustBeLocal: spoil.seconds < cutoff } } : {}),
      };

      if (seamReason) {
        goods[good] = { ...node, leaf: true, seam: seamReason };
      } else {
        const picked = cands.slice(0, candidatesPerGood);
        goods[good] = {
          ...node,
          candidates: picked.map((r) => ({
            recipe: r.name,
            availableNow: r.avail.availableNow,
            buildableNow: r.avail.buildableNow, // turd ACTIVE — no unmade pick (NOW planning)
            research: r.avail.research, // enabled | available | needs-research
            needsResearch: r.avail.needs.length ? r.avail.needs : undefined,
            turd: r.turd
              ? {
                  master: r.turd.masterDisplay ?? r.turd.master,
                  choice: r.turd.display,
                  state: r.avail.turd?.state, // active | pickable | blocked
                }
              : undefined,
            cost: r.cost,
            prod: r.allowProductivity,
            in: io(r.ingredients),
            out: io(r.products),
          })),
        };
        for (const r of picked)
          for (const ing of r.ingredients)
            if (!ing.name.endsWith("-barrel") && !seen.has(ing.name)) {
              seen.add(ing.name);
              queue.push({ good: ing.name, d: d + 1 });
            }
      }
    }
    // goods enqueued but not reached before the budget ran out
    const unexpanded = queue.map((x) => x.good);
    return {
      target,
      goodCount: Object.keys(goods).length,
      budgetHit: Object.keys(goods).length >= nodeBudget,
      unexpanded, // frontier left when the budget ran out — candidate sub-blocks
      legend:
        "Flat map good -> producers. Nodes with 'candidates' are build-inside-this-block intermediates; nodes with 'leaf'+'seam' are where to cut — decide import (fromBlock = an existing block already makes it) / separate sub-block / or expand inline by calling recipeGraph on that good. 'consumers' = fan-out; 'additive' = reads like a commodity; cost is a tie-break hint, prefer correct tier; prod = productivity modules allowed.",
      goods,
    };
  },
});

/** Shape the ranked candidates for one good (shared by recipeOptions + the batch form). */
function optionsFor(
  q: Awaited<ReturnType<typeof lib>>,
  good: string,
  direction: "produce" | "consume",
  limit: number,
) {
  return q
    .recipeCandidates(good, direction)
    .slice(0, limit)
    .map((r) => {
      // representative building: the fastest machine in the recipe's category,
      // annotated with its OWN availability (top-tier machines are tech-gated too).
      const machines = q.machineOptionsForRecipe(r.name);
      const best = machines.length
        ? machines.reduce((a, b) => (b.craftingSpeed > a.craftingSpeed ? b : a))
        : null;
      const avail = best
        ? best.startEnabled
          ? "available"
          : best.unlockedBy.length
            ? `needs ${best.unlockedBy
                .map((u) => u.display ?? u.tech)
                .slice(0, 2)
                .join(", ")}`
            : "unreachable"
        : null;
      const machine = best
        ? `${best.display ?? best.name} · ${best.craftingSpeed}× · ${best.moduleSlots} mod slots` +
          `${best.energyUsageW ? ` · ${Math.round(best.energyUsageW / 1000)}kW` : ""}` +
          ` · ${avail}` +
          `${machines.length > 1 ? ` (+${machines.length - 1} tiers)` : ""}`
        : null;
      return {
        recipe: r.name,
        display: r.display ?? r.name,
        available: r.available,
        lockState: r.enabled
          ? "start-enabled"
          : r.turd
            ? r.turd.turdSelected
              ? "turd-active"
              : "turd-unselected"
            : r.unlocks.length
              ? "tech-locked"
              : "unreachable",
        cost: r.cost,
        prod: r.allowProductivity, // can run productivity modules — often the deciding factor at scale
        machine, // building · craft speed · module slots · power
        // availability vs the user's planning horizon (now vs future)
        availableNow: r.avail.availableNow, // research reached, turd not blocked (pickable counts)
        buildableNow: r.avail.buildableNow, // stricter: turd ACTIVE — no unmade pick (NOW planning)
        research: r.avail.research, // enabled | available | needs-research
        needsResearch: r.avail.needs.length ? r.avail.needs : undefined, // gating science packs
        unlockedBy: r.enabled
          ? null
          : r.unlocks.map((u) => u.display ?? u.tech).join(" / ") || null,
        turd: r.turd
          ? {
              master: r.turd.masterDisplay ?? r.turd.master,
              choice: r.turd.display,
              state: r.avail.turd?.state, // active | pickable | blocked
            }
          : null,
        superseded: r.superseded ?? undefined,
        in: io(r.ingredients),
        out: io(r.products),
      };
    });
}

export const recipeOptions = tool({
  description:
    "List the recipes that PRODUCE (or CONSUME) a good, ranked the way the picker ranks them: available first (cheapest by cost analysis within a tier), then tech-locked, then unselected TURD choices, with barrel fill/empty last. Each candidate already includes its inputs (in), outputs (out), lock state, cost, and unlocking tech — so you rarely need recipeInfo afterward. Cost is an LP shadow price — a HINT for tie-breaking, NOT the deciding factor: the right recipe is usually about the correct production TIER and chain, not the cheapest. To resolve SEVERAL goods at once, prefer recipeOptionsBatch.",
  inputSchema: z.object({
    good: z.string().describe("Internal good name (from searchGoods), e.g. 'molten-iron'"),
    direction: z
      .enum(["produce", "consume"])
      .default("produce")
      .describe("'produce' = recipes that make it; 'consume' = recipes that use it"),
    limit: z.number().int().min(1).max(25).default(12),
  }),
  execute: async ({ good, direction, limit }) => optionsFor(await lib(), good, direction, limit),
});

export const recipeOptionsBatch = tool({
  description:
    "Like recipeOptions but for MANY goods in one call — the efficient way to expand a chain. When chainStatus (or a recipe's inputs) reveals several goods that still need a producer, pass them ALL here at once instead of calling recipeOptions repeatedly. Returns a map of good -> ranked candidates (same fields as recipeOptions). Use the internal names exactly as they appear in tool results.",
  inputSchema: z.object({
    goods: z
      .array(z.string())
      .min(1)
      .max(30)
      .describe(
        "Internal good names to look up producers for, e.g. ['sintered-iron','reduced-iron']",
      ),
    direction: z.enum(["produce", "consume"]).default("produce"),
    limitEach: z
      .number()
      .int()
      .min(1)
      .max(15)
      .default(8)
      .describe("Max candidates per good (keep modest when batching many goods)"),
  }),
  execute: async ({ goods, direction, limitEach }) => {
    const q = await lib();
    const out: Record<string, ReturnType<typeof optionsFor>> = {};
    for (const g of new Set(goods)) out[g] = optionsFor(q, g, direction, limitEach);
    return out;
  },
});

export const recipeInfo = tool({
  description:
    "Full detail for one recipe: exact ingredients/products with amounts, energy/time, category, cost, and unlock state (the techs that unlock it, their science-pack cost, and any TURD master›choice it belongs to). `turd` lists the FULL branch set of every TURD master that affects this recipe — whether the recipe is a branch's new unlock OR a base recipe some branch replaces — so you see all sibling choices, not just this one. Use after recipeOptions to inspect a specific candidate.",
  inputSchema: z.object({
    recipe: z.string().describe("Internal recipe name, e.g. 'molten-iron-01'"),
  }),
  execute: async ({ recipe }) => {
    const q = await lib();
    const r = q.getRecipe(recipe);
    if (!r) return { error: `no recipe '${recipe}'` };
    const cost = q.recipeCosts([recipe]).get(recipe) ?? null;
    const unlocks = q.recipeLockState(recipe).map((u) => ({
      tech: u.tech,
      techDisplay: u.display,
      science: u.science.map((s) => `${s.amount} ${s.name}`),
      turd: u.isTurdSub ? { master: u.masterDisplay ?? u.master, selected: u.turdSelected } : null,
    }));
    const machines = q.machineOptionsForRecipe(recipe).map((m) => ({
      machine: m.display ?? m.name,
      kind: m.kind,
      speed: m.craftingSpeed,
      moduleSlots: m.moduleSlots,
      kW: m.energyUsageW ? Math.round(m.energyUsageW / 1000) : null,
      energySource: m.energySource,
      available: m.startEnabled || m.unlockedBy.length > 0,
      unlockedBy: m.startEnabled ? null : m.unlockedBy.map((u) => u.display ?? u.tech),
    }));
    const fuel = q.fuelOptionsForRecipe(recipe); // burner fuels w/ ash, or null (electric)
    return {
      recipe: r.name,
      display: r.display ?? r.name,
      category: r.category,
      craftingTime: r.energyRequired, // seconds at 1× speed
      enabled: r.enabled,
      cost,
      prod: r.allowProductivity,
      machines,
      fuel, // null = electric; else { categories, fuels:[{fuel, ash, mj}] } — ash != null means it makes ash
      spoils: q.goodSpoilage(r.name),
      in: r.ingredients.map((c) => ({ name: c.name, amount: c.amount ?? 0, kind: c.kind })),
      out: r.products.map((c) => ({
        name: c.name,
        amount:
          c.amount ??
          (c.amountMin != null && c.amountMax != null ? (c.amountMin + c.amountMax) / 2 : 0),
        kind: c.kind,
        probability: c.probability,
      })),
      unlocks,
      // Full branch set of every TURD master touching this recipe (empty if none).
      turd: q.turdChoicesLookup({ recipe }),
    };
  },
});

export const goodInfo = tool({
  description:
    "Facts about a good: cost, kind (item/fluid), how many recipes produce vs consume it (fan-out), and whether it should be treated as an IMPORTED additive/commodity or BUILT as a chain intermediate. Use this to decide whether to recurse into making an input or just import it.",
  inputSchema: z.object({
    good: z.string().describe("Internal good name, e.g. 'pressured-air'"),
  }),
  execute: async ({ good }) => {
    const q = await lib();
    const item = q.getItem(good);
    const fluid = q.getFluid(good);
    if (!item && !fluid) return { error: `no good '${good}'` };
    const counts = q.goodGraphCounts(good);
    const verdict = classifyAdditive(good, counts.consumers);
    return {
      good,
      display: item?.display ?? fluid?.display ?? good,
      kind: fluid ? "fluid" : "item",
      cost: q.goodCosts([good]).get(good) ?? null,
      producers: counts.producers,
      consumers: counts.consumers,
      additive: verdict.additive,
      classification: verdict.reason,
      spoils: q.goodSpoilage(good), // {into, seconds} | null — fast-spoiling => build local
    };
  },
});

export const byproductSinks = tool({
  description:
    "Where a byproduct can GO — for routing the outputs a block produces but doesn't consume (tailings, ash, sludge, off-gases). Returns recipes that CONSUME the good (with what they make + availability) and existing blocks that already IMPORT it (route the byproduct there). If nothing consumes it, it must be voided/flushed. Use this on each byproduct from chainStatus so the block's waste has a home.",
  inputSchema: z.object({
    good: z.string().describe("Internal good name of the byproduct, e.g. 'tailings'"),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  execute: async ({ good, limit }) => {
    const q = await lib();
    const consumers = q.recipeCandidates(good, "consume").slice(0, limit);
    return {
      good,
      spoils: q.goodSpoilage(good),
      importingBlocks: q.blockImporters(good), // existing sinks to route to
      consumedBy: consumers.map((r) => ({
        recipe: r.name,
        available: r.available,
        lockState: r.enabled ? "start-enabled" : r.unlocks.length ? "tech-locked" : "unreachable",
        in: io(r.ingredients),
        out: io(r.products),
      })),
      note:
        consumers.length === 0
          ? "nothing consumes this — needs a void/flush sink"
          : `${consumers.length} consuming recipe(s); pick one or route to an importing block`,
    };
  },
});

/** Resolve a recipe's io into {name, amount} pairs, averaging ranged outputs. */
async function recipeIo(q: Awaited<ReturnType<typeof lib>>, name: string) {
  const r = q.getRecipe(name);
  if (!r) return null;
  const amt = (c: {
    amount?: number | null;
    amountMin?: number | null;
    amountMax?: number | null;
  }) =>
    c.amount ?? (c.amountMin != null && c.amountMax != null ? (c.amountMin + c.amountMax) / 2 : 0);
  return {
    in: r.ingredients.map((c) => ({ name: c.name, amount: amt(c), kind: c.kind })),
    out: r.products.map((c) => ({ name: c.name, amount: amt(c), kind: c.kind })),
  };
}

/** The closure computation behind chainStatus — a plain function so submitBlock
 * can reuse it with full types (not via the tool's loosely-typed execute). */
async function computeChainStatus(recipes: string[], target: string) {
  const q = await lib();
  const produced = new Map<string, number>(); // good -> max single-recipe output amount (size hint)
  const consumed = new Map<string, number>(); // good -> max single-recipe input amount
  const invalid: string[] = [];
  for (const name of recipes) {
    const rio = await recipeIo(q, name);
    if (!rio) {
      invalid.push(name);
      continue;
    }
    for (const p of rio.out) produced.set(p.name, Math.max(produced.get(p.name) ?? 0, p.amount));
    for (const c of rio.in) consumed.set(c.name, Math.max(consumed.get(c.name) ?? 0, c.amount));
  }
  const openInputs: {
    good: string;
    amountPerCraft: number;
    additive: boolean;
    suggestion: "import" | "build";
    note: string;
    producers: number;
    topRecipe: { recipe: string; available: boolean; in: string } | null;
  }[] = [];
  for (const [good, amount] of consumed) {
    if (produced.has(good)) continue; // satisfied internally
    if (PSEUDO_GOODS.has(good)) continue; // electricity/heat: handled by the power balance, not stoichiometry
    const counts = q.goodGraphCounts(good);
    const verdict = classifyAdditive(good, counts.consumers);
    const top = q.recipeCandidates(good, "produce")[0];
    const topIo = top ? await recipeIo(q, top.name) : null;
    openInputs.push({
      good,
      amountPerCraft: amount,
      additive: verdict.additive,
      suggestion: verdict.additive ? "import" : "build",
      note: verdict.reason,
      producers: counts.producers,
      topRecipe: top
        ? { recipe: top.name, available: top.available, in: io(topIo?.in ?? []) }
        : null,
    });
  }
  const byproducts = [...produced.keys()].filter(
    (g) => !consumed.has(g) && g !== target && !PSEUDO_GOODS.has(g),
  );
  openInputs.sort((a, b) => Number(a.additive) - Number(b.additive)); // build-needed first
  return {
    target,
    recipeCount: recipes.length,
    invalid,
    closed: openInputs.filter((o) => o.suggestion === "build").length === 0,
    openInputs,
    byproducts,
  };
}

export const chainStatus = tool({
  description:
    "Given the recipes you've chosen so far, report what's still OPEN — the closure check that drives chain-building. Returns: openInputs (goods consumed but not produced by your set — each needs a producer added OR is an import), byproducts (goods produced but unused — need a sink or are exports), and any invalid recipe names. Call this repeatedly as you add recipes until openInputs contains only additives/imports. This is set-based, so feedback loops in the chain are fine.",
  inputSchema: z.object({
    recipes: z.array(z.string()).describe("Internal recipe names chosen so far"),
    target: z.string().describe("The good this block is ultimately producing, e.g. 'iron-plate'"),
  }),
  execute: async ({ recipes, target }) => computeChainStatus(recipes, target),
});

export const turdConsistency = tool({
  description:
    "Check TURD-choice consistency (one choice per master, factory-wide). To check a specific recipe set, pass recipes:[...]. To audit the WHOLE existing factory, call with an empty object {} (no recipes field) — exactly once, don't repeat it. Returns: conflicts (two recipes needing DIFFERENT choices of the same master — infeasible) and the TURD selections implied vs the user's current selections (already-selected / pick an undecided master / switch a master set to something else).",
  inputSchema: z.object({
    recipes: z
      .array(z.string())
      .optional()
      .describe("Recipe set to check; omit to check every recipe across all existing blocks"),
  }),
  execute: async ({ recipes }) => {
    const q = await lib();
    const set = recipes ?? q.allBlockRecipes();
    return {
      scope: recipes ? "given recipes" : "all existing blocks",
      ...q.checkTurdConsistency(set),
    };
  },
});

export const availableTurds = tool({
  description:
    "Given the recipes a NOW-mode plan uses, return the TURD upgrades that (a) would replace one of those recipes, (b) are researched and pickable RIGHT NOW, and (c) the user has NOT picked yet. Call this at the END of a NOW plan to surface 'TURD opportunities' as advice — describe what each available choice would change. NEVER say a TURD is applied: picking one is a near-permanent, factory-wide commitment the user makes themselves, and a TURD is never required (a base recipe always exists). Returns { opportunities: [] } when none are relevant. Picked masters are excluded (locked); masters needing more research are excluded (not available yet).",
  inputSchema: z.object({
    recipes: z
      .array(z.string())
      .min(1)
      .describe("The base recipes the plan chose (e.g. the block's recipe list)"),
  }),
  execute: async ({ recipes }) => {
    const q = await lib();
    return { opportunities: q.turdOpportunities(recipes) };
  },
});

export const turdChoices = tool({
  description:
    "Every choice a Pyanodons TURD upgrade offers — the whole mutually-exclusive branch set for a master, each branch's description, the recipes it swaps (old→new) or newly UNLOCKS, its always-on modules, and which branch (if any) is selected. Unlike availableTurds/turdConsistency (which only see branches that REPLACE a recipe), this also surfaces branches that grant a brand-new recipe. Use it whenever the user asks what a TURD gives, which choice is best, or to compare branches. Look up by master tech name, or pass a recipe or good to find the master(s) affecting it. Read each branch's description — it often carries flavor/consequences that matter (e.g. a choice that makes a creature explode).",
  inputSchema: z.object({
    master: z
      .string()
      .optional()
      .describe("TURD master tech name (e.g. 'moondrop-upgrade') or one of its sub-tech names"),
    recipe: z.string().optional().describe("A recipe to find the TURD master(s) that affect it"),
    good: z
      .string()
      .optional()
      .describe("A good — finds TURD masters on recipes that produce or consume it"),
  }),
  execute: async ({ master, recipe, good }) => {
    if (!master && !recipe && !good) return { error: "pass one of master, recipe, or good" };
    const q = await lib();
    return { masters: q.turdChoicesLookup({ master, recipe, good }) };
  },
});

const blockDraftInput = z.object({
  name: z.string().optional().describe("Optional display name for this block"),
  target: z.string().describe("Internal name of the good this block produces"),
  rate: z.number().positive().describe("Target output rate (items or fluid units per second)"),
  recipes: z.array(z.string()).min(1).describe("The complete recipe list for THIS block"),
  subBlocksNeeded: z.array(z.string()).optional().describe("Seam goods for follow-up blocks"),
  notes: z
    .string()
    .optional()
    .describe("Short rationale: tier choices, where you cut, reused blocks, byproducts"),
});

async function buildBlockDraft({
  target,
  rate,
  recipes,
  subBlocksNeeded,
  notes,
}: z.infer<typeof blockDraftInput>) {
  const q = await lib();
  const status = await computeChainStatus(recipes, target);
  const suppliers = q.goodSuppliers();
  const rates = new Map<string, number>();
  let powerW: number | null = null;
  let heatW: number | null = null;
  let solvedImportNames: string[] | null = null;
  let solvedByproductNames: string[] | null = null;
  let moduleFill: { modules: Record<string, string[]>; machines: Record<string, string> } = {
    modules: {},
    machines: {},
  };
  try {
    const { computeBlock } = await import("./factorio.ts");
    const { chooseModuleFill } = await import("./module-fill.ts");
    // First solve module-less to get per-recipe machines + base building counts,
    // then auto-fill modules ("best available": prod where allowed, else
    // speed→floor→efficiency) and re-solve so counts/power/imports reflect them.
    const goals = [{ name: target, rate }];
    const provisional = await computeBlock({ goals, recipes });
    moduleFill = await chooseModuleFill(provisional.rows);
    const solved = Object.keys(moduleFill.modules).length
      ? await computeBlock({
          goals,
          recipes,
          modules: moduleFill.modules,
          machines: moduleFill.machines,
        })
      : provisional;
    for (const f of solved.imports) rates.set(f.name, +f.rate.toFixed(3));
    for (const f of solved.exports) rates.set(f.name, +f.rate.toFixed(3));
    powerW = solved.power?.totalW ?? null;
    heatW = solved.power?.heatW ?? null;
    solvedImportNames = solved.imports.map((f) => f.name).filter((n) => !PSEUDO_GOODS.has(n));
    solvedByproductNames = solved.exports
      .map((f) => f.name)
      .filter((n) => !PSEUDO_GOODS.has(n) && n !== target);
  } catch {
    /* keep going with stoichiometric fallback */
  }
  const importNames = solvedImportNames ?? status.openInputs.map((o) => o.good);
  const additiveOf = new Map(status.openInputs.map((o) => [o.good, o.additive]));
  const imports = importNames.map((good) => {
    const sup = suppliers.get(good);
    const additive =
      additiveOf.get(good) ?? classifyAdditive(good, q.goodGraphCounts(good).consumers).additive;
    return {
      good,
      additive,
      rate: rates.get(good) ?? null,
      fromBlock: sup?.map((s) => ({ id: s.blockId, name: s.blockName })) ?? null,
    };
  });
  const byproductNames = solvedByproductNames ?? status.byproducts;
  const hasHeatSource = recipes.some((r) => r.startsWith("generate-heat-"));
  const heatSourceNeeded = (heatW ?? 0) > 1 && !hasHeatSource;
  const heatSources = heatSourceNeeded
    ? q
        .recipeCandidates("pyops-heat", "produce")
        .filter((c) => c.available)
        .slice(0, 4)
        .map((c) => ({ recipe: c.name, makes: io(c.products), cost: c.cost }))
    : undefined;
  return {
    ok: status.invalid.length === 0,
    target,
    targetDisplay: q.getItem(target)?.display ?? q.getFluid(target)?.display ?? target,
    rate,
    recipes,
    modules: moduleFill.modules,
    machines: moduleFill.machines,
    notes: notes ?? null,
    powerW,
    heatW,
    heatSourceNeeded,
    heatSources,
    imports: imports.map((i) => i.good),
    importsFromBlocks: imports.filter((i) => i.fromBlock),
    importsExternal: imports.filter((i) => !i.fromBlock).map((i) => i.good),
    subBlocksNeeded: (subBlocksNeeded ?? []).map((g) => ({ good: g, rate: rates.get(g) ?? null })),
    byproducts: byproductNames.map((g) => ({ good: g, rate: rates.get(g) ?? null })),
    rates: Object.fromEntries(rates),
    turd: q.checkTurdConsistency(recipes),
    invalid: status.invalid,
  };
}

export const submitBlock = tool({
  description:
    "Finalize your proposed production block for ONE target, bounded at its seams. Call ONCE at the end. The block's open inputs are its imports; each import is either already made by an existing block (reuse it) or is a commodity/raw. List in subBlocksNeeded any seam goods that deserve their OWN block next (the decomposition follow-ups). It SOLVES the block, so imports / byproducts / sub-blocks come back with their actual per-second RATES — use those: tell the user to draft each sub-block at its rate (e.g. 'super-alloy block @ 3.3/s'). Returns imports split into from-existing-block vs external, byproducts, and power.",
  inputSchema: z.object({
    target: z.string().describe("Internal name of the good this block produces"),
    rate: z.number().positive().describe("Target output rate (items or fluid units per second)"),
    recipes: z
      .array(z.string())
      .min(1)
      .describe("The complete recipe list for THIS block (down to its seams)"),
    subBlocksNeeded: z
      .array(z.string())
      .optional()
      .describe(
        "Seam goods that should become their own block next (not commodities/raws) — the decomposition follow-ups",
      ),
    notes: z
      .string()
      .optional()
      .describe("Short rationale: tier choices, where you cut (seams), reused blocks, byproducts"),
  }),
  execute: async (input) => buildBlockDraft(input),
});

/** Re-solve an existing block at a NEW rate (keeping its stored recipes/target)
 * and return it as an "update" draft the user approves before it's applied. */
async function buildBlockUpdate({ blockId, rate, notes }: z.infer<typeof reviseBlockInput>) {
  const q = await lib();
  const row = q.getBlock(blockId);
  if (!row) {
    return { ok: false, kind: "update" as const, updateBlockId: blockId, missing: true };
  }
  const data = normalizeBlockData(row.data);
  const primary = primaryGoal(data);
  const draft = await buildBlockDraft({
    target: primary?.name ?? "",
    rate,
    recipes: data.recipes,
    notes,
  });
  return {
    ...draft,
    kind: "update" as const,
    updateBlockId: blockId,
    blockName: row.name,
    oldRate: primaryRate(data),
  };
}

const reviseBlockInput = z.object({
  blockId: z
    .number()
    .int()
    .describe("id of the existing block to resize (the `id` from factoryBlocks)"),
  rate: z
    .number()
    .positive()
    .describe("New target output rate for that block (items or fluid units per second)"),
  notes: z
    .string()
    .optional()
    .describe("Why the rate is changing (e.g. 'raise to feed py-science-1 at 1/s')"),
});

export const reviseBlock = tool({
  description:
    "Propose RAISING or LOWERING the output rate of an EXISTING block (by its factoryBlocks id) so it meets new demand — instead of building a duplicate. Re-solves the block's existing recipes at the new rate and returns the updated imports / byproducts / sub-block demand. The change is a PROPOSAL the user approves before it's applied. Use this when a good you need is already produced by a block but at too low a rate (common when scaling materials/mall blocks up to feed a new plan).",
  inputSchema: reviseBlockInput,
  execute: async (input) => buildBlockUpdate(input),
});

export const submitPlan = tool({
  description:
    "Finalize a MULTI-BLOCK production plan for one user request. Use when the user asks for multiple products/rates, all supporting sub-blocks, or building/material supply such as steel, circuits, machines, belts, inserters, pipes, and power/utility items. Each block is solved independently and returned as a reviewable draft; include dependency notes and remaining external imports. Prefer focused reusable blocks over one giant block.",
  inputSchema: z.object({
    title: z.string().describe("Short display title for the whole plan"),
    objective: z.string().describe("User-facing summary of what this plan satisfies"),
    blocks: z
      .array(blockDraftInput)
      .min(1)
      .max(20)
      .describe("Focused blocks to create for final products and required support materials"),
    updates: z
      .array(reviseBlockInput)
      .optional()
      .describe(
        "Existing blocks (by factoryBlocks id) to RESIZE to a new rate so they meet this plan's demand — instead of duplicating them. Use for already-built material/mall blocks that are too small.",
      ),
    buildingMaterialsIncluded: z
      .boolean()
      .default(false)
      .describe("True when the plan includes blocks for required building/material supply"),
    notes: z
      .string()
      .optional()
      .describe("Plan-level notes: dependencies, remaining external imports, assumptions"),
  }),
  execute: async ({ title, objective, blocks, updates, buildingMaterialsIncluded, notes }) => {
    const drafts = await Promise.all(blocks.map((block) => buildBlockDraft(block)));
    const updateDrafts = await Promise.all((updates ?? []).map((u) => buildBlockUpdate(u)));
    const recipes = [...new Set(blocks.flatMap((b) => b.recipes))];
    const q = await lib();
    return {
      ok: drafts.every((d) => d.ok) && updateDrafts.every((d) => d.ok),
      title,
      objective,
      buildingMaterialsIncluded,
      notes: notes ?? null,
      blocks: drafts.map((draft, i) => ({
        ...draft,
        name: blocks[i].name ?? `${draft.targetDisplay} (drafted)`,
      })),
      updates: updateDrafts,
      turd: q.checkTurdConsistency(recipes),
      invalid: [...new Set(drafts.flatMap((d) => d.invalid ?? []))],
    };
  },
});

/* ── Tasks & notes: let the agent read/file/link the project's planning
 * tasks. Unlike block drafts (propose-then-apply), task writes are low-stakes and
 * reversible (the user edits/deletes them on the Tasks page), so they apply
 * directly. A "milestone" is just a parent task; entity links render as chips. */

const REF_KIND = z.enum(["item", "fluid", "recipe", "technology", "block"]);
const LINK_SHAPE = z.object({
  kind: REF_KIND,
  name: z
    .string()
    .describe("internal name (e.g. 'iron-plate'); for kind 'block', the block id as a string"),
});

export const listTasks = tool({
  description:
    "List the user's planning tasks (the task tree) with completion progress. Consult this to surface tasks relevant to what you're planning and to avoid filing duplicates. Returns a flat list; `parentId` gives the tree (top-level tasks have parentId null).",
  inputSchema: z.object({}),
  execute: async () =>
    (await tasksLib()).listTasks().map((n) => ({
      id: n.id,
      parentId: n.parentId,
      title: n.title,
      status: n.status,
      progress: `${n.stepDone + n.childDone}/${n.stepTotal + n.childTotal}`,
    })),
});

export const getTask = tool({
  description:
    "Read one task in full: its description, checklist steps, direct subtasks, and entity links (chips).",
  inputSchema: z.object({ id: z.number().int() }),
  execute: async ({ id }) => {
    const task = (await tasksLib()).getTask(id);
    if (!task) return { ok: false, error: "no such task" };
    return {
      ok: true,
      id: task.id,
      parentId: task.parentId,
      title: task.title,
      body: task.body,
      status: task.status,
      steps: task.steps.map((s) => ({ id: s.id, text: s.text, done: s.done })),
      subtasks: task.children.map((c) => ({ id: c.id, title: c.title, done: c.done })),
      links: task.links.map((l) => ({ kind: l.kind, name: l.refName, display: l.display })),
    };
  },
});

export const createTask = tool({
  description:
    "File a planning task in the user's project (a 'thing to do'). Use after drafting a block/plan to record a follow-up the user should act on — optionally with checklist steps and entity links (the recipes/items/blocks it involves). Pass `parentId` to make it a subtask. Saved directly; the user can edit or delete it on the Tasks page.",
  inputSchema: z.object({
    title: z.string().describe("Short imperative title, e.g. 'Build molten iron smelting'"),
    body: z.string().optional().describe("Optional markdown description of what to do / why"),
    parentId: z.number().int().optional().describe("Make this a subtask of an existing task id"),
    steps: z.array(z.string()).optional().describe("Checklist steps within the task"),
    links: z.array(LINK_SHAPE).optional().describe("Entity references to attach as chips"),
  }),
  execute: async ({ title, body, parentId, steps, links }) => {
    const t = await tasksLib();
    const id = t.createTask({ title, body, parentId: parentId ?? null });
    for (const s of steps ?? []) if (s.trim()) t.addStep(id, s);
    for (const l of links ?? []) t.addLink(id, l.kind, l.name);
    return { ok: true, id, title };
  },
});

export const updateTask = tool({
  description:
    "Update an existing task: rename, edit its description, or set its workflow status (open / in_progress / done / closed — closed = won't-do). Pass only the fields to change.",
  inputSchema: z.object({
    id: z.number().int(),
    title: z.string().optional(),
    body: z.string().optional(),
    status: z.enum(["open", "in_progress", "done", "closed"]).optional(),
  }),
  execute: async ({ id, title, body, status }) => {
    (await tasksLib()).updateTask(id, { title, body, status });
    return { ok: true };
  },
});

export const addTaskStep = tool({
  description: "Append a checklist step to an existing task.",
  inputSchema: z.object({ taskId: z.number().int(), text: z.string() }),
  execute: async ({ taskId, text }) => ({ ok: true, id: (await tasksLib()).addStep(taskId, text) }),
});

export const linkTask = tool({
  description:
    "Attach an entity reference to an existing task, rendered as a chip. For a block, pass its numeric id (from factoryBlocks) as `name`.",
  inputSchema: z.object({
    taskId: z.number().int(),
    kind: REF_KIND,
    name: z
      .string()
      .describe("internal name (e.g. 'iron-plate'); for kind 'block', the block id as a string"),
  }),
  execute: async ({ taskId, kind, name }) => ({
    ok: true,
    id: (await tasksLib()).addLink(taskId, kind, name),
  }),
});

/* ── Read-only game-world tools: inspect the LIVE factory via the bridge
 * (app → mod → Factorio). All bounded and structured — no whole-map dumps. They
 * require the companion mod connected; otherwise they return a clear error. Use
 * them to ground a task's anchors in current evidence. */

export const gameContext = tool({
  description:
    "Read the player's current in-game context from the live game (via the companion mod): their surface, position, force, and the entity they're hovering/selecting. Use to ground a captured task or 'what am I looking at' questions. Requires the mod connected.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const r = await (await bridge()).requestFromMod("cmd.game_context", {});
      return { ok: true, ...(r as object) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "bridge error" };
    }
  },
});

export const gameInspectArea = tool({
  description:
    "List the entities in a small area of the live factory (via the mod) — name, type, position, current recipe (for crafting machines), and status. Bounded by radius; results are capped. Use to see what's actually built around a location (e.g. a captured task's anchor).",
  inputSchema: z.object({
    x: z.number().describe("Centre x (map coordinate)"),
    y: z.number().describe("Centre y"),
    radius: z.number().min(1).max(64).default(16).describe("Half-size of the scan box, in tiles"),
    surface: z.string().optional().describe("Surface name; defaults to the player's surface"),
  }),
  execute: async ({ x, y, radius, surface }) => {
    try {
      const r = await (
        await bridge()
      ).requestFromMod("cmd.inspect_area", { x, y, radius, surface });
      return { ok: true, ...(r as object) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "bridge error" };
    }
  },
});

export const gameFindEntities = tool({
  description:
    "Count and sample entities of a given prototype name in the live factory (via the mod), e.g. how many 'assembling-machine-3' exist and roughly where. Capped result. Pass the internal entity name.",
  inputSchema: z.object({
    name: z.string().describe("Entity prototype internal name, e.g. 'assembling-machine-3'"),
    surface: z.string().optional().describe("Surface name; defaults to the player's surface"),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  execute: async ({ name, surface, limit }) => {
    try {
      const r = await (
        await bridge()
      ).requestFromMod("cmd.find_entities", { name, surface, limit });
      return { ok: true, ...(r as object) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "bridge error" };
    }
  },
});

export const gameProduction = tool({
  description:
    "Read live per-second production and consumption for specific goods from the running game (via the mod) — the real flow-stat actuals, force-wide. Pass internal item/fluid names. Use to check 'is X actually being made / starved'.",
  inputSchema: z.object({
    goods: z.array(z.string()).min(1).max(20).describe("Internal item/fluid names to report"),
  }),
  execute: async ({ goods }) => {
    try {
      const r = await (await bridge()).requestFromMod("cmd.production", { goods });
      return { ok: true, ...(r as object) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "bridge error" };
    }
  },
});

export const gameEval = tool({
  description:
    "READ live game state via Lua (run in the game by the mod) — for grounding/tracing when the structured game tools (gameContext/inspectArea/findEntities/production) aren't enough: an entity's status/recipe/inventory, fluidbox contents, force/research data, ad-hoc counts. USE IT READ-ONLY: inspect, never mutate — do NOT call destroy/insert/remove/set_*/clear or anything that changes the world. `player` is pre-bound; a bare expression is auto-returned; returns a string repr. Single-player only. Examples: `player.selected.status`, `player.selected.get_recipe().name`, `#player.surface.find_entities_filtered{type='lab'}`, `player.force.technologies['automation'].researched`.",
  inputSchema: z.object({
    code: z
      .string()
      .describe("Lua chunk — a bare expression, or statements with an explicit return"),
  }),
  execute: async ({ code }) => {
    try {
      const r = await (await bridge()).requestFromMod("cmd.eval", { code }, 8000);
      return { ok: true, ...(r as object) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "bridge error" };
    }
  },
});

export const gameScreenshot = tool({
  description:
    "Screenshot the running game (GUI included) and return a PNG file PATH to read. Optionally auto-crop to a top-level GUI element with `panel` (e.g. 'pyops_design' — uses its on-screen location + size), pass an explicit `crop` box 'WxH+X+Y', and/or `scale` ('50%' or a target pixel width). Cropping/scaling use the bundled sharp library — no system tools. Built for live in-game UI design: snap the panel, look at it, tweak. The PNG is written by Factorio on the app host, so the returned path is locally readable. Single-player/local only.",
  inputSchema: z.object({
    panel: z
      .string()
      .optional()
      .describe("name of a gui.screen element to auto-crop to, e.g. 'pyops_design'"),
    crop: z.string().optional().describe("explicit crop box 'WxH+X+Y' (overrides panel)"),
    scale: z
      .string()
      .optional()
      .describe("resize: a percentage like '50%' or a target pixel width like '1280'"),
  }),
  execute: async ({ panel, crop, scale }) => {
    try {
      const { homedir, tmpdir } = await import("node:os");
      const path = await import("node:path");
      const { stat } = await import("node:fs/promises");

      // Where Factorio writes script-output, per OS (overridable for odd installs).
      const scriptOutput = () => {
        if (process.env.FACTORIO_SCRIPT_OUTPUT) return process.env.FACTORIO_SCRIPT_OUTPUT;
        const home = homedir();
        if (process.platform === "win32") {
          const appdata = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
          return path.join(appdata, "Factorio", "script-output");
        }
        if (process.platform === "darwin") {
          return path.join(home, "Library", "Application Support", "factorio", "script-output");
        }
        return path.join(home, ".factorio", "script-output");
      };
      const raw = path.join(scriptOutput(), "pyops-shot.png");
      const statRaw = () => stat(raw).catch(() => null);
      const before = await statRaw().then((s) => s?.mtimeMs ?? 0);

      // Fire the capture via the eval bridge; if a panel is named, also return its
      // on-screen bbox so we can crop to it.
      // `location` is in actual pixels; a panel built with auto_center is symmetric,
      // so its actual size is res − 2·location (no display-scale math, and it tracks
      // content-driven height that `minimal_*` would under-report). Assumes a centered
      // element — pass an explicit `crop` for a dragged/off-center one.
      const lua = panel
        ? `local e=player.gui.screen[${JSON.stringify(panel)}]\n` +
          `game.take_screenshot{player=player, show_gui=true, path="pyops-shot.png", daytime=1}\n` +
          `if e then local l=e.location local r=player.display_resolution return {x=l.x, y=l.y, w=r.width-2*l.x, h=r.height-2*l.y} else return {miss=true} end`
        : `game.take_screenshot{player=player, show_gui=true, path="pyops-shot.png", daytime=1} return "ok"`;
      const r = (await (await bridge()).requestFromMod("cmd.eval", { code: lua }, 8000)) as {
        ok?: boolean;
        result?: string;
        error?: string;
      };
      if (r.ok === false) return { ok: false, error: r.error ?? "eval failed" };

      // Wait for the async render to land: mtime must advance past `before` AND the
      // file size must settle (the ~9 MB PNG is written over a few ticks — reading it
      // mid-write gives magick an "improper image header").
      let landed = false;
      let lastSize = -1;
      for (let i = 0; i < 60; i++) {
        const s = await statRaw();
        if (s && s.mtimeMs > before) {
          if (s.size > 0 && s.size === lastSize) {
            landed = true;
            break;
          }
          lastSize = s.size;
        }
        await new Promise((res) => setTimeout(res, 120));
      }
      if (!landed) {
        return { ok: false, error: "screenshot file never appeared (is the game rendering?)" };
      }

      // Resolve a crop region (pixels): explicit `crop` wins, else the panel bbox.
      let region: { left: number; top: number; width: number; height: number } | null = null;
      if (crop) {
        const m = crop.match(/^(\d+)x(\d+)\+(-?\d+)\+(-?\d+)$/);
        if (!m) return { ok: false, error: `bad crop '${crop}', expected 'WxH+X+Y'` };
        region = { width: +m[1], height: +m[2], left: +m[3], top: +m[4] };
      } else if (panel && r.result && !/miss=true/.test(r.result)) {
        const num = (k: string) => {
          const m = r.result!.match(new RegExp(`${k}=(-?\\d+)`));
          return m ? parseInt(m[1], 10) : null;
        };
        const x = num("x");
        const y = num("y");
        const w = num("w");
        const h = num("h");
        if (x != null && y != null && w && h && w > 0 && h > 0) {
          region = { left: x - 12, top: y - 12, width: w + 24, height: h + 24 }; // margin for shadow
        }
      }

      if (!region && !scale) return { ok: true, path: raw, cropped: false };

      // sharp ships prebuilt cross-platform binaries (no system ImageMagick), so this
      // works the same on Windows/Mac/Linux for other users.
      const sharp = (await import("sharp")).default;
      let img = sharp(raw);
      const meta = await img.metadata();
      const imgW = meta.width ?? 0;
      const imgH = meta.height ?? 0;
      let baseWidth = imgW;
      if (region) {
        // Clamp to the image so an over-reaching margin can't error sharp's extract.
        const left = Math.max(0, Math.min(region.left, Math.max(0, imgW - 1)));
        const top = Math.max(0, Math.min(region.top, Math.max(0, imgH - 1)));
        const width = Math.max(1, Math.min(region.width, imgW - left));
        const height = Math.max(1, Math.min(region.height, imgH - top));
        img = img.extract({ left, top, width, height });
        baseWidth = width;
      }
      if (scale) {
        const s = scale.trim();
        const target = s.endsWith("%")
          ? Math.round((baseWidth * parseFloat(s)) / 100)
          : parseInt(s, 10);
        if (Number.isFinite(target) && target > 0) img = img.resize({ width: target });
      }
      const out = path.join(tmpdir(), "pyops-shot-out.png");
      await img.toFile(out);
      return { ok: true, path: out, crop: region, scale: scale ?? null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "screenshot error" };
    }
  },
});

export const gameReloadMods = tool({
  description:
    "Developer-only live loop helper: ask the connected PyOps companion mod to call Factorio's game.reload_mods() after acknowledging this request. Use after editing mod/control Lua or GUI code, then wait for the bridge to reconnect/resync before taking screenshots. Requires the bridge to already be connected; if the currently loaded mod predates this command, reload Factorio manually once.",
  inputSchema: z.object({
    confirm: z
      .literal("reload_mods")
      .describe("Safety confirmation. Must be exactly 'reload_mods'."),
  }),
  execute: async ({ confirm }) => {
    try {
      const r = await (await bridge()).requestFromMod("cmd.dev.reload_mods", { confirm }, 8000);
      return { ok: true, ...(r as object) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "reload error" };
    }
  },
});

export const gameShowBlock = tool({
  description:
    "Developer live-loop helper: push a saved block to the in-game Helmod-style summary panel (`pyops_summary`), exactly as the web 'show in game' button does — same payload, including the per-good belts/inserters logistics readout. Use to drive the in-game UI yourself: gameShowBlock → gameScreenshot({panel:'pyops_summary'}) → inspect → tweak. Requires the bridge connected and a block id (see factoryBlocks).",
  inputSchema: z.object({
    blockId: z.number().int().describe("id of a saved block (from factoryBlocks)"),
  }),
  execute: async ({ blockId }) => {
    try {
      const r = await (await gameLib()).showBlockInGame(blockId);
      if (!r.sent && r.name === null) return { ok: false, error: `no block with id ${blockId}` };
      return { ok: r.sent, panel: "pyops_summary", block: r.name };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "show error" };
    }
  },
});

export const gameCloseSummary = tool({
  description:
    "Developer live-loop helper: close the in-game summary panel (`pyops_summary`). Pairs with gameShowBlock for clean before/after screenshots.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const r = await (await gameLib()).hideBlockInGame();
      return { ok: r.sent };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "close error" };
    }
  },
});

/** The full tool set for the planning agent: read-only data tools, block/plan
 * draft proposals (propose-then-apply), the tasks surface, read-only live
 * game-world inspection, and developer loop helpers — all via the bridge. */
export const agentTools = {
  searchGoods,
  factoryBlocks,
  recipeGraph,
  recipeOptions,
  recipeOptionsBatch,
  recipeInfo,
  goodInfo,
  byproductSinks,
  turdConsistency,
  availableTurds,
  turdChoices,
  chainStatus,
  submitBlock,
  reviseBlock,
  submitPlan,
  listTasks,
  getTask,
  createTask,
  updateTask,
  addTaskStep,
  linkTask,
  gameContext,
  gameInspectArea,
  gameFindEntities,
  gameProduction,
  // Lua eval — framed READ-ONLY for the assistant (see its description + the
  // system prompt). It's not *enforced* read-only (the mod runs whatever Lua), so
  // the guardrail is convention, acceptable here because it's a local
  // single-player game. Over MCP (developer debugging) it's used with full power.
  gameEval,
  // Capture the game (GUI included) to a PNG path — for live in-game UI design.
  gameScreenshot,
  // Reload the loaded mods without desktop/window automation.
  gameReloadMods,
  // Drive the in-game summary panel for self-testing (open a block / close it).
  gameShowBlock,
  gameCloseSummary,
};
