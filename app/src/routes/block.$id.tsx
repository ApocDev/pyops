import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { ActiveEditorRefContext } from "./block";
import { createBlockDocStore, solveInputOf } from "../components/block/doc-store.ts";
import {
  bridgeShowBlockFn,
  extractRecipeBlockFn,
  fluidGoalDefaultFn,
  goodInfoFn,
  itemWeightsFn,
  loadBlockFn,
  moduleSuggestionsFn,
  recipeCandidatesFn,
  recipeDefaultsFn,
  saveBlockFn,
  setBlockEnabledFn,
  solveBlockFn,
  type SolveInput,
} from "../server/factorio";
import { exportBlockFn } from "../server/export-fns";
import { registerBlockEditor } from "../lib/block-editors";
import { drainsOnConsume } from "../lib/sink-classify";
import { downloadJson } from "../lib/download";
import { exportFileName } from "../lib/plan-export";
import { toast } from "../lib/toast-store";
import { epochSeconds } from "../lib/undo-client";
import { blockActionName } from "../lib/undo-names";
import { launchesForRate, resolveLogistics } from "../lib/logistics";
import { logisticsContextSubscription } from "../lib/live-query-options";
import { recordRecent } from "../lib/recents";
import { createCoalescedRunner } from "../lib/coalesced-runner";
import { bestUnlockedNonBarrelingRecipe } from "../lib/recipe-shortcuts";
import { IconProvider, useSpoilables } from "../lib/icons";
import { ModulesModal } from "../lib/modules-modal";
import { Callout } from "#/components/ui/callout.tsx";
import { Segmented } from "#/components/ui/segmented.tsx";
import { Table2, Workflow } from "lucide-react";

import { BlockTasks } from "../components/block/block-tasks.tsx";
import { type Link as ItemLink } from "../components/block/item-chip.tsx";
import { GoalPickerDialog } from "../components/block/goal-picker-dialog.tsx";
import { IconPickerDialog } from "../components/block/icon-picker-dialog.tsx";
import { RecipePickerDialog } from "../components/block/recipe-picker-dialog.tsx";
import { BuildingPickerDialog } from "../components/block/building-picker-dialog.tsx";
import { FuelPickerDialog } from "../components/block/fuel-picker-dialog.tsx";
import { SpoilRateDialog } from "../components/block/spoil-rate-dialog.tsx";
import { GoalMenu } from "../components/block/goal-menu.tsx";
import { RowMenu } from "../components/block/row-menu.tsx";
import { PinDialog } from "../components/block/pin-dialog.tsx";
import { GoodMenu } from "../components/block/good-menu.tsx";
import { BlockToolbar } from "../components/block/block-toolbar.tsx";
import { SnapshotSheet } from "../components/block/snapshot-sheet.tsx";
import { GoalCard } from "../components/block/goal-card.tsx";
import { BalanceCard } from "../components/block/balance-card.tsx";
import { RecipeGrid } from "../components/block/recipe-grid.tsx";
import { BlockFlowView } from "../components/block/block-flow-view.tsx";
import type { LogiView } from "../components/block/solve-view.ts";

export const Route = createFileRoute("/block/$id")({ component: BlockRoute });

type BlockSolve = Awaited<ReturnType<typeof solveBlockFn>>;
type SolvedState = { input: SolveInput; result: BlockSolve };

// Remount the editor per id (key) so each block is a fresh instance: load on
// mount, auto-save on edit, flush on unmount — no cross-block state to untangle.
function BlockRoute() {
  const { id } = Route.useParams();
  return (
    <IconProvider>
      <Block key={id} blockId={Number(id)} />
    </IconProvider>
  );
}

