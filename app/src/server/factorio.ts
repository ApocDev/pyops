import { createServerFn } from "@tanstack/react-start";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BeaconConfig } from "./effects";
import {
  goalNames,
  normalizeBlockData,
  primaryGoal,
  primaryRate,
  withPrimaryRate,
} from "../lib/goals";

/**
 * Server functions exposing the query layer to the client. Server-only modules
 * are imported at the top level and referenced ONLY inside `.handler()` bodies:
 * the TanStack Start compiler replaces handlers with RPC stubs in the client
 * build and prunes these imports with them. Import protection (`*.server.ts`)
 * turns any accidental leak into a build error. Plain (non-server-fn) helpers
 * that need the query layer live in block-compute.server.ts, not here.
 */
import * as q from "../db/queries.server.ts";
import * as projects from "./projects.server.ts";
import * as dump from "./dump.server.ts";
import * as cfg from "./app-config.server.ts";
import { computeCostAnalysis } from "./cost-analysis.server.ts";
import { currentDatabaseFile } from "../db/index.server.ts";
import { factoryWhatIf } from "./factory-solve.server.ts";
import { APP_CONFIG_FILE, DATA_DIR, ICON_DATA_DIR, PROJECTS_DIR } from "./paths.server.ts";
import { withUndoAction } from "./undo-action.server.ts";
import {
  blockSaveConflict,
  blockUpdatedAt,
  boundaryFlows,
  computeBlock,
  defaultFuel,
  goalFlows,
  persistBlock,
  pickDefaultMachine,
  resolveAllBlocks,
  showBlockInGame,
  type SolveInput,
} from "./block-compute.server.ts";

export type { SolveInput } from "./block-compute.server.ts";

function pseudoDisplay(name: string) {
  if (name === "pyops-heat") return "heat";
  if (name === "pyops-electricity") return "electricity";
  return null;
}

export const statsFn = createServerFn({ method: "GET" }).handler(async () => q.stats());
export const dataCapabilitiesFn = createServerFn({ method: "GET" }).handler(async () =>
  q.dataCapabilities(),
);

export const searchItemsFn = createServerFn({ method: "GET" })
  .validator((query: string) => query)
  .handler(async ({ data }) => q.searchItems(data, 100));

/** Item + fluid search (by internal or display name) for the browser. */
export const searchAllFn = createServerFn({ method: "GET" })
  .validator((query: string) => query)
  .handler(async ({ data }) => q.searchAll(data, 80));

/** Full browser detail: item/fluid info + produced-by/consumed-by recipe cards. */
export const browseDetailFn = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(async ({ data }) => q.browseDetail(data));

