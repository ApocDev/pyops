/**
 * Block-doc store — the block editor's persisted document (goals, recipes,
 * per-recipe picks, groups, dispositions, spoil plans) as a TanStack Store
 * outside the React tree, with every transition as a plain testable action.
 *
 * Dirty tracking is structural: every mutating action marks the doc dirty in
 * one place (`edit`), and `hydrate` loads server state WITHOUT marking dirty —
 * callable at any time, not just on mount, so undo/snapshot-restore/assistant
 * writes can push a fresh doc into an open editor (#90, #85, #12). This
 * replaces the old per-handler `markEdited()` discipline, where one forgotten
 * call meant lost edits or hydration clobbering a block.
 *
 * UI ephemera (open dialogs, menus, drafts, fold state) stay in components;
 * the solve result and all reference data stay in TanStack Query.
 */
import { Store } from "@tanstack/store";
import type { Goal, RateUnit } from "../../db/schema";
import type { Disposition } from "../../solver/migrate";
import type { BeaconConfig } from "../../server/effects";
import type { ReactorLayout } from "../../lib/reactor";
import type { DocPin, SolveInput } from "../../server/block-compute.server.ts";
import { normalizeBlockData, STOCK_WINDOW_DEFAULT, type RawBlockData } from "../../lib/goals";
import { mergeActionLabel } from "../../lib/undo-names";
import {
  joinGroup,
  leaveGroup,
  normalizeGroups,
  type GroupAssign,
  type RowGroup,
} from "../../lib/row-groups";

export type BlockDocState = {
  /** true once a server doc has been loaded — auto-save stays off until then */
  hydrated: boolean;
  /** true only after a user edit (any mutating action); hydrate never sets it */
  dirty: boolean;
  /** Undo-stack label for the edits pending save (#90) — set by `note()` from
   * call sites that know what changed ('Add recipe "Auog paddock"'); null =
   * the save uses its generic default. Merged across a debounced-save burst by
   * `mergeActionLabel`; consumed (cleared) when a save starts. */
  pendingAction: string | null;
  goals: Goal[];
  customIcon: { kind: string; name: string } | null;
  recipes: string[];
  disabled: ReadonlySet<string>;
  /** items this block claims in-block production for (#91): net ≥ 0 in the
   * solve. null = legacy doc that hasn't adopted a made set yet — the server
   * derives one from the old dispositions and echoes it; adoptMade() takes it
   * without dirtying, and the next real edit persists it. */
  made: ReadonlySet<string> | null;
  /** per-row pins (#91): fixed/cap building counts, consumer shares */
  pins: DocPin[];
  /** legacy dispositions payload, kept verbatim until `made` is adopted so the
   * server keeps deriving from it; dropped from the doc after adoption */
  dispositions: Record<string, Disposition>;
  spoilRates: Record<string, number>;
  supplyPriority: number;
  supplyPriorities: Record<string, number>;
  rowGroups: RowGroup[];
  recipeGroups: GroupAssign;
  machines: Record<string, string>;
  fuels: Record<string, string>;
  modules: Record<string, string[]>;
  beacons: Record<string, BeaconConfig[]>;
  /** reactor rows' assumed x×y farm (#94) — absent = 1×1, no neighbour bonus */
  reactorLayouts: Record<string, ReactorLayout>;
  blockName: string;
};

const EMPTY: BlockDocState = {
  hydrated: false,
  dirty: false,
  pendingAction: null,
  goals: [],
  customIcon: null,
  recipes: [],
  disabled: new Set(),
  made: null,
  pins: [],
  dispositions: {},
  spoilRates: {},
  supplyPriority: 0,
  supplyPriorities: {},
  rowGroups: [],
  recipeGroups: {},
  machines: {},
  fuels: {},
  modules: {},
  beacons: {},
  reactorLayouts: {},
  blockName: "",
};

/** The solver/save document assembled from the doc state — the exact shape
 * `solveBlockFn`/`saveBlockFn` consume. Empty maps are omitted so the saved doc
 * stays minimal; `disabled` persists as a sorted array (no Set-order churn). */
