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
import { coherenceAudit as runCoherenceAudit, isVoidRecipeFor } from "./coherence-audit.server.ts";
import { factoryWhatIf } from "./factory-solve.server.ts";
import {
  normalizeBlockData,
  primaryGoal,
  primaryRate,
  STOCK_WINDOW_DEFAULT,
  withPrimaryRate,
} from "../lib/goals.ts";

import * as q from "../db/queries.server.ts";
import * as tasksDb from "../db/tasks.server.ts";
import { requestFromMod } from "./bridge/inspect.ts";
import {
  computeBlock,
  computeModuleSuggestions,
  ensureSolvedProjections,
  showBlockInGame,
  hideBlockInGame,
  machineReqs,
  pickDefaultMachine,
} from "./block-compute.server.ts";
import { withUndoAction } from "./undo-action.server.ts";

/** Energy pseudo-fluids. The stoichiometric chainStatus filters all three: recipes
 * never list them as ingredients (machine draws are injected at solve time), so a
 * burn-fluid-* conversion's MJ output would misread as an unconsumed byproduct. */
const PSEUDO_GOODS = new Set(["pyops-electricity", "pyops-heat", "pyops-fluid-fuel"]);
/** Electricity & heat are surfaced separately as powerW/heatW, so submitBlock drops
 * them from the SOLVED import/export lists. pyops-fluid-fuel is not dropped (#115):
 * at factory scale MJ is a matched block-to-block flow, so a generic fluid-fuel
 * draw must surface as an explicit import (and a designated supplier's MJ output
 * as an explicit export) in the draft. */
const POWER_PSEUDO = new Set(["pyops-electricity", "pyops-heat"]);

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
    return q
      .searchAll(query, limit)
      .map((g) => ({ name: g.name, display: g.display, kind: g.kind }));
  },
});