export const itemDetailFn = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(async ({ data }) => {
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
export const spoilablesFn = createServerFn({ method: "GET" }).handler(async () => q.spoilables());

export const recipeDetailFn = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(async ({ data }) => {
    return {
      recipe: q.getRecipe(data),
      machines: q.machinesForRecipe(data),
      unlocks: q.recipeUnlocks(data),
    };
  });

export const entityDetailFn = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(async ({ data }) => q.entityDetail(data));

export const moduleInfoFn = createServerFn({ method: "GET" })
  .validator((names: string[]) => names)
  .handler(async ({ data }) => q.moduleInfo(data));

/** Classify a bare name (item/fluid/recipe) so prose refs render with icon+hover. */
export const classifyRefFn = createServerFn({ method: "GET" })
  .validator((data: string | { name: string; prefer?: "recipe" }) => data)
  .handler(async ({ data }) => {
    const name = typeof data === "string" ? data : data.name;
    if (typeof data !== "string" && data.prefer === "recipe") {
      const recipe = q.getRecipe(name);
      if (recipe) return { kind: "recipe" as const, display: recipe.display ?? name };
    }
    return q.classifyRef(name);
  });

export const recipesProducingFn = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(async ({ data }) => q.recipesProducing(data));

/** Resolve item-vs-fluid kind + display name for a set of goods — used to icon
 * and auto-name goal cells before a solve exists (a fluid goal with no recipe
 * yet, or naming a block after its first goal). */
export const goodInfoFn = createServerFn({ method: "GET" })
  .validator((names: string[]) => names)
  .handler(async ({ data }) => {
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
  .handler(async ({ data }) => q.recipeCandidates(data.name, data.mode));

export const recipesConsumingFn = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(async ({ data }) => q.recipesConsuming(data));

/** Machine options for a recipe (for the building picker popup) — with speed,
 * power, energy source, module slots, and unlock/tier info. */
export const machineOptionsFn = createServerFn({ method: "GET" })
  .validator((recipe: string) => recipe)
  .handler(async ({ data }) => q.machineOptionsForRecipe(data));

/** Module + beacon options for one recipe row (for the modules popup): the
 * chosen machine's slots, eligible modules, and beacon variants with their
 * eligible modules. */
export const modulePickerFn = createServerFn({ method: "GET" })
  .validator((d: { recipe: string; machine: string }) => d)
  .handler(async ({ data }) => q.modulePickerData(data.recipe, data.machine));

/* Module/beacon presets (saved loadouts). */
export const listModulePresetsFn = createServerFn({ method: "GET" }).handler(async () =>
  q.listModulePresets(),
);

export const saveModulePresetFn = createServerFn({ method: "POST" })
  .validator((d: { name: string; modules: string[]; beacons: BeaconConfig[] }) => d)
  .handler(async ({ data }) => {
    const name = data.name.trim() || "Preset";
    return {
      id: await withUndoAction(`Save module preset "${name}"`, () =>
        q.saveModulePreset(name, data.modules, data.beacons),
      ),
    };
  });

export const deleteModulePresetFn = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .handler(async ({ data }) => {
    await withUndoAction("Delete module preset", () => q.deleteModulePreset(data));
    return { ok: true };
  });

export type { BeaconConfig } from "./effects";

/** Solve a block live (for the editor). */
export const solveBlockFn = createServerFn({ method: "GET" })
  .validator((d: SolveInput) => d)
  .handler(async ({ data }) => computeBlock(data));

export const bridgeShowBlockFn = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .handler(async ({ data }) => showBlockInGame(data));

/** Save a block: solve once, persist the input + its cached I/O flows + power.
 * The name defaults to the target product; the icon columns cache the resolved
 * icon — the doc's explicit `icon` pick (#40) when set, else the first goal. */
export const saveBlockFn = createServerFn({ method: "POST" })
  .validator(
    (d: {
      id?: number | null;
      name?: string;
      data: SolveInput;
      /** Custom undo-stack description ("Remove 3 recipes from Iron Pulp");
       * defaults to Create/Edit block "<name>". */
      actionName?: string;
      /** Staleness guard (#90): the `updatedAt` (epoch seconds) of the row this
       * editor hydrated from. When the stored row is NEWER, the save is
       * rejected with `{ conflict: true }` — a stale editor (second tab, or one
       * that idled through an undo/external write) must rehydrate instead of
       * clobbering the newer state. Omit to skip the check (legacy behavior). */
      baseUpdatedAt?: number | null;
    }) => d,
  )
  .handler(async ({ data }) => {
    if (data.id != null && data.baseUpdatedAt != null) {
      const conflict = blockSaveConflict(data.id, data.baseUpdatedAt);
      if (conflict) return conflict;
    }
    const r = await computeBlock(data.data);
    const doc = normalizeBlockData(data.data) as SolveInput;
    const primary = primaryGoal(doc)?.name ?? "";
    const targetKind = q.getFluid(primary) ? "fluid" : "item";
    const name = data.name?.trim() || r.display[primary] || primary || "New block";
    const icon = doc.icon ?? { kind: targetKind, name: primary };
    const action =
      data.actionName ?? (data.id != null ? `Edit block "${name}"` : `Create block "${name}"`);
    const id = await withUndoAction(action, () =>
      persistBlock({ id: data.id, name, iconKind: icon.kind, iconName: icon.name }, data.data, r),
    );
    return { id, name, updatedAt: blockUpdatedAt(id) };
  });

export const listBlocksFn = createServerFn({ method: "GET" }).handler(async () => q.listBlocks());

export const loadBlockFn = createServerFn({ method: "GET" })
  .validator((id: number) => id)
  .handler(async ({ data }) => q.getBlock(data));

export const deleteBlockFn = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .handler(async ({ data }) => {
    const row = q.getBlock(data);
    if (!row) return { ok: true };
    await withUndoAction(`Delete block "${row.name}"`, () => q.deleteBlock(data));
    return { ok: true };
  });

/** Delete a block only if it's still untouched — no goal, no co-products, no
 * recipes (so no imports/exports either). Used to clean up throwaway "New block"
 * tabs that are closed without ever being used. Returns whether it deleted. */
export const deleteBlockIfEmptyFn = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .handler(async ({ data }) => {
    const row = q.getBlock(data);
    if (!row) return { deleted: false };
    const d = normalizeBlockData(row.data as SolveInput);
    const empty = goalNames(d).length === 0 && (d.recipes?.length ?? 0) === 0;
    // deliberately untracked (#90): reverting "closed an untouched New block
    // tab" would be pure noise on the undo stack, and nothing is lost
    if (empty)
      await withUndoAction("discard empty block", () => q.deleteBlock(data), { undo: false });
    return { deleted: empty };
  });

export const factoryTotalsFn = createServerFn({ method: "GET" }).handler(async () =>
  q.factoryTotals(),
);

/** Factory what-if: solve the whole factory for the per-block scale changes
 * that satisfy all demands/consumptions. `demands` overrides a final product's rate
 * (e.g. science → 2/s) to see the cascade; unspecified demands stay at current. */
export const factoryWhatIfFn = createServerFn({ method: "POST" })
  .validator((d: { demands?: Record<string, number> }) => d)
  .handler(async ({ data }) => {
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
  const m = q.metaAll();
  return {
    items: q.factoryProductionComparison(),
    syncedAt: m.stats_synced_at ?? null,
    syncedCount: m.stats_synced_count ? Number(m.stats_synced_count) : null,
  };
});

/** Re-solve every block and refresh its cached I/O flows + power, keeping its
 * identity (id/name/icon/data). Use after a solver change makes caches stale. */
export const recomputeAllBlocksFn = createServerFn({ method: "POST" }).handler(async () =>
  // system cache refresh, not a user edit — keep it off the undo stack (#90)
  withUndoAction(
    "recompute all blocks",
    async () => {
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
            { id: row.id, name: row.name, iconKind: row.iconKind, iconName: row.iconName },
            data,
            r,
          );
          ok++;
        } catch (e) {
          failed.push({
            id: b.id,
            name: b.name,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      return { ok, broken, failed };
    },
    { undo: false },
  ),
);

/** Drill-down: blocks producing/consuming one good (for the factory resource view). */
export const blocksForGoodFn = createServerFn({ method: "GET" })
  .validator((good: string) => good)
  .handler(async ({ data }) => q.blocksForGood(data));

/** Block-to-block wiring (links / unsourced / surplus) for the coherence view. */
export const factoryCoherenceFn = createServerFn({ method: "GET" }).handler(async () =>
  q.factoryCoherence(),
);

/** Scale-to-demand preview: re-solve one block at a new target rate and diff it
 * against its current solve — the concrete changes to hit the target (building
 * counts per recipe, imports, byproducts, power). Does NOT save. */
export const scalePlanFn = createServerFn({ method: "GET" })
  .validator((d: { blockId: number; newRate: number }) => d)
  .handler(async ({ data }) => {
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
    const row = q.getBlock(data.blockId);
    if (!row) return { ok: false };
    const input = withPrimaryRate(
      normalizeBlockData(row.data as SolveInput),
      data.rate,
    ) as SolveInput;
    const r = await computeBlock(input);
    if (r.broken) return { ok: false, broken: true };
    await withUndoAction(`Set "${row.name}" rate`, () =>
      persistBlock(
        { id: row.id, name: row.name, iconKind: row.iconKind, iconName: row.iconName },
        input,
        r,
      ),
    );
    return { ok: true };
  });

/* ── Projects (one sqlite db per mod list) ──────────────────────────────────── */

export const listProjectsFn = createServerFn({ method: "GET" }).handler(async () =>
  projects.listProjects(),
);

export const createProjectFn = createServerFn({ method: "POST" })
  .validator((name: string) => name)
  .handler(async ({ data }) => projects.createProject(data.trim() || "Project"));

export const setActiveProjectFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data }) => projects.setActiveProject(data));

export const removeProjectFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    await projects.removeProject(data);
    return { ok: true };
  });