function Block({ blockId }: { blockId: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const spoilables = useSpoilables(); // item → spoil ticks, for spoil-risk UI (#20)
  // Output goals, first-listed anchors naming/sizing and is the DEFAULT icon. A goal
  // with a numeric rate is pinned (a solver target); rate null is an unpinned co-product.
  // The persisted block doc lives in an external store (one per editor mount —
  // the route keys this component by block id). Actions mark dirty structurally;
  // hydrate() can be called any time an external write lands (undo, restore).
  const [doc] = useState(createBlockDocStore);
  const s = useStore(doc.store);
  const {
    goals,
    customIcon,
    recipes,
    made,
    pins,
    spoilRates,
    rowGroups,
    recipeGroups,
    machines: machineSel,
    fuels: fuelSel,
    modules: moduleSel,
    beacons: beaconSel,
    reactorLayouts, // reactor rows' assumed x×y farms (#94)
    blockName,
  } = s;
  const target = goals[0]?.name ?? ""; // the first goal's good (sizing anchor)
  const rate = goals[0]?.rate ?? 1; // the first goal's pinned rate
  // goal-item picker dialog: null = closed, {} = adding a new goal, {replace} = changing that goal's item
  const [goalPicker, setGoalPicker] = useState<null | { replace?: string }>(null);
  const [iconPicker, setIconPicker] = useState(false);
  // right-click menu on a goal cell (change item / move to front / remove)
  const [goalMenu, setGoalMenu] = useState<{ x: number; y: number; name: string } | null>(null);
  // right-click context menu on a good chip (explicit actions instead of cycling)
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    name: string;
    kind: string;
    link: ItemLink;
  } | null>(null);
  const [lockedInput, setLockedInput] = useState<string | null>(null); // import pinned to size the block
  const [lockedRate, setLockedRate] = useState(0); // the rate that import is pinned to
  // Sub-blocks (#7): named groups of recipe rows, display-only. Members stay
  // contiguous in `recipes` order (lib/row-groups.ts). Fold state is a view
  // preference — localStorage, not the doc, so folding doesn't churn auto-save.
  // Incidental spoil estimates (#20): item → expected rot rate /s while backed
  // up. They do not change the nominal solve; the result item becomes a
  // byproduct export. `spoilDialog` holds the item whose estimate is edited.
  const [spoilDialog, setSpoilDialog] = useState<string | null>(null);
  // rename-in-place on a group header (holds the group id being edited)
  const [renamingGroup, setRenamingGroup] = useState<number | null>(null);
  // right-click menu on a recipe row (sub-block actions)
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; name: string } | null>(null);
  // pin editor (#91): the recipe whose pins are being edited
  const [pinFor, setPinFor] = useState<string | null>(null);
  // snapshot-history drawer (#85)
  const [historyOpen, setHistoryOpen] = useState(false);
  // recipe table vs. sankey/flow view (#101); `focusRecipe` briefly rings a row
  // when a flow node is clicked (cleared on a timer so it doesn't stick).
  const [view, setView] = useState<"table" | "flow">("table");
  const [focusRecipe, setFocusRecipe] = useState<string | null>(null);
  const focusRow = (recipe: string) => {
    setView("table");
    setFocusRecipe(recipe);
    setTimeout(() => setFocusRecipe((cur) => (cur === recipe ? null : cur)), 2500);
  };

  const createGroupFromRow = (recipe: string) => setRenamingGroup(doc.createGroupFromRow(recipe)); // name it right away
  const removeFromGroup = doc.removeFromGroup;
  const extractRecipeToBlock = async (recipe: string) => {
    if (doc.store.state.dirty) await persist();
    const out = await extractRecipeBlockFn({ data: { blockId, recipe } });
    if (!out.ok) {
      toast({ message: "Could not extract that recipe into a new block." });
      return;
    }
    void qc.invalidateQueries({ queryKey: ["blocks"] });
    void qc.invalidateQueries({ queryKey: ["factory"] });
    void qc.invalidateQueries({ queryKey: ["undoStatus"] });
    toast({ message: `Extracted "${out.name}" into a new block.` });
    void navigate({ to: "/block/$id", params: { id: String(out.id) } });
  };
  const [pickFor, setPickFor] = useState<{
    name: string;
    mode: "produce" | "consume";
    quick?: boolean;
  } | null>(null);
  const [pickMachineFor, setPickMachineFor] = useState<string | null>(null); // recipe whose machine we're choosing
  const [pickFuelFor, setPickFuelFor] = useState<string | null>(null); // recipe whose fuel we're choosing
  const [pickModulesFor, setPickModulesFor] = useState<string | null>(null); // recipe whose modules we're editing
  // Whole-block on/off (#73). Persisted immediately on toggle (not via the block's
  // auto-save), like group/order changes; disabled = excluded from factory rollups.
  const [blockEnabled, setBlockEnabled] = useState(true);
  // Until the user names a block themselves, its name tracks the primary goal's
  // display. `nameCustom` flips true once they type a name (back to false if they
  // clear it); `customDecided` makes the post-hydrate decision run only once.
  const [nameCustom, setNameCustom] = useState(false);
  const customDecided = useRef(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  // One fixed query slot owns the active server-authoritative solve. User edits
  // replace it after a coalesced solve+save rather than minting per-edit cache
  // entries. The input travels with the result so lazy module hints can never
  // mix old rates with a newer dirty document.
  const solveQueryKey = ["solve", "editor", blockId] as const;
  // Recipe removal is a click-to-confirm: the first click on × arms the row (× →
  // "remove?"), the second removes it. Removing loses the row's machine/fuel/module
  // picks and it sits next to the disable toggle, so a lone misclick shouldn't destroy
  // it. Auto-disarms after a few seconds. Holds the recipe name pending confirmation.

  // Load this block on mount (the editor is keyed by id, so this runs once per
  // block). Auto-save stays suppressed until `hydrated` flips.
  const loaded = useQuery({
    queryKey: ["block", blockId],
    queryFn: () => loadBlockFn({ data: blockId }),
    enabled: Number.isFinite(blockId),
    // never hydrate from a stale cache entry: drop it on unmount so reopening
    // always fetches the freshly-saved doc (otherwise a re-opened block can show
    // — and then auto-save — the old state it was first loaded with)
    gcTime: 0,
    staleTime: 0,
  });
  // Save-conflict baseline (#90): the `updatedAt` of the row this editor last
  // hydrated from / saved. Sent with every save so a stale editor (second tab,
  // or one that idled through an undo/external write) is rejected + reloaded
  // instead of clobbering the newer state wholesale.
  const baseUpdatedAt = useRef<number | null>(null);
  useEffect(() => {
    if (s.hydrated || !loaded.data) return;
    // the store normalizes legacy doc shapes + drifted groups on hydrate
    doc.hydrate(loaded.data.data, loaded.data.name);
    baseUpdatedAt.current = epochSeconds(loaded.data.updatedAt);
    setBlockEnabled(loaded.data.enabled ?? true);
    // a successful load is a visit — surfaces this block in the command
    // palette's Recent group (#78); identity only, the label resolves live
    recordRecent({ type: "block", id: blockId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded.data]);

  // Register with the open-editor registry (#90) so an external write to this
  // block — an undo today, snapshot restore/assistant apply next — can push the
  // fresh doc straight into this editor (hydrate leaves the doc clean, so the
  // auto-save can't write the stale state back). If the external change removed
  // the block entirely (undo of a create), leave rather than resurrect it.
  useEffect(
    () =>
      registerBlockEditor(blockId, {
        hydrate: (raw, name, at) => {
          doc.hydrate(raw, name);
          baseUpdatedAt.current = at;
          setSaveState("idle");
          void solveBlockFn({ data: raw as SolveInput }).then((result) =>
            qc.setQueryData<SolvedState>(solveQueryKey, { input: raw as SolveInput, result }),
          );
        },
        onDeleted: () => void navigate({ to: "/block" }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blockId],
  );

  const copySetup = () => {
    void navigator.clipboard?.writeText(
      JSON.stringify(
        {
          goals,
          recipes,
          made: made ? [...made] : null,
          pins,
          machineSel,
          fuelSel,
          moduleSel,
          beaconSel,
          reactorLayouts,
        },
        null,
        2,
      ),
    );
  };
  // Export this block as a shareable JSON file (#82). Saves first so the file
  // matches what's on screen, then downloads the versioned envelope.
  const exportBlock = async () => {
    await persist();
    const env = await exportBlockFn({ data: blockId });
    downloadJson(exportFileName(env), env);
  };
  // Push this block to the game as an in-game build sheet (buildings clickable for
  // a configured blueprint). Saves first so the mod renders the current solve.
  const showInGame = useMutation({
    mutationFn: async () => {
      await persist();
      return bridgeShowBlockFn({ data: blockId });
    },
  });
  // Toggle the whole block on/off (#73). Optimistic; refreshes the sidebar + factory
  // views (which now exclude disabled blocks). Not a block-data edit, so no markEdited.
  const toggleBlockEnabled = () => {
    const next = !blockEnabled;
    setBlockEnabled(next);
    void setBlockEnabledFn({ data: { blockId, enabled: next } }).then(() => {
      void qc.invalidateQueries({ queryKey: ["blocks"] });
      void qc.invalidateQueries({ queryKey: ["factory"] });
    });
  };
  const pickMachine = doc.pickMachine;
  const pickFuel = doc.pickFuel;
  const setSpoilRateFor = doc.setSpoilRate;
  // Goals: an ordered list, primary first (goals[0] = the sizing anchor). A new
  // block's first goal is pinned to 1/s; further goals start unpinned (co-products)
  // and can be pinned to their own target rate.
  const addGoal = doc.addGoal;
  const removeGoal = doc.removeGoal;
  const makeStockGoal = doc.makeStockGoal;
  const makeRateGoal = doc.makeRateGoal;
  // Spin up a fresh block that produces `name` (e.g. to supply an import), sized
  // to the rate this block needs, and open it. Recipes are left for the user to
  // pick — same starting point as "New block", but pre-seeded with the goal.
  const createSupplier = async (name: string, rate: number) => {
    const res2 = await saveBlockFn({
      data: { data: { goals: [{ name, rate: rate > 0 ? +rate.toFixed(4) : 1 }], recipes: [] } },
    });
    void qc.invalidateQueries({ queryKey: ["blocks"] });
    void navigate({ to: "/block/$id", params: { id: String(res2.id) } });
  };
  // Swap a goal's item in place (keeps its position + rate); drop it if the new item
  // is already a goal.
  const changeGoalItem = doc.changeGoalItem;
  const defaultGoalTemperature = async (name: string) =>
    (await fluidGoalDefaultFn({ data: name })).temperature ?? undefined;
  const addGoalWithDefault = async (name: string) =>
    addGoal(name, await defaultGoalTemperature(name));
  // The goal-picker dialog routes to add / change depending on how it was opened.
  const pickGoalItem = async (name: string) => {
    const replace = goalPicker?.replace;
    setGoalPicker(null);
    const temperature = await defaultGoalTemperature(name);
    if (replace) changeGoalItem(replace, name, temperature);
    else addGoal(name, temperature);
  };
  // Block icon (#40): pick an explicit item/fluid, or reset to follow the first goal.
  const pickIcon = (kind: string, name: string) => {
    doc.setCustomIcon({ kind, name });
    setIconPicker(false);
  };
  const resetIcon = () => {
    doc.setCustomIcon(null);
    setIconPicker(false);
  };
  // Move a goal to the front, so it names the block + anchors the rate-scaling tools.
  const makePrimary = doc.makePrimary;

  // the solver/save doc, assembled by the store (empty maps omitted, disabled
  // recipes as a sorted array — see solveInputOf)
  const solveInput = useMemo(() => solveInputOf(s), [s]);
  // kind + display for the goal cells, so a fluid goal (e.g. crude-oil) icons
  // correctly even before any recipe makes it appear in the solve's flows, and so
  // the block can auto-name itself from its primary goal pre-solve.
  const goalNames = goals.map((g) => g.name);
  const goalInfo = useQuery({
    queryKey: ["goalInfo", goalNames],
    queryFn: () => goodInfoFn({ data: goalNames }),
    enabled: goalNames.length > 0,
  });
  // Auto-name the block after its primary goal until the user names it themselves.
  // The first run after hydrate decides whether the loaded name was custom; after
  // that, the name follows the primary goal whenever it changes (unless custom).
  useEffect(() => {
    if (!s.hydrated || !target) return;
    const info = goalInfo.data?.[target];
    if (!info) return; // wait until we know the goal's display name
    const auto = info.display;
    if (!customDecided.current) {
      customDecided.current = true;
      const stored = blockName.trim();
      const wasCustom = !!stored && stored !== auto && stored !== "New block";
      setNameCustom(wasCustom);
      if (wasCustom) return;
    }
    if (!nameCustom && blockName !== auto) doc.setBlockName(auto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, goalInfo.data, nameCustom, blockName]);
  // Initial paint solves the document loaded from SQLite once. After that,
  // edits do not mint query-cache entries or fire a second live solve: the
  // debounced save below is the sole authoritative solve and returns its result.
  const solve = useQuery({
    queryKey: solveQueryKey,
    queryFn: async (): Promise<SolvedState> => {
      const input = loaded.data!.data as SolveInput;
      return { input, result: await solveBlockFn({ data: input }) };
    },
    enabled: !!loaded.data,
    // This slot is initialized from SQLite once. Saves and external writes
    // replace it explicitly, so focus/reconnect must not re-solve it.
    staleTime: Infinity,
    gcTime: 0,
  });
  const coreSolve = solve.data?.result;
  const solvedInput = solve.data?.input;

  // Module auto-fill is a presentation hint, not a solver input. Resolve it
  // lazily from the core solve's exact rates so its relatively expensive module
  // and research scans cannot delay or duplicate the solve+save hot path.
  const suggestionRows = useMemo(
    () =>
      (coreSolve?.rows ?? []).map((row) => ({
        recipe: row.recipe,
        rate: row.rate,
        machine: row.machine?.name ?? null,
      })),
    [coreSolve],
  );
  const moduleSuggestions = useQuery({
    queryKey: ["moduleSuggestions", blockId, solvedInput, suggestionRows],
    queryFn: () => moduleSuggestionsFn({ data: { data: solvedInput!, rows: suggestionRows } }),
    enabled:
      !!solvedInput &&
      coreSolve?.status === "solved" &&
      coreSolve.rows.some((row) => (row.machine?.moduleSlots ?? 0) > 0),
    staleTime: Infinity,
    // Each key embeds one saved doc + its rates; discard the previous payload
    // immediately when the next coalesced save supersedes it.
    gcTime: 0,
  });
  const res = useMemo(() => {
    if (!coreSolve) return undefined;
    const suggestions = moduleSuggestions.data ?? {};
    return {
      ...coreSolve,
      rows: coreSolve.rows.map((row) => ({
        ...row,
        suggestedModules: suggestions[row.recipe],
      })),
    };
  }, [coreSolve, moduleSuggestions.data]);
  // Legacy-doc migration (#91): a pre-#91 doc has no `made` set, so the server
  // derives one from its old dispositions and echoes it on the result. Adopt it
  // (clean — no save churn); the next real edit persists the new shape.
  const resMade = res && "made" in res ? res.made : undefined;
  useEffect(() => {
    if (resMade && doc.store.state.hydrated && doc.store.state.made == null) doc.adoptMade(resMade);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resMade]);
  // Auto-save (debounced) to the DB, plus a flush on unmount so switching blocks
  // never drops edits. The store owns dirty: only user-edit actions set it, and
  // hydrate() never does — so hydration (incl. a fresh refetch) can't trigger a
  // write that would clobber the block. Persist reads the store directly, so
  // the flush always saves the newest state (no snapshot ref needed).
  const retryHold = useRef(false); // a failed save stays dirty but waits for the next edit
  const persistOnce = () => {
    doc.markClean();
    setSaveState("saving");
    const cur = doc.store.state;
    // the pending label (set by recipe add/remove & co.) names this save on the
    // undo stack; consumed here so the next burst starts fresh
    const actionName = blockActionName(cur.pendingAction, cur.blockName);
    doc.clearPendingAction();
    const input = solveInputOf(cur);
    return saveBlockFn({
      data: {
        id: blockId,
        name: cur.blockName.trim() || undefined,
        data: input,
        ...(actionName ? { actionName } : {}),
        baseUpdatedAt: baseUpdatedAt.current,
        returnSolve: true,
      },
    })
      .then(async (res) => {
        if ("conflict" in res) {
          // The stored row is newer than this editor's hydration point (another
          // tab, an undo, an assistant write beat us to it): the save was NOT
          // applied — reload the fresh doc instead of clobbering it.
          const row = await loadBlockFn({ data: blockId });
          if (row) {
            doc.hydrate(row.data, row.name);
            baseUpdatedAt.current = epochSeconds(row.updatedAt);
            const result = await solveBlockFn({ data: row.data as SolveInput });
            qc.setQueryData<SolvedState>(solveQueryKey, {
              input: row.data as SolveInput,
              result,
            });
          }
          setSaveState("idle");
          toast({ message: "Block changed elsewhere — reloaded." });
          return true;
        }
        baseUpdatedAt.current = res.updatedAt ?? null;
        // This editor requests the solve in the save response; the null form is
        // reserved for compact non-editor callers of saveBlockFn.
        if (res.solve) qc.setQueryData<SolvedState>(solveQueryKey, { input, result: res.solve });
        setSaveState("saved");
        void qc.invalidateQueries({ queryKey: ["blocks"] });
        void qc.invalidateQueries({ queryKey: ["undoStatus"] });
        return true;
      })
      .catch(() => {
        retryHold.current = true;
        doc.markDirty(); // failed — stay dirty so a later edit retries
        setSaveState("idle");
        return false;
      });
  };
  // A slow solve/save cannot overlap a newer one. Edits that arrive while the
  // request is in flight are represented by the store's dirty bit and collapse
  // into one follow-up save of the latest document.
  const [persist] = useState(() => createCoalescedRunner(persistOnce, () => doc.store.state.dirty));
  useEffect(() => {
    if (!s.hydrated || !s.dirty) return;
    if (retryHold.current) {
      // the markDirty after a failed save re-runs this effect; don't hot-loop —
      // wait for a real edit (the next store change) to retry
      retryHold.current = false;
      return;
    }
    // One short idle window coalesces rapid edits while keeping the solved UI
    // responsive. This request both solves and persists; there is no parallel
    // live-solve request for the same document anymore.
    const t = setTimeout(persist, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);
  useEffect(
    () => () => {
      const cur = doc.store.state;
      if (cur.hydrated && cur.dirty) void persist();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Report this (active) block's live emptiness so closing its tab can discard an
  // untouched "New block" without racing the unmount auto-save above. Cleared on
  // unmount so a stale reading can't outlive the editor.
  const activeEditorRef = useContext(ActiveEditorRefContext);
  const isEmpty = goals.length === 0 && recipes.length === 0;
  useEffect(() => {
    if (activeEditorRef) activeEditorRef.current = { id: blockId, empty: isEmpty };
  });
  useEffect(
    () => () => {
      if (activeEditorRef && activeEditorRef.current?.id === blockId)
        activeEditorRef.current = null;
    },
    [activeEditorRef, blockId],
  );

  const picker = useQuery({
    queryKey: ["pick", pickFor?.name, pickFor?.mode],
    queryFn: () => recipeCandidatesFn({ data: { name: pickFor!.name, mode: pickFor!.mode } }),
    enabled: !!pickFor,
  });
  // Per-row belts & inserters readout (#21). Fetched once; the math runs client-side
  // (resolveLogistics) so changing belt/inserter tier from the header is instant.
  const logistics = useQuery(logisticsContextSubscription);
  const logiPrefs = logistics.data?.prefs;
  const logiAny =
    !!logiPrefs && (logiPrefs.showBelts || logiPrefs.showInserters || logiPrefs.showRockets);
  const logiResolved = logiAny && logistics.data ? resolveLogistics(logistics.data) : null;
  const showBelts = !!logiPrefs?.showBelts;
  const showInserters = !!logiPrefs?.showInserters;

  const add = (name: string) => {
    const alreadyAdded = recipes.includes(name);
    doc.addRecipe(name);
    // Adding a producer via an item's chip is the linking gesture (#91): the
    // block now claims in-block production for that item. Goal items skip the
    // mark (a goal already links itself); search-adds never link implicitly.
    if (pickFor?.mode === "produce" && !goals.some((g) => g.name === pickFor.name))
      doc.markMade(pickFor.name);
    // Adding a CONSUMER via a byproduct's chip means "deal with MY surplus":
    // mark the good made so a feedback recipe cannot import the byproduct and
    // replace its real source, then DRAIN it (net = 0) whenever the selected
    // recipe net-consumes it. The explicit gesture links production to
    // consumption even when the consumer's output feeds back into this block;
    // otherwise the machine-minimizing objective may leave the chosen recycler
    // idle and export the untouched surplus.
    if (pickFor?.mode === "consume") {
      const good = pickFor.name;
      if (!goals.some((g) => g.name === good)) doc.markMade(good);
      const cand = picker.data?.find((c) => c.name === name);
      if (cand) {
        if (
          drainsOnConsume({
            good,
            ingredients: cand.ingredients,
            products: cand.products,
          })
        )
          doc.setPin({ kind: "drain", recipe: name, item: good });
      }
    }
    // label the save for the undo stack — the picker rows carry the display name
    const display = picker.data?.find((c) => c.name === name)?.display;
    doc.note(
      alreadyAdded && pickFor
        ? `Link "${res?.display?.[pickFor.name] ?? pickFor.name}" through "${display ?? name}"`
        : `Add recipe "${display ?? name}"`,
    );
    setPickFor(null);
    // Bake the preferred (favorite, else lowest-tier/cheapest) building + fuel for
    // this recipe into the block's stored picks (#18). New recipes only — existing
    // rows already have their picks and aren't touched.
    if (!alreadyAdded)
      void recipeDefaultsFn({ data: [name] }).then((defaults) => {
        const d = defaults[name];
        if (d) doc.applyRecipeDefaults(name, d);
      });
  };

  const quickRecipe = pickFor?.quick
    ? bestUnlockedNonBarrelingRecipe(picker.data ?? [])
    : undefined;
  useEffect(() => {
    if (!pickFor?.quick || (!picker.isSuccess && !picker.isError)) return;
    if (picker.isError) {
      toast({ message: "Could not load recipe choices.", tone: "destructive" });
      setPickFor(null);
    } else if (quickRecipe) add(quickRecipe.name);
    else {
      toast({
        message: `No unlocked non-barreling recipe is available for ${res?.display?.[pickFor.name] ?? pickFor.name}.`,
      });
      setPickFor(null);
    }
    // `add` intentionally consumes the current picker state and closes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickFor?.quick, picker.isSuccess, picker.isError, quickRecipe?.name]);

  // When a flow has exactly one craftable recipe, skip the picker dialog and add
  // it directly. A superseded recipe (its base no longer exists in-game) or one
  // that's already in the block still opens the dialog, so the explanation/state
  // stays visible rather than the click silently doing nothing.
  const loneRecipe =
    pickFor && !pickFor.quick && picker.data?.length === 1 && !picker.data[0].superseded
      ? picker.data[0]
      : null;
  const autoAddRecipe = loneRecipe && !recipes.includes(loneRecipe.name) ? loneRecipe.name : null;
  useEffect(() => {
    if (autoAddRecipe) add(autoAddRecipe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAddRecipe]);
  // Auto-fill (suggestions → stored picks): apply one row's suggested modules,
  // or every row's at once from the toolbar. Suggestions are derived lazily
  // from solved rates but NEVER applied by the server — these clicks are the
  // only apply paths.
  const applyModuleFill = (recipe: string) => {
    const r = res?.rows?.find((x) => x.recipe === recipe);
    if (r?.suggestedModules) doc.applyModuleFills({ [recipe]: r.suggestedModules });
  };
  const suggestedRows = (res?.rows ?? []).filter((r) => r.suggestedModules);
  const autoFillAll = () => {
    if (!suggestedRows.length) return;
    // overwriting rows that already have modules deserves a beat of caution
    const overwriting = suggestedRows.filter((r) => r.modules.length).length;
    if (
      overwriting &&
      !window.confirm(
        `Replace the module fill on ${overwriting} row${overwriting === 1 ? "" : "s"} that already ${overwriting === 1 ? "has" : "have"} modules? (Undo reverts it.)`,
      )
    )
      return;
    doc.applyModuleFills(
      Object.fromEntries(suggestedRows.map((r) => [r.recipe, r.suggestedModules!])),
    );
  };

  // "Size by input": locking an import makes the Goal read-only and drives the
  // block's size from that input's rate instead. The solve is linear in the target,
  // so target = desired × rate / currentImportRate. This effect re-applies the lock
  // whenever the solve changes (e.g. recipes edited), keeping the pinned input at its
  // rate; it's guarded so it converges (back-solving makes the import == desired).
  useEffect(() => {
    if (!lockedInput || !res) return;
    const imp = res.imports.find((f) => f.name === lockedInput);
    if (!imp) {
      setLockedInput(null); // the pinned input is no longer consumed — drop the lock
      return;
    }
    if (imp.rate > 0 && rate > 0 && Math.abs(imp.rate - lockedRate) > 1e-3) {
      // back-solve the first goal's rate so the locked import lands at lockedRate
      doc.setPrimaryRate(+((lockedRate * rate) / imp.rate).toFixed(4));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, lockedInput, lockedRate]);

  const statusColor =
    res?.status === "solved"
      ? "text-success"
      : res?.status === "infeasible"
        ? "text-destructive"
        : "text-warning";

  // Block health for the title tint (mirrors the sidebar verdict): red for broken
  // refs / infeasible / solver error, amber for goals with no recipe or
  // temperature mismatches, none when clean. (A made mark with no producer is
  // not a warning — it just imports.)
  const editorHealth: "error" | "warn" | null = !res
    ? null
    : res.broken || res.status === "infeasible" || res.status === "error"
      ? "error"
      : (res.unmade?.length ?? 0) > 0 || res.tempWarnings.length > 0
        ? "warn"
        : null;
  const titleHealthCls =
    editorHealth === "error"
      ? "border-destructive/70 text-destructive focus-visible:ring-destructive/40"
      : editorHealth === "warn"
        ? "border-warning/70 text-warning focus-visible:ring-warning/40"
        : "";

  // Per-item link state from the solve, so each chip can show whether it's the
  // goal, an unmade input (import), a surplus (export), or balanced in-block.
  const importSet = new Set(res?.imports.map((f) => f.name));
  const exportSet = new Set(res?.displayExports.map((f) => f.name));
  const goalSet = new Set(goalNames);
  // good → kind (item|fluid), gathered from every flow/recipe in the solve so goal
  // icons render correctly even for fluid goals (the target isn't in imports/exports).
  const kindMap = new Map<string, string>();
  for (const r of res?.rows ?? []) {
    for (const p of r.products) kindMap.set(p.name, p.kind);
    for (const c of r.ingredients) kindMap.set(c.name, c.kind);
  }
  for (const f of [...(res?.imports ?? []), ...(res?.exports ?? [])]) kindMap.set(f.name, f.kind);
  const kindOf = (name: string) =>
    (kindMap.get(name) ?? goalInfo.data?.[name]?.kind ?? "item") as "item" | "fluid";

  // Rocket launches/min (#22) — opt-in, niche. Fetch weights for every item shown,
  // then `launchInfo` turns a flow rate into launches/min (default weight if unset).
  const rocketOn = !!logiResolved && !!logistics.data?.prefs.showRockets;
  const itemNames = useMemo(() => {
    const s = new Set<string>();
    const addItem = (name: string, kind: string) => kind === "item" && s.add(name);
    for (const row of res?.rows ?? []) {
      for (const c of row.ingredients) addItem(c.name, c.kind);
      for (const c of row.products) addItem(c.name, c.kind);
    }
    for (const f of [...(res?.imports ?? []), ...(res?.exports ?? [])]) addItem(f.name, f.kind);
    for (const g of goalNames) if (kindOf(g) === "item") s.add(g);
    return [...s].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, goalNames.join(",")]);
  const weightsQ = useQuery({
    queryKey: ["itemWeights", itemNames],
    queryFn: () => itemWeightsFn({ data: itemNames }),
    enabled: rocketOn && itemNames.length > 0,
    staleTime: 60_000,
  });
  const launchInfo = (name: string, rate: number) => {
    if (!rocketOn || !logistics.data) return null;
    const raw = weightsQ.data?.[name];
    const weight = raw ?? logistics.data.defaultItemWeight;
    return {
      perMin: launchesForRate(rate, weight, logistics.data.rocketLiftWeight),
      defaulted: raw == null,
    };
  };

  const producible = new Set(res?.producible ?? []); // imports a recipe could make in-block
  const fuelSet = new Set(res?.fuelItems ?? []); // items consumed as fuel (folded into the balance)
  const linkOf = (name: string): ItemLink =>
    goalSet.has(name)
      ? "target"
      : importSet.has(name)
        ? "import"
        : exportSet.has(name)
          ? "export"
          : "linked";
  const makeFor = (name: string) => setPickFor({ name, mode: "produce" });
  const useFor = (name: string) => setPickFor({ name, mode: "consume" });
  const quickRecipeFor = (name: string, mode: "produce" | "consume") =>
    setPickFor({ name, mode, quick: true });
  const openCtxMenu = (
    e: { clientX: number; clientY: number },
    d: { name: string; kind: string; link: ItemLink },
  ) => setCtxMenu({ x: e.clientX, y: e.clientY, ...d });
  // logistics readout bundle (#21/#22) threaded to every chip row
  const logi: LogiView = {
    resolved: logiResolved,
    showBelts,
    showInserters,
    launchInfo,
  };

  // The block's face (#40): the explicit pick when set, else the first goal's icon.
  const blockIcon =
    customIcon ?? (target ? { kind: goalInfo.data?.[target]?.kind ?? "item", name: target } : null);

  return (
    <div className="p-4 font-mono text-base text-foreground">
      <BlockToolbar
        doc={doc}
        blockIcon={blockIcon}
        titleHealthCls={titleHealthCls}
        saveState={saveState}
        onNamePinned={(pinned) => {
          customDecided.current = true;
          setNameCustom(pinned);
        }}
        blockEnabled={blockEnabled}
        onToggleEnabled={toggleBlockEnabled}
        onCopySetup={copySetup}
        autoFill={{ count: suggestedRows.length, onApply: autoFillAll }}
        onExport={() => void exportBlock()}
        onOpenHistory={() => setHistoryOpen(true)}
        showInGame={{
          pending: showInGame.isPending,
          sent: showInGame.data ? showInGame.data.sent : null,
          onShow: () => showInGame.mutate(),
        }}
        buildCost={res?.buildCost}
        onOpenIconPicker={() => setIconPicker(true)}
      />

      {/* Broken-block banner: a referenced recipe/good no longer exists in the
          current data, so the block is NOT solved (showing wrong numbers would be
          worse). The block + its last-good cache are preserved untouched. */}
      {res?.broken && (
        <Callout
          tone="destructive"
          className="mb-4"
          title="This block references prototypes that no longer exist in the current data — it won't be solved."
        >
          <p className="mt-1 text-muted-foreground">
            The block is preserved exactly as saved (its last solved numbers are kept). Re-enable
            the mod or re-import the data dump to restore it — pure renames are applied
            automatically on import.
          </p>
          {res.missing.recipes.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">Missing recipe:</span>
              {res.missing.recipes.map((n) => (
                <code key={n} className="bg-destructive/15 px-1.5 py-0.5 text-destructive">
                  {n}
                </code>
              ))}
            </div>
          )}
          {res.missing.goods.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">Missing good:</span>
              {res.missing.goods.map((n) => (
                <code key={n} className="bg-destructive/15 px-1.5 py-0.5 text-destructive">
                  {n}
                </code>
              ))}
            </div>
          )}
        </Callout>
      )}

      {/* Goal + block summary */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GoalCard
          doc={doc}
          res={res}
          kindOf={kindOf}
          lockedInput={lockedInput}
          logi={logi}
          onGoalMenu={(e, name) => setGoalMenu({ x: e.clientX, y: e.clientY, name })}
          onMakeFor={makeFor}
          onUseFor={useFor}
          onQuickRecipeFor={quickRecipeFor}
          onOpenGoalPicker={() => setGoalPicker({})}
        />
        <BalanceCard
          blockId={blockId}
          doc={doc}
          res={res}
          statusColor={statusColor}
          kindOf={kindOf}
          producible={producible}
          fuelSet={fuelSet}
          lockedInput={lockedInput}
          lockedRate={lockedRate}
          onLockedRateChange={setLockedRate}
          onUnlock={() => setLockedInput(null)}
          logi={logi}
          onMakeFor={makeFor}
          onUseFor={useFor}
          onCtxMenu={openCtxMenu}
          onOpenSpoilDialog={setSpoilDialog}
        />
      </div>

      <BlockTasks blockId={blockId} />

      {/* Recipe table ↔ flow diagram (#101). A segmented toggle; the flow view
          is a read-only alternative rendering of the same solve. */}
      <div className="mb-2">
        <Segmented
          aria-label="Recipe view"
          size="sm"
          value={view}
          onValueChange={setView}
          options={[
            {
              value: "table",
              label: (
                <>
                  <Table2 className="size-4" />
                  Table
                </>
              ),
            },
            {
              value: "flow",
              label: (
                <>
                  <Workflow className="size-4" />
                  Flow
                </>
              ),
            },
          ]}
        />
      </div>

      {view === "flow" ? (
        <BlockFlowView res={res} goalNames={goalNames} onSelectRecipe={focusRow} />
      ) : (
        <RecipeGrid
          doc={doc}
          blockId={blockId}
          res={res}
          linkOf={linkOf}
          producible={producible}
          logi={logi}
          focusRecipe={focusRecipe}
          open={{
            makeFor,
            useFor,
            ctxMenu: openCtxMenu,
            rowMenu: (e, name) => setRowMenu({ x: e.clientX, y: e.clientY, name }),
            machinePicker: setPickMachineFor,
            fuelPicker: setPickFuelFor,
            modulesPicker: setPickModulesFor,
            applyModuleFill,
            pinsFor: setPinFor,
            spoilageFor: setSpoilDialog,
          }}
          renamingGroup={renamingGroup}
          onRenamingGroupChange={setRenamingGroup}
        />
      )}

      {/* Goal-item picker — add a new goal, or change an existing goal's item. */}
      {goalPicker && (
        <GoalPickerDialog
          replaceDisplay={
            goalPicker.replace ? (res?.display?.[goalPicker.replace] ?? goalPicker.replace) : null
          }
          onPick={pickGoalItem}
          onClose={() => setGoalPicker(null)}
        />
      )}

      {/* Block-icon picker (#40) — explicit item/fluid, or auto (first goal). */}
      {iconPicker && (
        <IconPickerDialog
          target={target}
          targetKind={goalInfo.data?.[target]?.kind ?? "item"}
          customIcon={customIcon}
          onPick={pickIcon}
          onReset={resetIcon}
          onClose={() => setIconPicker(false)}
        />
      )}

      {/* Goal context menu — right-click a goal cell */}
      {goalMenu && (
        <GoalMenu
          x={goalMenu.x}
          y={goalMenu.y}
          name={goalMenu.name}
          display={res?.display?.[goalMenu.name] ?? goalMenu.name}
          kind={kindOf(goalMenu.name)}
          isPrimary={goalMenu.name === target}
          isStock={goals.find((x) => x.name === goalMenu.name)?.stock != null}
          onChangeItem={() => setGoalPicker({ replace: goalMenu.name })}
          onMakePrimary={() => makePrimary(goalMenu.name)}
          onMakeStock={() => makeStockGoal(goalMenu.name)}
          onMakeRate={() => makeRateGoal(goalMenu.name)}
          onRemove={() => removeGoal(goalMenu.name)}
          onClose={() => setGoalMenu(null)}
        />
      )}

      {/* Recipe-row context menu — sub-block (#7) actions */}
      {pinFor && <PinDialog doc={doc} recipe={pinFor} res={res} onClose={() => setPinFor(null)} />}
      {rowMenu && (
        <RowMenu
          x={rowMenu.x}
          y={rowMenu.y}
          recipe={rowMenu.name}
          onOpenPins={() => setPinFor(rowMenu.name)}
          display={res?.recipeDisplay?.[rowMenu.name] ?? rowMenu.name}
          groups={rowGroups}
          currentGroup={rowGroups.find((g) => g.id === recipeGroups[rowMenu.name]) ?? null}
          onNewGroup={() => createGroupFromRow(rowMenu.name)}
          onJoinGroup={(gid) => doc.joinRecipeToGroup(rowMenu.name, gid)}
          onLeaveGroup={() => removeFromGroup(rowMenu.name)}
          onExtractToBlock={() => void extractRecipeToBlock(rowMenu.name)}
          onClose={() => setRowMenu(null)}
        />
      )}

      {/* Recipe picker — floats over everything, dismissable */}
      {pickFor && !pickFor.quick && !picker.isLoading && !autoAddRecipe && (
        <RecipePickerDialog
          mode={pickFor.mode}
          goodDisplay={res?.display?.[pickFor.name] ?? pickFor.name}
          candidates={picker.data}
          added={recipes}
          onAdd={add}
          onClose={() => setPickFor(null)}
        />
      )}

      {/* Building picker — choose which machine runs a recipe */}
      {pickMachineFor && (
        <BuildingPickerDialog
          recipe={pickMachineFor}
          recipeDisplay={res?.recipeDisplay?.[pickMachineFor] ?? pickMachineFor}
          current={res?.rows?.find((r) => r.recipe === pickMachineFor)?.machine?.name ?? null}
          onPick={(m) => {
            pickMachine(pickMachineFor, m);
            setPickMachineFor(null);
          }}
          onClose={() => setPickMachineFor(null)}
        />
      )}

      {/* Modules & beacons — per-recipe loadout, applied through the solver */}
      {pickModulesFor &&
        (() => {
          const mr = res?.rows?.find((r) => r.recipe === pickModulesFor);
          if (!mr?.machine) return null;
          return (
            <ModulesModal
              recipe={pickModulesFor}
              recipeDisplay={res?.recipeDisplay?.[pickModulesFor] ?? pickModulesFor}
              machineName={mr.machine.name}
              modules={moduleSel[pickModulesFor] ?? mr.modules}
              beacons={beaconSel[pickModulesFor] ?? []}
              effects={mr.effects}
              suggested={mr.suggestedModules}
              onChange={(mods, bcns) => doc.setModules(pickModulesFor, mods, bcns)}
              onClose={() => setPickModulesFor(null)}
            />
          );
        })()}

      {/* Fuel picker — choose what a burner burns */}
      {pickFuelFor &&
        (() => {
          const fr = res?.rows?.find((r) => r.recipe === pickFuelFor);
          if (!fr?.machine) return null;
          return (
            <FuelPickerDialog
              recipe={pickFuelFor}
              recipeDisplay={res?.recipeDisplay?.[pickFuelFor] ?? pickFuelFor}
              machine={fr.machine.name}
              current={fr?.fuel?.chosen ?? null}
              onPick={(f) => {
                pickFuel(pickFuelFor, f);
                setPickFuelFor(null);
              }}
              onClose={() => setPickFuelFor(null)}
            />
          );
        })()}

      {/* Incidental-spoil estimate dialog (#20) */}
      {spoilDialog && (
        <SpoilRateDialog
          item={spoilDialog}
          itemDisplay={res?.display?.[spoilDialog] ?? spoilDialog}
          spoilTicks={spoilables[spoilDialog] ?? null}
          current={spoilRates[spoilDialog] ?? null}
          onSave={(r) => {
            setSpoilRateFor(spoilDialog, r);
            setSpoilDialog(null);
          }}
          onClose={() => setSpoilDialog(null)}
        />
      )}

      {/* Snapshot history (#85): restore points with restore + diff-vs-current */}
      {historyOpen && (
        <SnapshotSheet
          blockId={blockId}
          onClose={() => setHistoryOpen(false)}
          currentName={blockName}
          currentDoc={solveInput}
          persistNow={() => (doc.store.state.dirty ? persist() : Promise.resolve())}
          onRestored={(r) => {
            // push the restored definition into the open editor — clean, so the
            // rehydrate can't trigger an auto-save of its own
            doc.hydrate(r.doc, r.name);
            void solveBlockFn({ data: r.doc as SolveInput }).then((result) =>
              qc.setQueryData<SolvedState>(solveQueryKey, {
                input: r.doc as SolveInput,
                result,
              }),
            );
            setBlockEnabled(r.enabled);
            // the restored name is authoritative; don't let auto-naming overwrite it
            customDecided.current = true;
            setNameCustom(r.name.trim().length > 0);
          }}
        />
      )}

      {/* Good context menu — explicit actions (safer than cycling) */}
      {ctxMenu && (
        <GoodMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          name={ctxMenu.name}
          kind={ctxMenu.kind}
          link={ctxMenu.link}
          display={res?.display?.[ctxMenu.name] ?? ctxMenu.name}
          blockId={blockId}
          locked={lockedInput === ctxMenu.name}
          importRate={res?.imports.find((f) => f.name === ctxMenu.name)?.rate ?? null}
          made={!!made?.has(ctxMenu.name)}
          producedInBlock={
            !!res?.rows.some((r) => r.products.some((pr) => pr.name === ctxMenu.name))
          }
          spoilRate={spoilRates[ctxMenu.name] ?? null}
          onAddGoal={() => void addGoalWithDefault(ctxMenu.name)}
          onLock={(r) => {
            setLockedInput(ctxMenu.name);
            setLockedRate(r);
          }}
          onUnlock={() => setLockedInput(null)}
          onCreateSupplier={(r) => void createSupplier(ctxMenu.name, r)}
          onMark={() => {
            doc.markMade(ctxMenu.name);
            doc.note(`Mark "${res?.display?.[ctxMenu.name] ?? ctxMenu.name}" made in-block`);
          }}
          onUnmark={() => {
            doc.unmark(ctxMenu.name);
            doc.note(`Unmark "${res?.display?.[ctxMenu.name] ?? ctxMenu.name}" (import instead)`);
          }}
          onEditSpoil={() => setSpoilDialog(ctxMenu.name)}
          onClearSpoil={() => setSpoilRateFor(ctxMenu.name, null)}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