export const factoryBlocks = tool({
  description:
    "List the blocks that already exist in the user's factory: what each PRODUCES (makes/primary), has spare (byproducts), and imports. Consult this BEFORE drafting — if an existing block already makes a good you need, import it from that block instead of rebuilding it. recipeGraph already marks goods covered by a block; this gives the fuller picture (rates, byproducts you could consume).",
  inputSchema: z.object({}),
  execute: async () => {
    await ensureSolvedProjections();
    return q.factoryBlocks();
  },
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
  q: typeof import("../db/queries.server.ts"),
  good: string,
  direction: "produce" | "consume",
  limit: number,
  batch?: {
    candidates: ReturnType<typeof import("../db/queries.server.ts").recipeCandidatesBatch>;
    machines: ReturnType<typeof import("../db/queries.server.ts").machineOptionsForRecipes>;
    restrict: boolean;
  },
) {
  // Restrict the favorite/fallback search to unlocked machines exactly like
  // computeBlock/recipeDefaultsFn do (future-horizon planning leaves every
  // machine on the table; now/target restricts to what's actually unlocked).
  const restrict = batch?.restrict ?? q.getResearchHorizon().mode !== "future";
  return (batch?.candidates.get(good) ?? q.recipeCandidates(good, direction))
    .slice(0, limit)
    .map((r) => {
      // Representative building: the SAME favorite-then-fallback resolution
      // computeBlock/recipeDefaultsFn use when a recipe row is set up, so the
      // machine named here is the one a draft would really solve with (#130)
      // — not just the fastest tier in the category. Availability is judged
      // against THIS machine, since that's what actually gates buildability.
      const machines = batch?.machines.get(r.name) ?? q.machineOptionsForRecipe(r.name);
      const pool =
        restrict && machines.some((m) => m.availableNow)
          ? machines.filter((m) => m.availableNow)
          : machines;
      const favorite = pool.find((m) => m.favorite) ?? null;
      const resolved = favorite ?? pickDefaultMachine(pool) ?? null;
      const fastest = machines.length
        ? machines.reduce((a, b) => (b.craftingSpeed > a.craftingSpeed ? b : a))
        : null;
      const describe = (m: NonNullable<typeof resolved>) => {
        const avail = m.startEnabled
          ? "available"
          : m.unlockedBy.length
            ? `needs ${m.unlockedBy
                .map((u) => u.display ?? u.tech)
                .slice(0, 2)
                .join(", ")}`
            : "unreachable";
        return (
          `${m.display ?? m.name} · ${m.craftingSpeed}× · ${m.moduleSlots} mod slots` +
          `${m.energyUsageW ? ` · ${Math.round(m.energyUsageW / 1000)}kW` : ""}` +
          ` · ${avail}`
        );
      };
      const machine = resolved
        ? describe(resolved) + `${machines.length > 1 ? ` (+${machines.length - 1} tiers)` : ""}`
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
        machine, // building the draft actually uses: favorite → else low-tier fallback (#130)
        machineFavorite: favorite ? true : undefined, // true iff resolved via the user's stored favorite
        fastestMachine:
          fastest && resolved && fastest.craftingSpeed > resolved.craftingSpeed
            ? describe(fastest)
            : undefined,
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
    "List the recipes that PRODUCE (or CONSUME) a good, ranked the way the picker ranks them: available first (cheapest by cost analysis within a tier), then tech-locked, then unselected TURD choices, with barrel fill/empty last. Each candidate already includes its inputs (in), outputs (out), lock state, cost, and unlocking tech — so you rarely need recipeInfo afterward. Cost is an LP shadow price — a HINT for tie-breaking, NOT the deciding factor: the right recipe is usually about the correct production TIER and chain, not the cheapest. `machine` names the building a draft would ACTUALLY solve with — the user's stored favorite for this recipe's category, else the same safe low-tier fallback `computeBlock` defaults to (never necessarily the fastest); its availability note (\"needs <tech>\") describes THIS machine, since that's what really gates buildability. `fastestMachine` is included only when a strictly faster tier exists beyond that pick, so you can still see whether upgrading the favorite is worth it. To resolve SEVERAL goods at once, prefer recipeOptionsBatch.",
  inputSchema: z.object({
    good: z.string().describe("Internal good name (from searchGoods), e.g. 'molten-iron'"),
    direction: z
      .enum(["produce", "consume"])
      .default("produce")
      .describe("'produce' = recipes that make it; 'consume' = recipes that use it"),
    limit: z.number().int().min(1).max(25).default(12),
  }),
  execute: async ({ good, direction, limit }) => optionsFor(q, good, direction, limit),
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
    const uniqueGoods = [...new Set(goods)];
    const candidates = q.recipeCandidatesBatch(uniqueGoods, direction);
    const recipeNames = uniqueGoods.flatMap((good) =>
      (candidates.get(good) ?? []).slice(0, limitEach).map((recipe) => recipe.name),
    );
    const batch = {
      candidates,
      machines: q.machineOptionsForRecipes(recipeNames),
      restrict: q.getResearchHorizon().mode !== "future",
    };
    const out: Record<string, ReturnType<typeof optionsFor>> = {};
    for (const good of uniqueGoods) out[good] = optionsFor(q, good, direction, limitEach, batch);
    return out;
  },
});

export const recipeInfo = tool({
  description:
    "Full detail for one recipe: exact ingredients/products with amounts, energy/time, category, cost, and unlock state (the techs that unlock it, their science-pack cost, and any TURD master›choice it belongs to). Each machine reports its module-slot rules: `allowedModuleCategories` (null = normal modules; a list like ['vrauks'] means the slots ONLY accept that category — Py creature buildings lock their slots to their own module) and, when restricted, `modules` — the hand-placeable modules that fit (e.g. Vrauk speed modules). A TURD choice's own module is NOT a slot option; it's applied by an always-on hidden T.U.R.D. beacon at no slot cost (see turdChoices), so the slots stay free for these. `turd` lists the FULL branch set of every TURD master that affects this recipe — whether the recipe is a branch's new unlock OR a base recipe some branch replaces — so you see all sibling choices, not just this one. Use after recipeOptions to inspect a specific candidate.",
  inputSchema: z.object({
    recipe: z.string().describe("Internal recipe name, e.g. 'molten-iron-01'"),
  }),
  execute: async ({ recipe }) => {
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
      name: m.name,
      kind: m.kind,
      speed: m.craftingSpeed,
      moduleSlots: m.moduleSlots,
      kW: m.energyUsageW ? Math.round(m.energyUsageW / 1000) : null,
      energySource: m.energySource,
      available: m.startEnabled || m.unlockedBy.length > 0,
      unlockedBy: m.startEnabled ? null : m.unlockedBy.map((u) => u.display ?? u.tech),
      // Module-slot eligibility. allowedModuleCategories null = normal modules; a list
      // (e.g. ['vrauks']) means the slots ONLY accept that category — Py creature
      // buildings lock their slots to their own module. When restricted, `modules`
      // lists the HAND-PLACEABLE modules that fit (e.g. Vrauk speed modules). A TURD
      // choice's own module is NOT here — it's applied via an always-on hidden beacon
      // (no slot cost), so the building's slots stay free for these; see turdChoices.
      allowedModuleCategories: m.allowedModuleCategories ?? null,
      allowedEffects: m.allowedEffects ?? null,
      modules: m.allowedModuleCategories?.length ? q.modulesFittingMachine(m.name) : undefined,
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

export const calcRecipe = tool({
  description:
    "What-if throughput calculator for ONE recipe under a specific loadout — a tiny single-building plan to judge whether a TURD or a module fill actually pays off. Give a recipe (optionally a machine, hand-placed `modules` or a `fill` module for every slot, and/or a `turd` sub-tech to apply its always-on beacon module). Returns the effective speed/productivity/energy multipliers and the resulting per-second inputs/outputs and power PER BUILDING, plus buildings needed for a `targetRate`. To evaluate a change, call once WITHOUT it and once WITH it and compare the rates/power. Hand modules are validated against the machine's slot rules (category + effects) — invalid ones come back in `rejectedModules` with a reason. Productivity scales only non-ignored outputs (not barrels), speed scales crafts/sec, consumption scales power; the TURD module applies via the hidden beacon at no slot cost.",
  inputSchema: z.object({
    recipe: z.string().describe("Internal recipe name, e.g. 'vrauks-rearing-mk04'"),
    machine: z
      .string()
      .optional()
      .describe("Machine internal name; default = fastest that can craft it"),
    modules: z
      .array(z.string())
      .optional()
      .describe("Hand-placed module names, one per slot (truncated to the machine's slot count)"),
    fill: z
      .string()
      .optional()
      .describe("Fill EVERY slot with this one module (ignored if `modules` is given)"),
    turd: z
      .string()
      .optional()
      .describe(
        "A TURD sub-tech name whose always-on beacon module to apply (hypothetical — independent of the current selection)",
      ),
    targetRate: z
      .number()
      .optional()
      .describe("Desired /s of the recipe's main product → buildings needed"),
  }),
  execute: async ({ recipe, machine, modules, fill, turd, targetRate }) => {
    return q.computeRecipeScenario({ recipe, machine, modules, fill, turd, targetRate });
  },
});

export const goodInfo = tool({
  description:
    "Facts about a good: cost, kind (item/fluid), how many recipes produce vs consume it (fan-out), and whether it should be treated as an IMPORTED additive/commodity or BUILT as a chain intermediate. Use this to decide whether to recurse into making an input or just import it.",
  inputSchema: z.object({
    good: z.string().describe("Internal good name, e.g. 'pressured-air'"),
  }),
  execute: async ({ good }) => {
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

export const productionStats = tool({
  description:
    "Actual per-second production/consumption for goods, from the SYNCED game stats (production_stats — refreshed by the mod's periodic push while playing, and on every save-load resync). Works even with the game closed. Returns each good's kind/display plus produced (items|fluid/s actually made) and consumed (actually used), and a batch-level syncedAt (ISO timestamp of the last sync, null if none has EVER landed) + syncedCount. Absence of nonzero flow for a good you know exists is a real signal ONLY once syncedAt is non-null — if syncedAt is null, treat all-zero results as unknown, not confirmed-idle. gameProduction remains the LIVE source of truth when the companion mod is connected right now (more current, but requires the bridge up) — prefer it when available; use productionStats when the game is closed, or to check many goods at once (e.g. auditing a plan's imports in one batch).",
  inputSchema: z.object({
    goods: z
      .array(z.string())
      .min(1)
      .max(30)
      .describe("Internal item/fluid names to report, e.g. ['iron-plate','sulfuric-acid']"),
  }),
  execute: async ({ goods }) => {
    const meta = q.metaAll();
    return {
      syncedAt: meta.stats_synced_at ?? null,
      syncedCount: meta.stats_synced_count ? Number(meta.stats_synced_count) : null,
      stats: q.productionStatsFor(goods),
    };
  },
});

export const byproductSinks = tool({
  description:
    "Where a byproduct can GO — for routing the outputs a block produces but doesn't consume (tailings, ash, sludge, off-gases). Returns recipes that PRODUCTIVELY consume the good (with what they make + availability), existing blocks that already IMPORT it (route the byproduct there), and — separately — voidOptions: the vent/void/incinerate disposal recipes that just destroy it. Prefer routing to a real consumer; voiding is the fallback when nothing useful consumes it. Only when there's no consumer AND no void does it need storage/buffering. Use this on each byproduct from chainStatus so the block's waste has a home.",
  inputSchema: z.object({
    good: z.string().describe("Internal good name of the byproduct, e.g. 'tailings'"),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  execute: async ({ good, limit }) => {
    const candidates = q.recipeCandidates(good, "consume");
    const voids = candidates.filter((r) => isVoidRecipeFor(r.name, good));
    const consumers = candidates.filter((r) => !voids.includes(r)).slice(0, limit);
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
      // Vent/void/incinerate recipes — disposal, not production. Kept apart so
      // real routing options stand out.
      voidOptions: voids.slice(0, 3).map((r) => ({
        recipe: r.name,
        available: r.available,
        in: io(r.ingredients),
      })),
      note:
        consumers.length > 0
          ? `${consumers.length} consuming recipe(s); route to one (or an importing block) before falling back to a void`
          : voids.length > 0
            ? "no productive consumer — vent/void it with a voidOptions recipe"
            : "nothing consumes this and no vent/void exists — it must be stored/buffered (open problem)",
    };
  },
});

export const coherenceAudit = tool({
  description:
    "Factory-WIDE coherence audit — the cross-block balance in ONE call, so you can audit the whole factory instead of reasoning block by block. Call it with {} (no arguments), at most once per audit. Returns: underSupplied (a good's producer blocks make less than its consumer blocks demand — for each, propose resizing the producer with reviseBlock, or a submitPlan `updates` entry, to the consumed rate), overProduced (surplus on a link), unsourcedImports (consumed but NO block produces it — craftable=true means a block could be drafted for it, else it's a raw to supply), danglingByproducts (produced but nothing consumes it, each with a disposal verdict: 'route' = productive consuming recipes exist [topConsumers], 'void' = only a vent/void disposal recipe [voidRecipes], 'nowhere' = must be stored/buffered — an open problem), and finalProducts (declared outputs nothing consumes — intentional, not waste). Electricity/heat are excluded (grid/local); fluid-fuel MJ is audited like any good. Use byproductSinks for deeper routing detail on one good, and turdConsistency for the TURD side of a factory audit.",
  inputSchema: z.object({}),
  execute: async () => runCoherenceAudit(),
});

/** Resolve a recipe's io into {name, amount} pairs, averaging ranged outputs. */
async function recipeIo(q: typeof import("../db/queries.server.ts"), name: string) {
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
 * can reuse it with full types (not via the tool's loosely-typed execute).
 * `targets` accepts one good (chainStatus's single `target`) or several (a
 * multi-goal block draft, #38) — every target good is excluded from
 * `byproducts`, not just the first. */
async function computeChainStatus(recipes: string[], targets: string | string[]) {
  const targetList = Array.isArray(targets) ? targets : [targets];
  const targetSet = new Set(targetList);
  const target = targetList[0] ?? "";
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
    (g) => !consumed.has(g) && !targetSet.has(g) && !PSEUDO_GOODS.has(g),
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
    return { masters: q.turdChoicesLookup({ master, recipe, good }) };
  },
});

export const researchPath = tool({
  description:
    "Prerequisite closure and science cost to unlock a TARGET — a technology, a recipe, or an item/fluid good (whichever it is, in that priority; resolve fuzzy names via searchGoods first). Returns the NOT-yet-researched techs in DEPENDENCY order (prerequisites first, the tech that actually unlocks the target last), each with its OWN science-pack cost, plus totalCost summed across the WHOLE path (even when `steps` is truncated by `limit`) — the number to report for 'research X, ~N packs total'. Respects the REAL researched state synced from the connected save (or manually marked in Settings), independent of the current planning-horizon mode. alreadyUnlocked=true means nothing to research (a start-enabled recipe/good already covers it). For a recipe/good with more than one unlocking tech, targetTech is the cheapest (lowest-tier) route and alternateRoutes lists the others by name — call this again with one of those tech names if you want ITS path instead. turdGatesNeeded lists any TURD branch this path also needs picked (state 'pickable' = master undecided, free choice; 'blocked' = a DIFFERENT branch is already selected on that master — this route needs a respec) — same as elsewhere, a TURD pick is the user's call, never something this tool applies. Use this to state a plan's research route instead of just naming gating packs.",
  inputSchema: z.object({
    target: z
      .string()
      .describe(
        "Internal name of a technology (e.g. 'electronics'), a recipe (e.g. 'battery-mk01'), or an item/fluid good (e.g. 'processing-unit')",
      ),
    limit: z
      .number()
      .int()
      .min(5)
      .max(150)
      .default(40)
      .describe(
        "Max steps to list, keeping the ones closest to the target (dropping the earliest/most-foundational ones first when the path is deep); totalCost always sums the WHOLE path regardless",
      ),
  }),
  execute: async ({ target, limit }) => {
    const r = q.researchPath(target);
    if (!r.ok) return { ok: false, target, error: r.error };
    if (r.alreadyUnlocked || !r.targetTech) {
      return {
        ok: true,
        target,
        kind: r.targetKind,
        display: r.targetDisplay,
        alreadyUnlocked: r.alreadyUnlocked,
        note: r.alreadyUnlocked
          ? "already unlocked — nothing to research"
          : "no tech unlocks this (raw resource, or currently unreachable)",
      };
    }
    const truncated = r.steps.length > limit;
    const shown = truncated ? r.steps.slice(r.steps.length - limit) : r.steps;
    return {
      ok: true,
      target,
      kind: r.targetKind,
      display: r.targetDisplay,
      targetTech: r.targetTech,
      targetTechDisplay: r.targetTechDisplay,
      alternateRoutes: r.alternateRoutes.length ? r.alternateRoutes : undefined,
      steps: shown.map((s) => ({ tech: s.tech, display: s.display, cost: io(s.packs) })),
      stepsOmitted: truncated ? r.steps.length - shown.length : undefined,
      totalCost: io(r.totalPacks),
      turdGatesNeeded: r.turdGatesNeeded.length ? r.turdGatesNeeded : undefined,
    };
  },
});

/** One output goal in a block draft's request (#38): EITHER a throughput
 * `rate` OR a keep-IN-STOCK `stock` amount (+ optional refill `window`,
 * seconds — defaults to 10 min). A stock goal's solver rate is DERIVED
 * (stock/window), never a fabricated continuous rate — the right primitive
 * for a construction/mall block ("keep 80 vrauks-paddock on hand"). */
const blockGoalInput = z
  .object({
    name: z.string().describe("Internal name of the good this goal targets"),
    rate: z
      .number()
      .positive()
      .optional()
      .describe(
        "Target throughput (items or fluid units per second). Omit for a keep-in-stock goal (`stock`).",
      ),
    stock: z
      .number()
      .positive()
      .optional()
      .describe(
        "Keep-in-stock amount instead of a throughput target — 'keep N on hand'. The solver rate is " +
          "DERIVED as stock/window (a buffer-refill rate), never a fabricated continuous rate. Use for " +
          "building/mall-supply goals (e.g. seed `stock` from buildingBill's machine `count` to keep " +
          "that many vrauks-paddock/cages/furnaces on hand) instead of guessing a rate.",
      ),
    window: z
      .number()
      .positive()
      .default(STOCK_WINDOW_DEFAULT)
      .describe(
        "Refill window in seconds for a stock goal (default 600 = 10 min) — machines are sized to " +
          "rebuild the buffer within this window. Ignored without `stock`.",
      ),
  })
  .refine((g) => (g.rate != null && g.rate > 0) || (g.stock != null && g.stock > 0), {
    message: "each goal needs a positive `rate` or a positive `stock`",
  });
type BlockGoalInput = z.infer<typeof blockGoalInput>;

/** A resolved goal ready for computeBlock: name + solver rate (derived from
 * stock/window when it's a stock goal), plus stock/window kept for the draft
 * return (so the apply path can persist them). */
type ResolvedGoal = { name: string; rate: number; stock?: number; window?: number };

/** Resolve a block-draft's goal input to solver-ready goals — either the
 * `goals` array (#38, multi-goal + stock support) or the legacy single
 * `target`+`rate` shorthand. `goals[0]` (or `target`) anchors naming/sizing. */
function resolveGoals(input: {
  target?: string;
  rate?: number;
  goals?: BlockGoalInput[];
}): ResolvedGoal[] {
  if (input.goals?.length) {
    return input.goals.map((g) => {
      const window = g.window ?? STOCK_WINDOW_DEFAULT;
      const rate = g.rate ?? g.stock! / window;
      return { name: g.name, rate, ...(g.stock != null ? { stock: g.stock, window } : {}) };
    });
  }
  return [{ name: input.target ?? "", rate: input.rate ?? 1 }];
}

const blockDraftInput = z
  .object({
    name: z.string().optional().describe("Optional display name for this block"),
    target: z
      .string()
      .optional()
      .describe(
        "Internal name of the good this block produces — shorthand for a single goal " +
          "(goals[0].name). Omit when passing `goals`.",
      ),
    rate: z
      .number()
      .positive()
      .optional()
      .describe(
        "Target output rate for `target` (items or fluid units per second) — shorthand for " +
          "goals[0].rate. Omit when passing `goals`.",
      ),
    goals: z
      .array(blockGoalInput)
      .min(1)
      .optional()
      .describe(
        "Multiple output goals for this block (#38) — goals[0] anchors its naming/sizing. Each goal " +
          "is EITHER a throughput `rate` OR a keep-in-stock `stock` (+ optional `window` seconds, " +
          "default 600) — a building/mall-supply block holds SEVERAL 'keep N of this building on " +
          "hand' goals at once. Prefer this over the legacy `target`+`rate` shorthand whenever the " +
          "block has more than one output or any stock goal.",
      ),
    recipes: z.array(z.string()).min(1).describe("The complete recipe list for THIS block"),
    subBlocksNeeded: z.array(z.string()).optional().describe("Seam goods for follow-up blocks"),
    notes: z
      .string()
      .optional()
      .describe("Short rationale: tier choices, where you cut, reused blocks, byproducts"),
  })
  .refine((v) => (v.goals?.length ?? 0) > 0 || (v.target != null && v.rate != null), {
    message: "pass either `goals` (at least one) or both `target` and `rate`",
  });

/** Two-pass module-fill solve shared by every block draft/bill tool
 * (submitBlock/reviseBlock/submitPlan AND buildingBill): module suggestions are
 * derived from the provisional solve's exact rates without invoking the LP a
 * second time; a drafted/billed block then adopts them as explicit picks
 * (pinning the machine they were sized for) and re-solves so counts/power/imports
 * reflect them. Before this was
 * shared, buildingBill skipped this second pass entirely — its bare
 * `computeBlock({goals, recipes})` under-counted Py's creature/farm buildings
 * (intentionally near-useless unmoduled) by ~10-15x and disagreed with
 * submitBlock's own (already module-filled) counts for the same recipes. */
async function solveWithModuleFill(goals: { name: string; rate: number }[], recipes: string[]) {
  const provisional = await computeBlock({ goals, recipes });
  const suggestions =
    provisional.status === "solved" &&
    provisional.rows.some((row) => (row.machine?.moduleSlots ?? 0) > 0)
      ? computeModuleSuggestions(
          { goals, recipes },
          provisional.rows.map((row) => ({
            recipe: row.recipe,
            rate: row.rate,
            machine: row.machine?.name ?? null,
          })),
        )
      : {};
  const modules: Record<string, string[]> = {};
  const machines: Record<string, string> = {};
  for (const row of provisional.rows) {
    const suggested = suggestions[row.recipe];
    if (suggested?.length && row.machine) {
      modules[row.recipe] = suggested;
      machines[row.recipe] = row.machine.name;
    }
  }
  const solved = Object.keys(modules).length
    ? await computeBlock({ goals, recipes, modules, machines })
    : provisional;
  return { solved, modules, machines };
}

async function buildBlockDraft(input: z.infer<typeof blockDraftInput>) {
  const { recipes, subBlocksNeeded, notes } = input;
  const resolved = resolveGoals(input);
  const target = resolved[0]?.name ?? "";
  const rate = resolved[0]?.rate ?? 0;
  const goalNames = resolved.map((g) => g.name);
  const status = await computeChainStatus(recipes, goalNames);
  const suppliers = q.goodSuppliers();
  const rates = new Map<string, number>();
  let powerW: number | null = null;
  let heatW: number | null = null;
  let solvedImportNames: string[] | null = null;
  let solvedByproductNames: string[] | null = null;
  let buildings: { recipe: string; machine: string; count: number }[] = [];
  let moduleFill: { modules: Record<string, string[]>; machines: Record<string, string> } = {
    modules: {},
    machines: {},
  };
  try {
    const goals = resolved.map((g) => ({ name: g.name, rate: g.rate }));
    const { solved, modules, machines } = await solveWithModuleFill(goals, recipes);
    moduleFill = { modules, machines };
    for (const f of solved.imports) rates.set(f.name, +f.rate.toFixed(3));
    for (const f of solved.exports) rates.set(f.name, +f.rate.toFixed(3));
    powerW = solved.power?.totalW ?? null;
    heatW = solved.power?.heatW ?? null;
    solvedImportNames = solved.imports.map((f) => f.name).filter((n) => !POWER_PSEUDO.has(n));
    solvedByproductNames = solved.exports
      .map((f) => f.name)
      .filter((n) => !POWER_PSEUDO.has(n) && !goalNames.includes(n));
    buildings = machineReqs(solved.rows).map((b) => ({
      recipe: b.recipe,
      machine: b.machine,
      count: +b.count.toFixed(2),
    }));
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
    // full goal set (#38): name/rate + stock/window when it's a keep-in-stock
    // goal — the apply path (assistant.tsx) persists THIS, not just target/rate.
    goals: resolved.map((g) => ({
      name: g.name,
      rate: g.rate,
      ...(g.stock != null ? { stock: g.stock, window: g.window } : {}),
    })),
    recipes,
    modules: moduleFill.modules,
    machines: moduleFill.machines,
    // solved building count per recipe (rounded), from computeBlock's machine
    // counts — lets the agent report/aggregate machine needs without a second
    // solve (see buildingBill for cross-block aggregation)
    buildings,
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
    "Finalize your proposed production block for ONE target, bounded at its seams. Call ONCE at the end. The block's open inputs are its imports; each import is either already made by an existing block (reuse it) or is a commodity/raw. List in subBlocksNeeded any seam goods that deserve their OWN block next (the decomposition follow-ups). Accepts either the single `target`+`rate` shorthand OR a `goals` array (#38) for MULTIPLE outputs, each a throughput rate or a keep-IN-STOCK amount (+window) — the right primitive for a building/mall-supply block ('keep 80 vrauks-paddock on hand') instead of a fabricated continuous rate; goals[0] anchors naming/sizing. It SOLVES the block (module slots auto-filled — see 'MODULES' below), so imports / byproducts / sub-blocks / buildings come back with their actual per-second RATES / counts — use those: tell the user to draft each sub-block at its rate (e.g. 'super-alloy block @ 3.3/s'). Returns imports split into from-existing-block vs external, byproducts, power, and `buildings` — each recipe's machine + solved building count, MODULE-FILLED (the same counts buildingBill reports for the same recipes — no more disagreeing between the two tools). For a machine-only bill across MULTIPLE blocks (e.g. 'include the buildings to build this'), use buildingBill instead.",
  inputSchema: blockDraftInput,
  execute: async (input) => buildBlockDraft(input),
});

/** Re-solve an existing block at a new rate and/or with a REVISED recipe set
 * (#12) and return it as an "update" draft the user approves before it's
 * applied. A recipe revision re-runs the closure check, so the draft carries the
 * added/removed recipes and any byproducts the block didn't have before. */
async function buildBlockUpdate({
  blockId,
  rate,
  recipes,
  notes,
}: z.infer<typeof reviseBlockInput>) {
  const row = q.getBlock(blockId);
  if (!row) {
    return { ok: false, kind: "update" as const, updateBlockId: blockId, missing: true };
  }
  const data = normalizeBlockData(row.data);
  const primary = primaryGoal(data);
  if (rate == null && recipes == null) {
    return {
      ok: false,
      kind: "update" as const,
      updateBlockId: blockId,
      blockName: row.name,
      error: "pass a new rate, a new recipe list, or both — nothing to revise otherwise",
    };
  }
  const newRecipes = recipes ?? data.recipes;
  // Re-rate the anchor goal but PRESERVE the rest of the block's goals — including
  // any keep-in-stock ones (#38) — so this preview solve (and what setBlockRateFn/
  // setBlockRecipesFn actually persist via the same withPrimaryRate) agree on what
  // the block produces. Scoped down deliberately: reviseBlock re-rates the anchor,
  // it doesn't let the assistant restructure a block's whole goal set.
  const rerated = rate != null ? withPrimaryRate(data, rate) : data;
  const preservedGoals = (rerated.goals ?? [])
    .filter((g) => g.name)
    .map((g) => ({
      name: g.name,
      rate: g.rate,
      window: g.window ?? STOCK_WINDOW_DEFAULT,
      ...(g.stock != null ? { stock: g.stock } : {}),
    }));
  const draft = await buildBlockDraft(
    preservedGoals.length
      ? { goals: preservedGoals, recipes: newRecipes, notes }
      : {
          target: primary?.name ?? "",
          rate: rate ?? primaryRate(data),
          recipes: newRecipes,
          notes,
        },
  );
  const oldSet = new Set(data.recipes);
  const newSet = new Set(newRecipes);
  const recipesAdded = newRecipes.filter((r) => !oldSet.has(r));
  const recipesRemoved = data.recipes.filter((r) => !newSet.has(r));
  // Byproducts the block's CURRENT solve doesn't export — new dangling outputs a
  // recipe swap can introduce; the user sees them flagged before applying.
  const oldOutputs = new Set(
    q
      .getBlockFlows(blockId)
      .filter((f) => f.role !== "import")
      .map((f) => f.item),
  );
  const newByproducts = draft.byproducts.map((b) => b.good).filter((g) => !oldOutputs.has(g));
  return {
    ...draft,
    kind: "update" as const,
    updateBlockId: blockId,
    blockName: row.name,
    oldRate: primaryRate(data),
    recipesAdded,
    recipesRemoved,
    newByproducts,
  };
}

const reviseBlockInput = z.object({
  blockId: z
    .number()
    .int()
    .describe("id of the existing block to revise (the `id` from factoryBlocks)"),
  rate: z
    .number()
    .positive()
    .optional()
    .describe(
      "New target output rate (items or fluid units per second); omit to keep the current rate",
    ),
  recipes: z
    .array(z.string())
    .min(1)
    .optional()
    .describe(
      "REPLACEMENT recipe list for the block — the COMPLETE new set, not a delta (start from the block's current recipes in factoryBlocks/chain data and add/remove/swap). Omit to keep the current recipes.",
    ),
  notes: z
    .string()
    .optional()
    .describe("Why the block is changing (e.g. 'swap to the hot-air molten-iron variant')"),
});

export const reviseBlock = tool({
  description:
    "Propose changing an EXISTING block (by its factoryBlocks id) — its output RATE, its RECIPE SET, or both — instead of building a duplicate. Pass `rate` to raise/lower output to meet new demand; pass `recipes` (the complete replacement list) to add/remove/swap recipes (e.g. swap to a higher-yield variant, add a byproduct-consuming step). `rate` only re-rates the block's ANCHOR (first) goal — any other goals it already has, including keep-in-stock ones (#38), are PRESERVED, not collapsed to a single goal. The block is RE-SOLVED with the change and returned as a PROPOSAL the user approves before it's applied: check the returned imports/byproducts for closure — a recipe change can open new imports or NEW dangling byproducts (returned in newByproducts; route them or say why they're fine BEFORE the user applies). Recipe revisions keep the block's other recipes' machine/module picks; removed recipes' picks are pruned on apply. Also returns `buildings` — the resized block's solved recipe→machine→count list, module-filled the same way submitBlock/buildingBill are.",
  inputSchema: reviseBlockInput,
  execute: async (input) => buildBlockUpdate(input),
});

export const submitPlan = tool({
  description:
    "Finalize a MULTI-BLOCK production plan for one user request. Use when the user asks for multiple products/rates, all supporting sub-blocks, or building/material supply such as steel, circuits, machines, belts, inserters, pipes, and power/utility items. Each block is solved independently (same `target`+`rate` shorthand or multi-goal/stock `goals` array as submitBlock — see its description) and returned as a reviewable draft (including its own module-filled `buildings` — recipe→machine→solved count); include dependency notes and remaining external imports. Prefer focused reusable blocks over one giant block. Call buildingBill separately once the plan's blocks are chosen if you need the CROSS-BLOCK machine bill (whole-machine totals + how to build each machine, same module-filled counts) for 'include the buildings' requests.",
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
        "Existing blocks (by factoryBlocks id) to REVISE for this plan — resize to a new rate and/or swap their recipe set — instead of duplicating them. Use for already-built material/mall blocks that are too small.",
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

const buildingBillBlockInput = z
  .object({
    name: z.string().optional().describe("Optional label; not used in the solve"),
    target: z
      .string()
      .optional()
      .describe(
        "Internal name of the good this block produces — shorthand for goals[0].name. Omit when passing `goals`.",
      ),
    rate: z
      .number()
      .positive()
      .optional()
      .describe(
        "Target output rate for `target` — shorthand for goals[0].rate. Omit when passing `goals`.",
      ),
    goals: z
      .array(blockGoalInput)
      .min(1)
      .optional()
      .describe(
        "Multiple output goals for this block, same shape as submitBlock/submitPlan — include any " +
          "keep-in-stock goals here too so the machine bill reflects them (a mall block's several " +
          "'keep N on hand' goals all feed into its machine counts).",
      ),
    recipes: z.array(z.string()).min(1).describe("The complete recipe list for THIS block"),
  })
  .refine((v) => (v.goals?.length ?? 0) > 0 || (v.target != null && v.rate != null), {
    message: "pass either `goals` (at least one) or both `target` and `rate`",
  });

export const buildingBill = tool({
  description:
    "THE tool for 'include the buildings/machines needed to build this' — a cross-block MACHINE bill. Give the same blocks you're drafting/planning (target/rate, or a multi-goal/stock `goals` array — same shape as submitPlan's blocks); each is solved independently with the SAME module-fill pass submitBlock uses (a failing block is skipped with a note in `skipped`, not a hard error) and every recipe's machine requirement is CEILED to a whole building before being summed across ALL blocks — you build whole machines, so a 2.3 + 1.4 need doesn't round to 4 the way raw fractional counts would. Because the module fill is shared with submitBlock, counts here AGREE with a submitBlock draft's `buildings` for the same recipes — no more reporting a bare unmoduled count for Py's creature/farm buildings (near-useless unmoduled, ~10-15x this bill without the fill) than the block actually needs. Returns `machines`, sorted by count descending: each entry maps the machine ENTITY to the ITEM that places it (`item`, null with a note if no such item exists), its total whole-building count, and up to 2 top `producers` (same shape as recipeOptions) for how to make that item. Call this after you've picked each block's recipes (before or after submitPlan) — then for EACH machine item decide: an existing mall/materials block already supplies it (import), an existing block should be resized to cover it (reviseBlock / a plan `updates` entry), or it needs its own new block — sized with a KEEP-IN-STOCK goal (seed `stock` from this tool's `count`), not a fabricated rate. Machine items ONLY — this does not estimate belts/inserters/logistics.",
  inputSchema: z.object({
    blocks: z
      .array(buildingBillBlockInput)
      .min(1)
      .max(20)
      .describe("The plan's blocks (or a single block) to total machine requirements across"),
  }),
  execute: async ({ blocks }) => {
    const totals = new Map<string, number>(); // machine entity -> whole-building count
    const skipped: { target: string; error: string }[] = [];
    for (const block of blocks) {
      const resolved = resolveGoals(block);
      try {
        const goals = resolved.map((g) => ({ name: g.name, rate: g.rate }));
        const { solved } = await solveWithModuleFill(goals, block.recipes);
        for (const b of machineReqs(solved.rows)) {
          const count = Math.ceil(b.count - 1e-9); // whole machines per block, THEN sum
          if (count <= 0) continue;
          totals.set(b.machine, (totals.get(b.machine) ?? 0) + count);
        }
      } catch (e) {
        skipped.push({
          target: resolved[0]?.name ?? "?",
          error: e instanceof Error ? e.message : "solve failed",
        });
      }
    }
    const machines = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([entity, count]) => {
        const item = q.getItem(entity);
        return {
          item: item ? entity : null,
          display: item?.display ?? entity,
          entity,
          count,
          producers: item ? optionsFor(q, entity, "produce", 2) : [],
          ...(item
            ? {}
            : { note: "no matching item prototype — can't be crafted/placed as an item" }),
        };
      });
    return { machines, skipped };
  },
});

export const factoryPower = tool({
  description:
    "Factory-WIDE electric power rollup — total demand vs generation across every existing (enabled) block, in ONE call (no required arguments). DEMAND is each block's cached machine draw (electricityW — the same figure the Factory page's header totals; no re-solve). GENERATION is each block's NET production of the pyops-electricity pseudo-good — already tracked from that block's last real solve (a generating recipe: turbine/generator/solar-panel/burner-generator), so a 'power block' is identified with no extra work from you. Returns blocks (count considered), totalDemandW, totalGenerationW, netW (generation minus demand — negative means the factory doesn't generate enough to cover its own draw), topConsumers (up to `limit` blocks sorted by draw descending), and generators (every block with nonzero net generation, sorted descending). A block CAN appear on both lists (e.g. a reactor block that also draws power for its own auxiliary machines) — consumption and generation are computed independently per block, so don't net them per-block; only compare the two TOTALS. Heat is intentionally NOT covered here — it's a short-range (~15 tile), block-LOCAL mechanic in Py hard mode with no cross-block rollup; read a block's own heatW from submitBlock/reviseBlock instead.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(10)
      .describe("Max blocks to list in topConsumers"),
  }),
  execute: async ({ limit }) => {
    const rows = q.factoryPower();
    const totalDemandW = rows.reduce((s, r) => s + r.consumesW, 0);
    const totalGenerationW = rows.reduce((s, r) => s + r.generatesW, 0);
    const topConsumers = rows
      .filter((r) => r.consumesW > 0)
      .sort((a, b) => b.consumesW - a.consumesW)
      .slice(0, limit)
      .map((r) => ({ blockId: r.blockId, name: r.name, watts: r.consumesW }));
    const generators = rows
      .filter((r) => r.generatesW > 0)
      .sort((a, b) => b.generatesW - a.generatesW)
      .map((r) => ({ blockId: r.blockId, name: r.name, watts: r.generatesW }));
    return {
      blocks: rows.length,
      totalDemandW,
      totalGenerationW,
      netW: totalGenerationW - totalDemandW,
      topConsumers,
      generators,
    };
  },
});

const whatIfOverride = z.object({
  good: z
    .string()
    .describe("Internal item/fluid name whose rate to override, e.g. 'py-science-pack-1'"),
  rate: z
    .number()
    .min(0)
    .describe("New target rate (items or fluid units per second) for this good"),
});

export const whatIf = tool({
  description:
    "Factory-WIDE demand-override simulation — 'if I set <good> to N/s, what changes?'. Give one or more {good, rate} overrides for FINAL PRODUCTS (a primary output nothing else consumes — check factoryBlocks/coherenceAudit if unsure); overriding a good another block still consumes has NO effect and comes back in `ignoredOverrides`, not silently applied. Solves the whole factory as one LP (every block's cached flows at a scale factor) and returns `blocksToResize` — every block whose rate must change as a result, INCLUDING the ripple through upstream blocks that feed it, sorted by size of change — each entry's `blockId`+`rate` is ready to pass STRAIGHT into reviseBlock or a submitPlan `updates` entry, no relabeling needed. Also returns `demands` (every final product's current vs. target, including ones you left alone), `rawsNeeded` (external draw current vs. projected), and `overproduced` (byproduct surplus the ripple creates or grows, each with an `absorb` hint — an existing sink block + the scale to soak it up — when one exists). `status` is the LP solve status; anything but 'Optimal' means the override can't be fully met with the current blocks/recipes — say so and treat it as a prompt to add a producer. Report-only: never writes anything, purely a what-if. Pairs with the scale-up-don't-duplicate guidance — this gives it exact numbers.",
  inputSchema: z.object({
    overrides: z
      .array(whatIfOverride)
      .min(1)
      .max(20)
      .describe(
        "Demand overrides to simulate; every other final product stays at its current rate",
      ),
  }),
  execute: async ({ overrides }) => {
    await ensureSolvedProjections();
    const demandOverrides = Object.fromEntries(overrides.map((o) => [o.good, o.rate]));
    const result = await factoryWhatIf(q.blocksWithFlows(), demandOverrides);

    const blocksToResize = result.blocks
      .filter((b) => Math.abs(b.delta) > 1e-3)
      .map((b) => ({
        blockId: b.id,
        name: b.name,
        good: b.good,
        currentRate: b.currentRate,
        rate: b.requiredRate,
        scale: b.scale,
        delta: b.delta,
      }));

    const appliedGoods = new Set(result.demands.map((d) => d.good));
    const ignoredOverrides = overrides
      .filter((o) => !appliedGoods.has(o.good))
      .map((o) => ({
        good: o.good,
        note: "not recognized as a final product (either consumed by another block, or never produced) — overriding it has no effect on the solve; use reviseBlock directly on its producing block instead",
      }));

    return {
      status: result.status,
      blocksToResize,
      ignoredOverrides,
      demands: result.demands,
      rawsNeeded: result.raws.filter((r) => r.projected > 1e-3),
      overproduced: result.overproduced.map((o) => ({
        ...o,
        absorb: o.absorb
          ? { blockId: o.absorb.id, name: o.absorb.name, scale: o.absorb.scale }
          : null,
      })),
    };
  },
});

export const logisticsFor = tool({
  description:
    "Belts and inserters/loaders needed to move a good at a given rate — the logistics half buildingBill deliberately leaves out (#126). For an ITEM: every belt tier UNLOCKED under the research horizon with the whole belt count + saturation (how full the built belts run — reads directly as 'can one yellow belt feed this?'), and every unlocked inserter/loader with the whole-device count to move the rate through ONE feed point. Counts already reflect researched belt/inserter/bulk-inserter stack bonuses — the same math as the block editor's per-row logistics readout (#21). For a FLUID, returns kind:'fluid' with a note — pipe throughput isn't modelled, so only call this for items. Pair with buildingBill for full construction coverage: machines from buildingBill, belts/inserters/loaders from this, one call per good/rate you need covered.",
  inputSchema: z.object({
    good: z
      .string()
      .describe(
        "Internal item/fluid name to move, e.g. 'iron-plate' (resolve via searchGoods first)",
      ),
    rate: z
      .number()
      .positive()
      .describe(
        "Target throughput, items/second (or fluid units/second — a fluid short-circuits to a note)",
      ),
  }),
  execute: async ({ good, rate }) => q.logisticsForGood(good, rate),
});

export const blockBuildStatus = tool({
  description:
    "Built-vs-required MACHINE status for blocks that ALREADY EXIST, from the last synced game state — the answer to 'what's left to build for the coke block' / 'which blocks are under-built'. Works OFFLINE: reads the block's cached solved machine requirement (block_machines, CEILED to whole buildings — same source submitBlock's `buildings` field reports) against the synced built-machine snapshot (built_machines); no live bridge call, no re-solve. STALE the moment the player places/removes something in-game until their next save-load or Sync in the PyOps panel — check `syncedAt` and say how old it is if it matters, or if it's null say no sync has ever happened. Pass `blockId` (a factoryBlocks id) for one block's full breakdown (returned even if fully built or the block is disabled, and `limit` is ignored); omit it to list up to `limit` ENABLED blocks with a shortfall, worst-missing first. Each `recipes` row is the machine + recipe + required whole-building count + built count + missing delta; `built`/`missing` come back null on a row whose machine type never reports a recipe to the game (boilers/generators/reactors/offshore-pumps — e.g. a local heat-source reactor) — those are instead summarized once per machine in `machineFallback` (requiredTotal/builtTotal/missing), since the game can't tell you which recipe it's running. Built counts are FORCE-WIDE, not block-scoped: if two blocks share the exact same machine+recipe, each independently compares against the same built count. For a NEW plan's cross-block machine bill use buildingBill instead — this tool audits blocks that already exist.",
  inputSchema: z.object({
    blockId: z
      .number()
      .int()
      .optional()
      .describe(
        "A factoryBlocks id to check ONE specific block (returned even if fully built or disabled); omit to list every ENABLED block with a shortfall, worst-missing first.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(10)
      .describe("Max blocks to list when omitting blockId (ignored when blockId is given)"),
  }),
  execute: async ({ blockId, limit }) => {
    await ensureSolvedProjections();
    if (blockId != null && !q.getBlock(blockId)) {
      return { ok: false, error: "no such block", blocks: [] };
    }
    const meta = q.metaAll();
    return {
      ok: true,
      syncedAt: meta.built_synced_at ?? null,
      syncedCount: meta.built_synced_count ? Number(meta.built_synced_count) : null,
      blocks: q.blockBuildStatus(blockId, blockId != null ? undefined : limit),
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
    tasksDb.listTasks().map((n) => ({
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
    const task = tasksDb.getTask(id);
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
    // one undoable action for the whole tool call — task + steps + links (#90)
    const id = await withUndoAction(`Assistant: create task "${title}"`, () => {
      const t = tasksDb;
      const taskId = t.createTask({ title, body, parentId: parentId ?? null });
      for (const s of steps ?? []) if (s.trim()) t.addStep(taskId, s);
      for (const l of links ?? []) t.addLink(taskId, l.kind, l.name);
      return taskId;
    });
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
    await withUndoAction("Assistant: update task", () =>
      tasksDb.updateTask(id, { title, body, status }),
    );
    return { ok: true };
  },
});

export const addTaskStep = tool({
  description: "Append a checklist step to an existing task.",
  inputSchema: z.object({ taskId: z.number().int(), text: z.string() }),
  execute: async ({ taskId, text }) => ({
    ok: true,
    id: await withUndoAction("Assistant: add task step", () => tasksDb.addStep(taskId, text)),
  }),
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
    id: await withUndoAction("Assistant: link task", () => tasksDb.addLink(taskId, kind, name)),
  }),
});

export const listNotes = tool({
  description:
    "List the user's scratch notes: id, title, body. Notes are a small, freeform surface for their own goals/decisions/reminders — separate from the task tree and NOT assistant-writable. Consult this for planning context (e.g. before answering 'what should I do next'); never propose creating or editing a note.",
  inputSchema: z.object({}),
  execute: async () => tasksDb.listNotes().map((n) => ({ id: n.id, title: n.title, body: n.body })),
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
      const r = await requestFromMod("cmd.game_context", {});
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
      const r = await requestFromMod("cmd.inspect_area", { x, y, radius, surface });
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
      const r = await requestFromMod("cmd.find_entities", { name, surface, limit });
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
      const r = await requestFromMod("cmd.production", { goods });
      return { ok: true, ...(r as object) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "bridge error" };
    }
  },
});

/** The in-app assistant's gameEval is gated (#15): the tool call does NOT run
 * the Lua — it returns the snippet as a PROPOSAL the chat UI renders with a
 * per-call Run/Dismiss control. Only the user's explicit Run sends `cmd.eval`
 * over the bridge (`bridgeEvalFn`), which is what makes "the player is in
 * control" true and lets the agent request careful in-game WRITE actions too. */
export const gameEval = tool({
  description:
    "PROPOSE a Lua snippet to run in the live game (via the companion mod). The snippet is NOT executed by this call: it's shown to the user in the chat with a Run button — every call needs their explicit per-call approval, and they can share the output back with you afterwards. Use it when the structured game tools (gameContext/inspectArea/findEntities/production) aren't enough: deeper reads (an entity's status/recipe/inventory, fluidbox contents, force/research data, ad-hoc counts) or — with the user clearly asking for it — careful in-game write actions (set research, fix an entity's state). Keep each snippet small, single-purpose, and explain what it does in `note`; NEVER bundle unrelated changes. `player` is pre-bound; a bare expression is auto-returned; the result is a string repr. Single-player only. Examples: `player.selected.status`, `#player.surface.find_entities_filtered{type='lab'}`, `player.force.technologies['automation'].researched`. After proposing, tell the user what the snippet does and wait — do NOT assume it ran.",
  inputSchema: z.object({
    code: z
      .string()
      .describe("Lua chunk — a bare expression, or statements with an explicit return"),
    note: z
      .string()
      .optional()
      .describe("One line for the user: what this snippet does and why (shown on the card)"),
  }),
  execute: async ({ code, note }) => ({
    proposed: true as const,
    code,
    note: note ?? null,
    status:
      "awaiting user approval — the snippet runs only if the user clicks Run in the chat; they may share the result with you afterwards",
  }),
});

/** Ungated eval for the MCP surface (developer debugging drives the running
 * game directly — there's no chat UI to approve through). Same body the chat
 * tool had before the #15 gate; the mod-side `pyops-allow-eval` setting is the
 * kill switch for both paths. */
const gameEvalDirect = tool({
  description:
    "Run a Lua chunk in the live game (via the companion mod) and return a string repr of the result — full game access, can mutate state. Developer/debugging surface (MCP): there is no approval UI here, so use deliberately. `player` is pre-bound; a bare expression is auto-returned. Single-player only. Examples: `player.selected.status`, `#player.surface.find_entities_filtered{type='lab'}`.",
  inputSchema: z.object({
    code: z
      .string()
      .describe("Lua chunk — a bare expression, or statements with an explicit return"),
  }),
  execute: async ({ code }) => {
    try {
      const r = await requestFromMod("cmd.eval", { code }, 8000);
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
      const r = (await requestFromMod("cmd.eval", { code: lua }, 8000)) as {
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
      const r = await requestFromMod("cmd.dev.reload_mods", { confirm }, 8000);
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
      const r = await showBlockInGame(blockId);
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
      const r = await hideBlockInGame();
      return { ok: r.sent };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "close error" };
    }
  },
});

/** The full tool set for the in-app planning agent: read-only data tools,
 * block/plan draft proposals (propose-then-apply), the buildings bill, the
 * tasks surface, and read-only live game-world inspection via the bridge.
 * gameScreenshot/gameReloadMods/gameShowBlock/gameCloseSummary are NOT here —
 * they're developer/debugging loop helpers (a local PNG path the in-app chat
 * can't consume, and dev-reload/self-test actions this assistant shouldn't
 * drive) and live only on the MCP surface below. */
export const agentTools = {
  searchGoods,
  factoryBlocks,
  recipeGraph,
  recipeOptions,
  recipeOptionsBatch,
  recipeInfo,
  calcRecipe,
  goodInfo,
  productionStats,
  byproductSinks,
  coherenceAudit,
  turdConsistency,
  availableTurds,
  turdChoices,
  researchPath,
  chainStatus,
  submitBlock,
  reviseBlock,
  submitPlan,
  buildingBill,
  factoryPower,
  whatIf,
  logisticsFor,
  blockBuildStatus,
  listTasks,
  getTask,
  createTask,
  updateTask,
  addTaskStep,
  linkTask,
  listNotes,
  gameContext,
  gameInspectArea,
  gameFindEntities,
  gameProduction,
  // Lua eval — GATED for the assistant (#15): the tool only PROPOSES the
  // snippet; the chat UI's per-call Run button executes it (bridgeEvalFn). The
  // mod-side `pyops-allow-eval` setting is the defense-in-depth kill switch.
  gameEval,
};

/** The MCP surface's tool set: everything the in-app agent has, gameEval
 * swapped for the DIRECT-executing variant (MCP is the developer-debugging
 * front door — no chat UI to route a per-call approval through), plus the
 * developer-only live-loop helpers the in-app assistant doesn't get: a
 * screenshot tool returning a local PNG path, mod reload, and the in-game
 * summary-panel show/close pair used for self-testing the mod's UI. */
export const mcpTools = {
  ...agentTools,
  gameEval: gameEvalDirect,
  gameScreenshot,
  gameReloadMods,
  gameShowBlock,
  gameCloseSummary,
};