/* ── Planner settings (module auto-fill) ────────────────────────────────────── */

export const plannerSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
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
  q.logisticsContext(),
);

/** Rocket-lift weights for the given items (null = unset → default applies). */
export const itemWeightsFn = createServerFn({ method: "GET" })
  .validator((names: string[]) => names)
  .handler(async ({ data }) => q.itemWeights(data));

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
  q.getExclusions(),
);
export const setExclusionsFn = createServerFn({ method: "POST" })
  .validator((d: { globs?: string[] }) => d)
  .handler(async ({ data }) => {
    q.setExclusions(data);
    return { ok: true };
  });

/** Research/TURD planning horizon: now vs future, available science packs,
 * explicitly-researched techs (mock for the mod bridge). */
export const researchHorizonFn = createServerFn({ method: "GET" }).handler(async () => {
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
    q.setResearchHorizon(data);
    return { ok: true };
  });

/** App-level AI config (OpenRouter key + model). Env always wins; the stored value
 * is the UI default. The key itself is never sent back — only whether one is set. */
export const aiConfigFn = createServerFn({ method: "GET" }).handler(async () => {
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
    const patch: { openrouterApiKey?: string; model?: string } = {};
    if (data.openrouterApiKey !== undefined) patch.openrouterApiKey = data.openrouterApiKey ?? "";
    if (data.model !== undefined) patch.model = data.model ?? "";
    cfg.writeAppConfig(patch);
    return { ok: true };
  });