export function solveInputOf(s: BlockDocState): SolveInput {
  const beaconsUsed = Object.fromEntries(Object.entries(s.beacons).filter(([, v]) => v.length));
  const disabledRecipes = [...s.disabled].sort();
  return {
    goals: s.goals,
    ...(s.customIcon ? { icon: s.customIcon } : {}),
    recipes: s.recipes,
    ...(disabledRecipes.length ? { disabledRecipes } : {}),
    ...(s.rowGroups.length ? { rowGroups: s.rowGroups, recipeGroups: s.recipeGroups } : {}),
    ...(Object.keys(s.spoilRates).length ? { spoilRates: s.spoilRates } : {}),
    ...(s.supplyPriority !== 0 ? { supplyPriority: s.supplyPriority } : {}),
    ...(Object.keys(s.supplyPriorities).length ? { supplyPriorities: s.supplyPriorities } : {}),
    // adopted docs persist `made` (and never dispositions); legacy docs keep
    // shipping their dispositions so the server can derive
    ...(s.made ? { made: [...s.made].sort() } : {}),
    ...(s.pins.length ? { pins: s.pins } : {}),
    ...(!s.made && Object.keys(s.dispositions).length ? { dispositions: s.dispositions } : {}),
    ...(Object.keys(s.machines).length ? { machines: s.machines } : {}),
    ...(Object.keys(s.fuels).length ? { fuels: s.fuels } : {}),
    ...(Object.keys(s.reactorLayouts).length ? { reactorLayouts: s.reactorLayouts } : {}),
    // module entries are kept even when EMPTY: an explicit [] means "no modules"
    // and suppresses auto-fill for that row ("reset to auto" deletes the key)
    ...(Object.keys(s.modules).length ? { modules: s.modules } : {}),
    ...(Object.keys(beaconsUsed).length ? { beacons: beaconsUsed } : {}),
  };
}

const withoutKey = <T>(m: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in m)) return m;
  const next = { ...m };
  delete next[key];
  return next;
};

/** Drop groups that lost their last member (ungrouping happens by attrition too). */
const pruneGroups = (recipes: string[], assign: GroupAssign, groups: RowGroup[]): RowGroup[] => {
  const used = new Set(recipes.map((r) => assign[r]).filter((g): g is number => g != null));
  return groups.every((g) => used.has(g.id)) ? groups : groups.filter((g) => used.has(g.id));
};