/** Resolve a good to the tech that first unlocks making it — for the target-horizon
 * picker, so the user can search by item and see which tech gates it. */
export const goodUnlockTechFn = createServerFn({ method: "GET" })
  .validator((good: string) => good)
  .handler(async ({ data }) => q.unlockTechForGood(data));

/** Tech search for the researched-tech picker (+ display names for chips). */
export const searchTechsFn = createServerFn({ method: "GET" })
  .validator((q: string) => q)
  .handler(async ({ data }) => q.searchTechs(data, 30));
export const techDisplaysFn = createServerFn({ method: "GET" })
  .validator((names: string[]) => names)
  .handler(async ({ data }) => [...q.techDisplays(data).entries()]);

/** Full detail for one technology (hover card): cost, unlocks, prerequisites. */
export const techDetailFn = createServerFn({ method: "GET" })
  .validator((tech: string) => tech)
  .handler(async ({ data }) => q.techDetail(data));

/** Recompute the cost analysis LP for the active project (runs automatically
 * after every data sync; this is the manual trigger). */
export const recomputeCostsFn = createServerFn({ method: "POST" }).handler(async () => {
  return computeCostAnalysis(currentDatabaseFile());
});

/* ── Game-data sync (server-side dumping) ───────────────────────────────────── */

/** Current sync pipeline state (poll while a sync runs). */
export const syncStateFn = createServerFn({ method: "GET" }).handler(async () => dump.syncState());

/** Whether Factorio is already running (holds its instance lock) — so the UI can
 * warn before a dump and avoid launching into a guaranteed lock failure. `running`
 * is null when we can't tell (then the dump is attempted and the error is mapped). */
export const factorioRunningFn = createServerFn({ method: "GET" }).handler(async () => ({
  running: await dump.factorioRunning(),
}));

/** Kick off the dump → import (→ atlas) pipeline. Icons are opt-in: that
 * stage loads the full game and Steam may prompt for launch confirmation. */
export const startDataSyncFn = createServerFn({ method: "POST" })
  .validator((d: { icons?: boolean }) => d)
  .handler(async ({ data }) => dump.startDataSync(data));

/** Data health: row counts, when/what we imported, and whether the current
 * mod list still matches the data fingerprint. */
export const dataStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const metaMap = q.metaAll();
  let currentFingerprint: string | null = null;
  try {
    currentFingerprint = await dump.modListFingerprint();
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
  const metaMap = q.metaAll();
  let baseline: dump.ModEntry[] | null = null;
  if (metaMap.mod_list) {
    try {
      baseline = JSON.parse(metaMap.mod_list);
    } catch {
      baseline = null;
    }
  }
  let current: dump.ModEntry[] | null = null;
  try {
    current = await dump.readMods();
  } catch {
    current = null; // factorio dir missing — can't compare, don't nag
  }
  if (!baseline || !current)
    return { haveBaseline: !!baseline, drift: null, needsRedump: false } as const;
  return {
    haveBaseline: true,
    drift: dump.diffMods(baseline, current),
    needsRedump: dump.redumpNeeded(baseline, current),
  };
});

/* ── TURD (Pyanodon tech upgrades) ──────────────────────────────────────────── */

export const listTurdUpgradesFn = createServerFn({ method: "GET" }).handler(async () =>
  q.listTurdUpgrades(),
);

/** Live TURD state pushed by the in-game mod (bridge), if any. Mirrors the
 * research synced status — drives the "✓ live: N synced" note on the TURD page. */
export const turdSyncStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const m = q.metaAll();
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

/** Dry-run change detection: re-solve every saved block WITHOUT saving and
 * compare against its cached flows, so a TURD pick or data re-import that changed
 * recipes surfaces *which* blocks are affected and *how*, rather than silently
 * re-solving. Reports broken blocks (a referenced recipe no longer exists or the
 * solve errors) and changed blocks (their fresh I/O differs from the cache). */
export const blockChangeReportFn = createServerFn({ method: "GET" }).handler(async () => {
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
      fresh = boundaryFlows(goalFlows(data), r);
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
    q.setTurdSelection(data.masterTech, data.subTech);
    const resolved = await resolveAllBlocks();
    return { ok: true, resolved };
  });

/* ── Folders (block groups) ──────────────────────────────────────────────────── */
export const listGroupsFn = createServerFn({ method: "GET" }).handler(async () => q.listGroups());

export const createGroupFn = createServerFn({ method: "POST" })
  .validator((name: string) => name)
  .handler(async ({ data }) => {
    const name = data.trim() || "New folder";
    return { id: await withUndoAction(`Create folder "${name}"`, () => q.createGroup(name)) };
  });

export const renameGroupFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; name: string }) => d)
  .handler(async ({ data }) => {
    const name = data.name.trim() || "Folder";
    await withUndoAction(`Rename folder to "${name}"`, () => q.renameGroup(data.id, name));
    return { ok: true };
  });

export const deleteGroupFn = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .handler(async ({ data }) => {
    await withUndoAction("Delete folder", () => q.deleteGroup(data));
    return { ok: true };
  });

export const setBlockGroupFn = createServerFn({ method: "POST" })
  .validator((d: { blockId: number; groupId: number | null }) => d)
  .handler(async ({ data }) => {
    await withUndoAction("Move block to folder", () => q.setBlockGroup(data.blockId, data.groupId));
    return { ok: true };
  });

export const setBlockEnabledFn = createServerFn({ method: "POST" })
  .validator((d: { blockId: number; enabled: boolean }) => d)
  .handler(async ({ data }) => {
    await withUndoAction(data.enabled ? "Enable block" : "Disable block", () =>
      q.setBlockEnabled(data.blockId, data.enabled),
    );
    return { ok: true };
  });

export const setGroupParentFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; parentId: number | null }) => d)
  .handler(async ({ data }) => ({
    ok: await withUndoAction("Move folder", () => q.setGroupParent(data.id, data.parentId)),
  }));

export const setBlockOrderFn = createServerFn({ method: "POST" })
  .validator((ids: number[]) => ids)
  .handler(async ({ data }) => {
    await withUndoAction("Reorder blocks", () => q.setBlockOrder(data));
    return { ok: true };
  });

export const setGroupOrderFn = createServerFn({ method: "POST" })
  .validator((ids: number[]) => ids)
  .handler(async ({ data }) => {
    await withUndoAction("Reorder folders", () => q.setGroupOrder(data));
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
    let raw: string;
    try {
      raw = await fs.readFile(path.join(ICON_DATA_DIR, "manifest.json"), "utf8");
    } catch {
      // No atlas yet (a fresh install, before the first data sync) — return an empty
      // manifest so icons fall back gracefully instead of surfacing an ENOENT.
      return { cell: 0, atlasSize: 0, sheets: [], icons: {} };
    }
    // file content is untyped input — assert the shape at this boundary only
    const manifest = JSON.parse(raw) as IconManifest;
    // Cache-bust the atlas sheets: the PNGs are served at stable URLs (/icons/
    // atlas-0.png), so a re-import or a project switch (new dump → new atlas at the
    // same path) would otherwise be masked by the browser cache (icons land on the
    // wrong sprites until a hard refresh). The data fingerprint changes whenever the
    // dump does and differs per project, so it's the right version token. The /icons
    // handler ignores the query string and still serves the file.
    const fp = q.metaAll().data_fingerprint;
    if (fp) manifest.sheets = manifest.sheets.map((s) => `${s}?v=${fp}`);
    return manifest;
  },
);

export type DataPaths = {
  dataDir: string;
  projectsDir: string;
  iconDataDir: string;
  appConfig: string;
};

// Where the app keeps its on-disk state. Surfaced in Settings so a user (or a bug
// report) can find the project dbs / atlas / config — handy since the location is
// per-OS for a packaged build but the working dir in dev.
export const dataPathsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DataPaths> => {
    return {
      dataDir: DATA_DIR,
      projectsDir: PROJECTS_DIR,
      iconDataDir: ICON_DATA_DIR,
      appConfig: APP_CONFIG_FILE,
    };
  },
);