export function createBlockDocStore() {
  const store = new Store<BlockDocState>(EMPTY);

  /** Apply a user edit: patch the state and mark the doc dirty — the ONLY place
   * dirty is set, so no individual action can forget it. */
  const edit = (patch: (s: BlockDocState) => Partial<BlockDocState>) =>
    store.setState((s) => ({ ...s, ...patch(s), dirty: true }));

  /** Load a server doc (initial mount, or an external write — undo, snapshot
   * restore, assistant apply). Replaces the whole doc, normalizes legacy shapes
   * and drifted groups, and leaves the doc CLEAN — hydration must never save. */
  const hydrate = (raw: RawBlockData, name: string) => {
    const d = normalizeBlockData(raw) as SolveInput;
    const ng = normalizeGroups(d.recipes ?? [], d.rowGroups ?? [], d.recipeGroups ?? {});
    store.setState(() => ({
      hydrated: true,
      dirty: false,
      pendingAction: null,
      goals: d.goals,
      customIcon: d.icon ?? null,
      recipes: ng.recipes,
      rowGroups: ng.groups,
      recipeGroups: ng.assign,
      disabled: new Set(d.disabledRecipes ?? []),
      made: d.made ? new Set(d.made) : null,
      pins: d.pins ?? [],
      dispositions: (d.dispositions ?? {}) as Record<string, Disposition>,
      spoilRates: d.spoilRates ?? {},
      supplyPriority: d.supplyPriority ?? 0,
      supplyPriorities: d.supplyPriorities ?? {},
      machines: d.machines ?? {},
      fuels: d.fuels ?? {},
      modules: d.modules ?? {},
      beacons: (d.beacons ?? {}) as Record<string, BeaconConfig[]>,
      reactorLayouts: d.reactorLayouts ?? {},
      blockName: name,
    }));
  };

  return {
    store,
    hydrate,
    /** persist bookkeeping: consume the dirty flag when a save starts… */
    markClean: () => store.setState((s) => (s.dirty ? { ...s, dirty: false } : s)),
    /** …and restore it if the save fails, so a later edit retries. */
    markDirty: () => store.setState((s) => (s.dirty ? s : { ...s, dirty: true })),

    /* ── undo action labels (#90) ── */
    /** Label the pending edits for the undo stack — called alongside notable
     * mutations (recipe add/remove, goal changes) by call sites that have the
     * display name at hand. Merged, not overwritten (see mergeActionLabel). */
    note: (label: string) =>
      store.setState((s) => ({ ...s, pendingAction: mergeActionLabel(s.pendingAction, label) })),
    /** Consume the pending label when a save starts (it names that save). */
    clearPendingAction: () =>
      store.setState((s) => (s.pendingAction == null ? s : { ...s, pendingAction: null })),

    /* ── goals ── */
    // A new goal starts pinned to 1/s; duplicates are ignored.
    addGoal: (name: string) =>
      edit((s) => ({
        goals: s.goals.some((g) => g.name === name) ? s.goals : [...s.goals, { name, rate: 1 }],
      })),
    removeGoal: (name: string) => edit((s) => ({ goals: s.goals.filter((g) => g.name !== name) })),
    setGoalRate: (name: string, rate: number) =>
      edit((s) => ({ goals: s.goals.map((g) => (g.name === name ? { ...g, rate } : g)) })),
    /** Back-solve support for the sizing lock: set the FIRST goal's rate. */
    setPrimaryRate: (rate: number) =>
      edit((s) => ({ goals: s.goals.map((g, i) => (i === 0 ? { ...g, rate } : g)) })),
    // Rate window (#10): a display/input unit per goal — the stored rate stays /s.
    setGoalUnit: (name: string, unit: RateUnit) =>
      edit((s) => ({
        goals: s.goals.map((g) =>
          g.name === name ? { ...g, ...(unit === "s" ? { unit: undefined } : { unit }) } : g,
        ),
      })),
    // Stock goals (#38): "keep N on hand" — the stored rate stays canonical /s but
    // is DERIVED (stock / window), so machines are sized to rebuild the buffer.
    makeStockGoal: (name: string) =>
      edit((s) => ({
        goals: s.goals.map((g) => {
          if (g.name !== name) return g;
          const window = g.window ?? STOCK_WINDOW_DEFAULT;
          const stock = Math.max(1, Math.round(g.rate * window)) || 1;
          return { ...g, stock, window, rate: stock / window };
        }),
      })),
    // keep the derived rate as the throughput target; drop the stock intent
    makeRateGoal: (name: string) =>
      edit((s) => ({
        goals: s.goals.map((g) =>
          g.name === name ? { ...g, stock: undefined, window: undefined } : g,
        ),
      })),
    setGoalStock: (name: string, stock: number) =>
      edit((s) => ({
        goals: s.goals.map((g) =>
          g.name === name ? { ...g, stock, rate: stock / (g.window ?? STOCK_WINDOW_DEFAULT) } : g,
        ),
      })),
    setGoalWindow: (name: string, window: number) =>
      edit((s) => ({
        goals: s.goals.map((g) =>
          g.name === name && g.stock != null ? { ...g, window, rate: g.stock / window } : g,
        ),
      })),
    /** Swap a goal's item in place (keeps position + rate); drop it if the new
     * item is already a goal. */
    changeGoalItem: (from: string, to: string) =>
      edit((s) => {
        if (to === from) return {};
        const exists = s.goals.some((g) => g.name === to);
        return {
          goals: s.goals.flatMap((g) =>
            g.name === from ? (exists ? [] : [{ ...g, name: to }]) : [g],
          ),
        };
      }),
    /** Move a goal to the front, so it names the block + anchors rate scaling. */
    makePrimary: (name: string) =>
      edit((s) => {
        const g = s.goals.find((x) => x.name === name);
        return g ? { goals: [g, ...s.goals.filter((x) => x.name !== name)] } : {};
      }),

    /* ── block face ── */
    // Block icon (#40): an explicit item/fluid, or null = follow the first goal.
    setCustomIcon: (icon: { kind: string; name: string } | null) =>
      edit(() => ({ customIcon: icon })),
    setBlockName: (blockName: string) => edit(() => ({ blockName })),
    setSupplyPriority: (supplyPriority: number) => edit(() => ({ supplyPriority })),
    setOutputSupplyPriority: (name: string, priority: number | null) =>
      edit((s) => ({
        supplyPriorities:
          priority == null
            ? withoutKey(s.supplyPriorities, name)
            : { ...s.supplyPriorities, [name]: priority },
      })),

    /* ── recipes ── */
    addRecipe: (name: string) =>
      edit((s) => ({ recipes: s.recipes.includes(name) ? s.recipes : [...s.recipes, name] })),
    /** Bake the preferred building + fuel (#18) and the default module template
     * (#99) into the stored picks — new rows only: an existing pick is never
     * overwritten. The template's modules/beacons land as ONE loadout, gated on
     * neither key existing (a row the user already configured — even to an
     * explicit "no modules" — keeps its config). */
    applyRecipeDefaults: (
      name: string,
      d: { machine?: string; fuel?: string; modules?: string[]; beacons?: BeaconConfig[] },
    ) =>
      edit((s) => ({
        ...(d.machine && !s.machines[name]
          ? { machines: { ...s.machines, [name]: d.machine } }
          : {}),
        ...(d.fuel && !s.fuels[name] ? { fuels: { ...s.fuels, [name]: d.fuel } } : {}),
        ...(d.modules && !(name in s.modules) && !(name in s.beacons)
          ? {
              modules: { ...s.modules, [name]: d.modules },
              ...(d.beacons?.length ? { beacons: { ...s.beacons, [name]: d.beacons } } : {}),
            }
          : {}),
      })),
    /** Remove a recipe AND its per-row overrides, so nothing lingers as orphaned
     * config — re-adding is a fresh add that re-applies the current favorite
     * (#18) rather than resurrecting the old pick. Prunes emptied groups. */
    dropRecipe: (name: string) =>
      edit((s) => {
        const recipes = s.recipes.filter((r) => r !== name);
        const disabled = s.disabled.has(name)
          ? new Set([...s.disabled].filter((n) => n !== name))
          : s.disabled;
        const recipeGroups = leaveGroup(s.recipeGroups, name);
        return {
          recipes,
          disabled,
          machines: withoutKey(s.machines, name),
          fuels: withoutKey(s.fuels, name),
          modules: withoutKey(s.modules, name),
          beacons: withoutKey(s.beacons, name),
          reactorLayouts: withoutKey(s.reactorLayouts, name),
          // a removed recipe takes its pins with it — nothing dangles (#91)
          pins: s.pins.filter((p) => p.recipe !== name),
          recipeGroups,
          rowGroups: pruneGroups(recipes, recipeGroups, s.rowGroups),
        };
      }),
    // Toggle a recipe off/on (#73): a disabled recipe stays in the block but
    // drops out of the solve until re-enabled.
    toggleDisabled: (name: string) =>
      edit((s) => {
        const disabled = new Set(s.disabled);
        if (disabled.has(name)) disabled.delete(name);
        else disabled.add(name);
        return { disabled };
      }),

    /* ── per-recipe picks ── */
    pickMachine: (recipe: string, machine: string) =>
      edit((s) => ({ machines: { ...s.machines, [recipe]: machine } })),
    pickFuel: (recipe: string, fuel: string) =>
      edit((s) => ({ fuels: { ...s.fuels, [recipe]: fuel } })),
    /** Reactor farm layout (#94): the 1×1 default (or null) clears the key, so
     * the stored doc only carries real bonus assumptions. */
    setReactorLayout: (recipe: string, layout: ReactorLayout | null) =>
      edit((s) => ({
        reactorLayouts:
          layout == null || (layout.x <= 1 && layout.y <= 1)
            ? withoutKey(s.reactorLayouts, recipe)
            : { ...s.reactorLayouts, [recipe]: layout },
      })),
    setModules: (recipe: string, modules: string[], beacons: BeaconConfig[]) =>
      edit((s) => ({
        modules: { ...s.modules, [recipe]: modules },
        beacons: { ...s.beacons, [recipe]: beacons },
      })),
    /** Apply auto-fill suggestions (hint click / whole-block button) as ordinary
     * stored picks — modules only; beacon configs stay as they are. */
    applyModuleFills: (fills: Record<string, string[]>) =>
      edit((s) => ({ modules: { ...s.modules, ...fills } })),

    /* ── made marks & pins (#91) ── */
    /** Adopt the server-derived made set for a legacy doc — NOT a user edit
     * (stays clean; persists whenever the next real edit saves). No-op once
     * the doc owns a made set. */
    adoptMade: (items: readonly string[]) =>
      store.setState((s) => (s.made ? s : { ...s, made: new Set(items), dispositions: {} })),
    /** Claim in-block production for an item (net ≥ 0; imports forbidden). */
    markMade: (name: string) =>
      edit((s) => {
        const next = new Set(s.made ?? []);
        next.add(name);
        return { made: next, dispositions: {} };
      }),
    /** Stop claiming it — the item goes free (imports shortfall, exports surplus). */
    unmark: (name: string) =>
      edit((s) => {
        const next = new Set(s.made ?? []);
        next.delete(name);
        return { made: next, dispositions: {} };
      }),
    /** Set/replace a row pin: one count-or-cap pin per recipe, one edge pin
     * (share OR drain) per (recipe, item). */
    setPin: (pin: DocPin) =>
      edit((s) => {
        const isEdge = (p: DocPin) => p.kind === "share" || p.kind === "drain";
        return {
          pins: [
            ...s.pins.filter((p) =>
              isEdge(pin)
                ? !(isEdge(p) && p.recipe === pin.recipe && p.item === pin.item)
                : !(!isEdge(p) && p.recipe === pin.recipe),
            ),
            pin,
          ],
        };
      }),
    /** Remove every drain pin on a good (from the IIS card's one-click fix). */
    clearDrains: (item: string) =>
      edit((s) => ({ pins: s.pins.filter((p) => !(p.kind === "drain" && p.item === item)) })),
    clearPin: (recipe: string, edge?: { item: string }) =>
      edit((s) => {
        const isEdge = (p: DocPin) => p.kind === "share" || p.kind === "drain";
        return {
          pins: s.pins.filter((p) =>
            edge
              ? !(isEdge(p) && p.recipe === recipe && p.item === edge.item)
              : !(!isEdge(p) && p.recipe === recipe),
          ),
        };
      }),
    // Incidental spoilage estimate (#20): rate == null (or <= 0) clears it.
    setSpoilRate: (name: string, rate: number | null) =>
      edit((s) => ({
        spoilRates:
          rate == null || !(rate > 0)
            ? withoutKey(s.spoilRates, name)
            : { ...s.spoilRates, [name]: rate },
      })),

    /* ── sub-blocks (#7) ── */
    /** Start a new group containing this row; returns the new id (so the UI can
     * open rename-in-place on it). */
    createGroupFromRow: (recipe: string): number => {
      let id = 0;
      edit((s) => {
        id = Math.max(0, ...s.rowGroups.map((g) => g.id)) + 1;
        return {
          rowGroups: [...s.rowGroups, { id, name: "Sub-block" }],
          recipeGroups: { ...s.recipeGroups, [recipe]: id },
        };
      });
      return id;
    },
    renameGroup: (id: number, name: string) =>
      edit((s) => ({ rowGroups: s.rowGroups.map((g) => (g.id === id ? { ...g, name } : g)) })),
    /* ── composed sub-blocks (#76) ── */
    /** Promote a group to a real, separately-solved module with the given internal
     * output goals (defaulted by the caller to the group's current net outputs). */
    composeGroup: (id: number, goals: Goal[]) =>
      edit((s) => ({
        rowGroups: s.rowGroups.map((g) => (g.id === id ? { ...g, composed: true, goals } : g)),
      })),
    /** Demote a module back to a display-only fold — drop its internal goals/made. */
    uncomposeGroup: (id: number) =>
      edit((s) => ({
        rowGroups: s.rowGroups.map((g) => (g.id === id ? { id: g.id, name: g.name } : g)),
      })),
    /** Edit a composed module's internal output goals. */
    setGroupGoals: (id: number, goals: Goal[]) =>
      edit((s) => ({
        rowGroups: s.rowGroups.map((g) => (g.id === id ? { ...g, goals } : g)),
      })),
    /** Dissolve a group — its rows stay, just ungrouped. */
    ungroupRows: (id: number) =>
      edit((s) => ({
        rowGroups: s.rowGroups.filter((g) => g.id !== id),
        recipeGroups: Object.fromEntries(
          Object.entries(s.recipeGroups).filter(([, g]) => g !== id),
        ),
      })),
    removeFromGroup: (recipe: string) =>
      edit((s) => {
        const recipeGroups = leaveGroup(s.recipeGroups, recipe);
        return { recipeGroups, rowGroups: pruneGroups(s.recipes, recipeGroups, s.rowGroups) };
      }),
    joinRecipeToGroup: (recipe: string, groupId: number) =>
      edit((s) => {
        const joined = joinGroup(s.recipes, s.recipeGroups, recipe, groupId);
        return { recipes: joined.recipes, recipeGroups: joined.assign };
      }),
    /** Apply a drag-reorder result (the arrangement math lives in
     * lib/row-groups, driven by the dnd handler); prunes emptied groups. */
    applyReorder: (recipes: string[], recipeGroups: GroupAssign) =>
      edit((s) => ({
        recipes,
        recipeGroups,
        rowGroups: pruneGroups(recipes, recipeGroups, s.rowGroups),
      })),
  };
}

export type BlockDocStore = ReturnType<typeof createBlockDocStore>;
