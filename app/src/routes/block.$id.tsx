import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useStore } from "@tanstack/react-store";
import { ActiveEditorRefContext } from "./block";
import { createBlockDocStore, solveInputOf } from "../components/block/doc-store.ts";
import {
  bridgeShowBlockFn,
  goodInfoFn,
  itemWeightsFn,
  loadBlockFn,
  logisticsContextFn,
  recipeCandidatesFn,
  recipeDefaultsFn,
  saveBlockFn,
  setBlockEnabledFn,
  solveBlockFn,
} from "../server/factorio";
import { launchesForRate, resolveLogistics } from "../lib/logistics";
import { STOCK_WINDOW_DEFAULT } from "../lib/goals";
import {
  groupMembers,
  groupNet,
  moveGroupSpan,
  resolveGroupAfterMove,
  type RowGroup,
} from "../lib/row-groups";
import { fmtSpoilTime, Icon, IconProvider, useSpoilables } from "../lib/icons";
import { ModulesChip, ModulesModal } from "../lib/modules-modal";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Copy,
  Flame,
  FlaskConical,
  Gamepad2,
  Grid2x2,
  GripVertical,
  Hammer,
  Layers,
  Lock,
  Plus,
  Power,
  Star,
  Timer,
  X,
  Zap,
} from "lucide-react";
import { RecipeHover } from "../lib/recipe-card";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "#/components/ui/sheet.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";
import { Input } from "#/components/ui/input.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";

import { SortableRow } from "../components/block/sortable-row.tsx";
import { BlockTasks } from "../components/block/block-tasks.tsx";
import { EditableRate } from "../components/block/editable-rate.tsx";
import { EditableStock } from "../components/block/editable-stock.tsx";
import {
  ItemChip,
  craftableStyle,
  dispTag,
  linkStyle,
  type Link as ItemLink,
} from "../components/block/item-chip.tsx";
import { LogiTag } from "../components/block/logi-tag.tsx";
import { Legend } from "../components/block/legend.tsx";
import { GoalPickerDialog } from "../components/block/goal-picker-dialog.tsx";
import { IconPickerDialog } from "../components/block/icon-picker-dialog.tsx";
import { RecipePickerDialog } from "../components/block/recipe-picker-dialog.tsx";
import { BuildingPickerDialog } from "../components/block/building-picker-dialog.tsx";
import { FuelPickerDialog } from "../components/block/fuel-picker-dialog.tsx";
import { SpoilRateDialog } from "../components/block/spoil-rate-dialog.tsx";
import { GoalMenu } from "../components/block/goal-menu.tsx";
import { RowMenu } from "../components/block/row-menu.tsx";
import { GoodMenu } from "../components/block/good-menu.tsx";
import { fmtAmt, fmtW, num } from "../components/block/format.ts";
import { cellChip, head } from "../components/block/styles.ts";

export const Route = createFileRoute("/block/$id")({ component: BlockRoute });

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
    disabled,
    dispositions: disp,
    spoilRates,
    rowGroups,
    recipeGroups,
    machines: machineSel,
    fuels: fuelSel,
    modules: moduleSel,
    beacons: beaconSel,
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
  // Drag-reorder of recipe rows via dnd-kit. PointerSensor covers mouse + touch; the
  // small activation distance keeps a tap/click on the grip from registering as a drag.
  const recipeSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Sub-blocks (#7): named groups of recipe rows, display-only. Members stay
  // contiguous in `recipes` order (lib/row-groups.ts). Fold state is a view
  // preference — localStorage, not the doc, so folding doesn't churn auto-save.
  // Planned spoil losses (#20): item → expected rot rate /s, solved as extra
  // pinned surplus. `spoilDialog` holds the item whose rate is being edited.
  const [spoilDialog, setSpoilDialog] = useState<string | null>(null);
  const [foldedGroups, setFoldedGroups] = useState<Record<number, boolean>>({});
  // rename-in-place on a group header (holds the group id being edited)
  const [renamingGroup, setRenamingGroup] = useState<number | null>(null);
  // right-click menu on a recipe row (sub-block actions)
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; name: string } | null>(null);
  // Reorder is display/authoring only — the solver is order-independent, so this just
  // changes how the rows are listed (and persists `recipes`). Sub-blocks (#7) make
  // it three cases: drag a group header to move the whole span; drop a row on a
  // header to join that group; drop a row between two members to adopt their group.
  const onRecipeDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const aid = String(active.id);
    const oid = String(over.id);
    if (aid.startsWith("grp:")) {
      const gid = Number(aid.slice(4));
      const rest = recipes.filter((r) => recipeGroups[r] !== gid);
      const at = oid.startsWith("grp:")
        ? rest.findIndex((r) => recipeGroups[r] === Number(oid.slice(4)))
        : rest.indexOf(oid);
      doc.applyReorder(
        moveGroupSpan(recipes, recipeGroups, gid, at < 0 ? rest.length : at),
        recipeGroups,
      );
      return;
    }
    if (oid.startsWith("grp:")) {
      doc.joinRecipeToGroup(aid, Number(oid.slice(4)));
      return;
    }
    const from = recipes.indexOf(aid);
    const to = recipes.indexOf(oid);
    if (from < 0 || to < 0) return;
    const moved = arrayMove(recipes, from, to);
    doc.applyReorder(moved, resolveGroupAfterMove(moved, recipeGroups, aid));
  };
  const toggleFold = (id: number) =>
    setFoldedGroups((f) => {
      const next = { ...f, [id]: !f[id] };
      localStorage.setItem(`pyops.groupFold.${blockId}`, JSON.stringify(next));
      return next;
    });
  const createGroupFromRow = (recipe: string) => setRenamingGroup(doc.createGroupFromRow(recipe)); // name it right away
  const renameGroup = doc.renameGroup;
  const ungroupRows = doc.ungroupRows;
  const removeFromGroup = doc.removeFromGroup;
  const [pickFor, setPickFor] = useState<{ name: string; mode: "produce" | "consume" } | null>(
    null,
  );
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
  // Recipe removal is a click-to-confirm: the first click on × arms the row (× →
  // "remove?"), the second removes it. Removing loses the row's machine/fuel/module
  // picks and it sits next to the disable toggle, so a lone misclick shouldn't destroy
  // it. Auto-disarms after a few seconds. Holds the recipe name pending confirmation.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRemove = (name: string) => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (confirmRemove === name) {
      setConfirmRemove(null);
      drop(name);
      return;
    }
    setConfirmRemove(name);
    removeTimer.current = setTimeout(() => setConfirmRemove(null), 3000);
  };
  useEffect(() => () => void (removeTimer.current && clearTimeout(removeTimer.current)), []);

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
  useEffect(() => {
    if (s.hydrated || !loaded.data) return;
    // the store normalizes legacy doc shapes + drifted groups on hydrate
    doc.hydrate(loaded.data.data, loaded.data.name);
    try {
      const f = JSON.parse(localStorage.getItem(`pyops.groupFold.${blockId}`) || "{}");
      if (f && typeof f === "object") setFoldedGroups(f);
    } catch {
      /* ignore */
    }
    setBlockEnabled(loaded.data.enabled ?? true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded.data]);

  const copySetup = () => {
    void navigator.clipboard?.writeText(
      JSON.stringify({ goals, recipes, disp, machineSel, fuelSel, moduleSel, beaconSel }, null, 2),
    );
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
  const setDispFor = doc.setDisposition;
  const cycleDispFor = doc.cycleDisposition;
  const setSpoilRateFor = doc.setSpoilRate;
  const toggleDisabled = doc.toggleDisabled;
  // Goals: an ordered list, primary first (goals[0] = the sizing anchor). A new
  // block's first goal is pinned to 1/s; further goals start unpinned (co-products)
  // and can be pinned to their own target rate.
  const addGoal = doc.addGoal;
  const removeGoal = doc.removeGoal;
  const setGoalRate = doc.setGoalRate;
  const setGoalUnit = doc.setGoalUnit;
  const makeStockGoal = doc.makeStockGoal;
  const makeRateGoal = doc.makeRateGoal;
  const setGoalStock = doc.setGoalStock;
  const setGoalWindow = doc.setGoalWindow;
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
  // The goal-picker dialog routes to add / change depending on how it was opened.
  const pickGoalItem = (name: string) => {
    if (goalPicker?.replace) changeGoalItem(goalPicker.replace, name);
    else addGoal(name);
    setGoalPicker(null);
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

  const hasDisp = Object.keys(disp).length > 0;
  // the solver/save doc, assembled by the store (empty maps omitted, disabled
  // recipes as a sorted array — see solveInputOf)
  const solveInput = useMemo(() => solveInputOf(s), [s]);
  const disabledRecipes = solveInput.disabledRecipes ?? [];
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
  const solve = useQuery({
    queryKey: [
      "solve",
      goals,
      recipes,
      disabledRecipes,
      spoilRates,
      disp,
      machineSel,
      fuelSel,
      moduleSel,
      beaconSel,
    ],
    queryFn: () => solveBlockFn({ data: solveInput }),
    enabled: goals.length > 0,
    // keep the last result while a re-solve is in flight — otherwise every edit
    // briefly unmounts everything derived from `res` (incl. open modals)
    placeholderData: keepPreviousData,
  });
  // Auto-save (debounced) to the DB, plus a flush on unmount so switching blocks
  // never drops edits. The store owns dirty: only user-edit actions set it, and
  // hydrate() never does — so hydration (incl. a fresh refetch) can't trigger a
  // write that would clobber the block. Persist reads the store directly, so
  // the flush always saves the newest state (no snapshot ref needed).
  const retryHold = useRef(false); // a failed save stays dirty but waits for the next edit
  const persist = () => {
    doc.markClean();
    setSaveState("saving");
    const cur = doc.store.state;
    return saveBlockFn({
      data: {
        id: blockId,
        name: cur.blockName.trim() || undefined,
        data: solveInputOf(cur),
      },
    })
      .then(() => {
        setSaveState("saved");
        void qc.invalidateQueries({ queryKey: ["blocks"] });
      })
      .catch(() => {
        retryHold.current = true;
        doc.markDirty(); // failed — stay dirty so a later edit retries
        setSaveState("idle");
      });
  };
  useEffect(() => {
    if (!s.hydrated || !s.dirty) return;
    if (retryHold.current) {
      // the markDirty after a failed save re-runs this effect; don't hot-loop —
      // wait for a real edit (the next store change) to retry
      retryHold.current = false;
      return;
    }
    const t = setTimeout(persist, 700);
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
  const logistics = useQuery({
    queryKey: ["logisticsContext"],
    queryFn: () => logisticsContextFn(),
    refetchInterval: 5000,
  });
  const logiPrefs = logistics.data?.prefs;
  const logiAny =
    !!logiPrefs && (logiPrefs.showBelts || logiPrefs.showInserters || logiPrefs.showRockets);
  const logiResolved = logiAny && logistics.data ? resolveLogistics(logistics.data) : null;
  const showBelts = !!logiPrefs?.showBelts;
  const showInserters = !!logiPrefs?.showInserters;

  const add = (name: string) => {
    doc.addRecipe(name);
    setPickFor(null);
    // Bake the preferred (favorite, else lowest-tier/cheapest) building + fuel for
    // this recipe into the block's stored picks (#18). New recipes only — existing
    // rows already have their picks and aren't touched.
    void recipeDefaultsFn({ data: [name] }).then((defaults) => {
      const d = defaults[name];
      if (d) doc.applyRecipeDefaults(name, d);
    });
  };
  const drop = doc.dropRecipe;

  // When a flow has exactly one craftable recipe, skip the picker dialog and add
  // it directly. A superseded recipe (its base no longer exists in-game) or one
  // that's already in the block still opens the dialog, so the explanation/state
  // stays visible rather than the click silently doing nothing.
  const loneRecipe =
    pickFor && picker.data?.length === 1 && !picker.data[0].superseded ? picker.data[0] : null;
  const autoAddRecipe = loneRecipe && !recipes.includes(loneRecipe.name) ? loneRecipe.name : null;
  useEffect(() => {
    if (autoAddRecipe) add(autoAddRecipe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAddRecipe]);
  const res = solve.data;

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

  const freed = new Set(res?.autoFreed ?? []);
  const unused = new Set(res?.unusedRecipes ?? []);
  const statusColor =
    res?.status === "solved"
      ? "text-success"
      : res?.status === "infeasible"
        ? "text-destructive"
        : "text-warning";

  // Block health for the title tint (mirrors the sidebar verdict): red for broken
  // refs / infeasible, amber for unmade goals / relaxed / underdetermined / temp
  // mismatches, none when clean.
  const editorHealth: "error" | "warn" | null = !res
    ? null
    : res.broken || res.status === "infeasible"
      ? "error"
      : (res.unmadeTargets?.length ?? 0) > 0 ||
          (res.unusedRecipes?.length ?? 0) > 0 ||
          res.status === "relaxed" ||
          res.status === "underdetermined" ||
          res.tempWarnings.length > 0
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
  const exportSet = new Set(res?.exports.map((f) => f.name));
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
    name === target
      ? "target"
      : importSet.has(name)
        ? "import"
        : exportSet.has(name)
          ? "export"
          : "linked";
  const makeFor = (name: string) => setPickFor({ name, mode: "produce" });
  const useFor = (name: string) => setPickFor({ name, mode: "consume" });

  // Recipe-grid layout. Desktop (md+): a 4-column grid — recipe | machines |
  // ingredients | products. Mobile: the columns can't fit (the first two alone need
  // 410px), so each row stacks vertically with per-section labels and the column
  // header is hidden.
  const TPL = "md:[grid-template-columns:minmax(170px,1.1fr)_minmax(240px,1.2fr)_1.4fr_1.4fr]";
  const GRID = `flex flex-col gap-2.5 px-3 py-3 md:grid md:items-center md:gap-4 md:py-3.5 ${TPL}`;
  const HEAD = `${head} hidden md:grid md:items-center md:gap-4 ${TPL}`;

  // The block's face (#40): the explicit pick when set, else the first goal's icon.
  const blockIcon =
    customIcon ?? (target ? { kind: goalInfo.data?.[target]?.kind ?? "item", name: target } : null);

  // Sub-blocks (#7): flatten recipes+groups into the render sequence. A group
  // renders a header at its first member's position; members follow (contiguous
  // by invariant) unless the group is folded, in which case they're skipped and
  // the header shows the chain's net flows instead.
  type RowEntry = { type: "group"; group: RowGroup } | { type: "recipe"; name: string };
  const rowSeq: RowEntry[] = [];
  {
    const byId = new Map(rowGroups.map((g) => [g.id, g]));
    const seen = new Set<number>();
    for (const name of recipes) {
      const g = recipeGroups[name] != null ? byId.get(recipeGroups[name]) : undefined;
      if (g) {
        if (!seen.has(g.id)) {
          seen.add(g.id);
          rowSeq.push({ type: "group", group: g });
        }
        if (!foldedGroups[g.id]) rowSeq.push({ type: "recipe", name });
      } else rowSeq.push({ type: "recipe", name });
    }
  }
  const sortableIds = rowSeq.map((e) => (e.type === "group" ? `grp:${e.group.id}` : e.name));

  /** A sub-block's header row: fold chevron, rename-in-place name, and — when
   * folded — the chain's net I/O ("ore in → plates out"), machines and power. */
  const renderGroupHeader = (g: RowGroup) => {
    const members = groupMembers(recipes, recipeGroups, g.id);
    const folded = !!foldedGroups[g.id];
    // disabled rows (#73) contribute nothing to the solve, so keep them out of
    // the net too — the header should read what the chain actually does
    const net =
      folded && res?.rows
        ? groupNet(res.rows, new Set(members.filter((m) => !disabled.has(m))))
        : null;
    return (
      <SortableRow key={`grp:${g.id}`} id={`grp:${g.id}`}>
        {({ setActivatorNodeRef, listeners, attributes, isDragging }) => (
          <div
            className={`relative flex flex-wrap items-center gap-2 border-t border-border border-l-2 border-l-primary/50 bg-muted/40 px-2 py-2 ${isDragging ? "bg-card shadow-lg" : ""}`}
          >
            <span
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              title="drag to move this sub-block (its rows move with it)"
              className="flex shrink-0 cursor-grab touch-none items-center text-muted-foreground select-none hover:text-foreground active:cursor-grabbing"
            >
              <GripVertical className="size-4" />
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => toggleFold(g.id)}
              title={folded ? "expand this sub-block" : "collapse this sub-block to one line"}
              className="text-muted-foreground"
            >
              {folded ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
            </Button>
            <Layers className="size-4 shrink-0 text-primary/70" />
            {renamingGroup === g.id ? (
              <Input
                autoFocus
                defaultValue={g.name}
                onFocus={(e) => e.target.select()}
                onBlur={(e) => {
                  renameGroup(g.id, e.target.value.trim() || g.name);
                  setRenamingGroup(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setRenamingGroup(null);
                }}
                className="h-7 w-44 px-1.5"
              />
            ) : (
              <span
                className="cursor-default font-semibold select-none"
                onDoubleClick={() => setRenamingGroup(g.id)}
                title="double-click to rename"
              >
                {g.name}
              </span>
            )}
            <span className="text-sm text-muted-foreground">
              {members.length} recipe{members.length === 1 ? "" : "s"}
            </span>
            {net && (
              <span className="flex flex-wrap items-center gap-1.5 text-sm">
                {net.inputs.map((f) => (
                  <span key={f.name} className="flex items-center gap-1 bg-muted/50 px-1.5 py-0.5">
                    <Icon kind={f.kind as "item" | "fluid"} name={f.name} size="sm" />
                    <span className="tabular-nums">{num(f.rate)}</span>
                  </span>
                ))}
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                {net.outputs.map((f) => (
                  <span key={f.name} className="flex items-center gap-1 bg-muted/50 px-1.5 py-0.5">
                    <Icon kind={f.kind as "item" | "fluid"} name={f.name} size="sm" />
                    <span className="tabular-nums">{num(f.rate)}</span>
                  </span>
                ))}
                {net.machines > 0 && (
                  <span className="text-sm text-muted-foreground">
                    · {num(net.machines)} machines
                  </span>
                )}
                {net.powerW > 0 && <span className="text-sm text-info">{fmtW(net.powerW)}</span>}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto text-muted-foreground hover:text-destructive"
              onClick={() => ungroupRows(g.id)}
              title="ungroup — dissolve the sub-block, its rows stay"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )}
      </SortableRow>
    );
  };

  return (
    <div className="p-4 font-mono text-base text-foreground">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon-lg"
          onClick={() => setIconPicker(true)}
          title={
            customIcon
              ? "block icon (custom) — click to change or reset to auto"
              : "block icon — follows the first goal; click to pick your own"
          }
          className={customIcon ? "border-primary/60" : ""}
        >
          {blockIcon ? (
            <Icon
              kind={blockIcon.kind as "item" | "fluid"}
              name={blockIcon.name}
              size="md"
              noHover
              noTitle
            />
          ) : (
            <Grid2x2 className="size-4 text-muted-foreground" />
          )}
        </Button>
        <Input
          value={blockName}
          onChange={(e) => {
            const v = e.target.value;
            doc.setBlockName(v);
            // typing a name pins it; clearing it resumes auto-naming from the goal
            customDecided.current = true;
            setNameCustom(v.trim().length > 0);
          }}
          placeholder="auto-named from goal…"
          className={`w-56 font-semibold ${titleHealthCls}`}
        />
        <span className="flex w-14 items-center gap-1 text-xs text-muted-foreground">
          {saveState === "saving" ? (
            "saving…"
          ) : saveState === "saved" ? (
            <>
              saved <Check className="size-3" />
            </>
          ) : (
            ""
          )}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={copySetup}
          title="Copy setup — copy this block's recipe/module setup to the clipboard"
          className="text-muted-foreground"
        >
          <Copy className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => showInGame.mutate()}
          disabled={showInGame.isPending}
          title="Open in game — show this block as an in-game build sheet; click a building there for a configured blueprint (needs the bridge)"
          className="text-muted-foreground"
        >
          <Gamepad2 className={`size-4 ${showInGame.isPending ? "animate-pulse" : ""}`} />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={toggleBlockEnabled}
          title={
            blockEnabled
              ? "Disable block — keep it here but exclude it from every factory-wide total"
              : "Enable block — count this block in the factory totals again"
          }
          className={
            !blockEnabled
              ? "border-warning/60 bg-warning/10 text-warning hover:bg-warning/20"
              : "text-muted-foreground"
          }
        >
          <Power className="size-4" />
        </Button>
        {!blockEnabled && (
          <Badge className="border-transparent bg-warning/15 font-semibold text-warning">
            disabled — excluded from factory totals
          </Badge>
        )}
        {res?.buildCost && res.buildCost.buildings.length > 0 && (
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                title="Building summary — the buildings + one-time materials to construct this block"
                className="text-muted-foreground"
              >
                <Hammer className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-96 max-w-[92vw] font-mono">
              <SheetHeader>
                <SheetTitle>Building summary</SheetTitle>
              </SheetHeader>
              <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
                <p className="text-sm text-muted-foreground">
                  The buildings to construct this block, and the one-time materials to build them —
                  a shopping list, separate from the per-second flows.
                </p>
                <div>
                  <FieldLabel className="mb-1.5">Buildings</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {res.buildCost.buildings.map((b) => (
                      <span key={b.name} className={cellChip} title={b.display}>
                        <Icon kind="item" name={b.name} size="sm" />
                        <span className="tabular-nums">×{b.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <FieldLabel className="mb-1.5">Materials to build them</FieldLabel>
                  {res.buildCost.materials.length === 0 ? (
                    <span className="text-sm text-muted-foreground">
                      — (no build recipe found for these buildings)
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {res.buildCost.materials.map((m) => (
                        <span key={m.name} className={cellChip} title={m.display}>
                          <Icon kind={m.kind as "item" | "fluid"} name={m.name} size="sm" />
                          <span className="tabular-nums">{fmtAmt(m.amount)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </SheetContent>
          </Sheet>
        )}
        {showInGame.data && !showInGame.data.sent && (
          <span className="text-sm text-warning">game not connected</span>
        )}
        {showInGame.data?.sent && (
          <span className="flex items-center gap-1 text-sm text-success">
            opened in game <Check className="size-3" />
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <Legend cls={linkStyle.target} label="goal" />
          <Legend cls={linkStyle.linked} label="linked" />
          <Legend cls={linkStyle.import} label="raw in" />
          <Legend cls={craftableStyle} label="craftable" />
          <Legend cls={linkStyle.export} label="export" />
          <span
            className="text-muted-foreground/70"
            title="right-click any item for actions (make a goal, lock as sizing input, force import/export/balance, locate in game). Alt-click quick-cycles the disposition."
          >
            · right-click = menu
          </span>
        </span>
        <HelpButton title="What is a block?">
          <p>
            A block is <span className="text-foreground">one production unit you design</span>: pick
            the recipes to make one or more goal goods, and the solver works out how many of each
            building you need (fractional counts and all).
          </p>
          <div>
            <div className="font-semibold text-foreground">Goals</div>
            <p className="mt-1">
              A block can target several products at once — each goal has a{" "}
              <span className="text-foreground">target rate</span> and the block is sized so that
              good comes out at exactly that rate. Click a goal&apos;s rate to edit it, and click
              its unit to cycle <span className="text-foreground">/s → /min → /h</span> — enter
              science as 10/min or a slow bootstrap as 0.5/h; the unit sticks per goal while the
              solver works in per-second underneath. Not everything is throughput:{" "}
              <span className="text-foreground">right-click a goal → Keep in stock</span> turns it
              into a buffer goal (&quot;keep 100 on hand&quot;) with a refill window (default 10m,
              click to cycle) — machines are sized to rebuild the buffer within the window, and the
              factory ledger badges the flow <span className="text-info">↻ stock</span>. So a single
              &quot;logistics&quot; block can make belts @10/s, undergrounds @4/s and splitters @2/s
              side by side. The first goal <span className="text-info">names the block</span>,
              anchors the scale tools, and is the default icon;{" "}
              <Star className="inline size-3.5 text-foreground" /> moves a goal to the front. Click
              the icon next to the block&apos;s name to pick any item or fluid as its icon instead.
              A good you don&apos;t target isn&apos;t a goal — it falls out as a byproduct (export).
            </p>
            <p className="mt-1">
              If your goals can&apos;t all be met at once (e.g. two goods locked to a fixed ratio by
              one recipe), the block is <span className="text-destructive">infeasible</span> and
              says so — add a recipe to make more of the short good, or change a rate.
            </p>
          </div>
          <p>
            <span className="text-foreground">How it solves.</span> Given the goals, every other
            good in the block is one of: <span className="text-foreground">balanced</span> (made and
            used inside the block), <span className="text-foreground">imported</span> (brought in
            from outside or another block), or <span className="text-foreground">exported</span>{" "}
            (surplus that leaves). The solver sets each recipe&apos;s run-rate to satisfy that —
            it&apos;s a linear system, and it handles Py&apos;s cyclic recipe chains.
          </p>
          <p>
            <span className="text-foreground">You drive it, not an optimizer.</span> You choose the
            recipes and how to split a good between competing ones; PyOps just solves the system you
            describe. <span className="text-foreground">Right-click</span> any item to make it a
            goal, lock it as a sizing input, or force import / export / balance — the colored legend
            shows each item&apos;s current disposition.
          </p>
          <div>
            <div className="font-semibold text-foreground">Sub-blocks</div>
            <p className="mt-1">
              <span className="text-foreground">Right-click a recipe&apos;s name</span> to start a
              sub-block — a named, collapsible group of rows. Add more rows from the same menu or by
              dragging them onto the header; collapse it and the whole chain reads as one line
              showing its <span className="text-foreground">net flows</span> (what goes in, what
              comes out — intermediates cancel), machines and power. Display-only: the solve is
              exactly the same expanded, collapsed, or dissolved. Drag the header to move the whole
              chain; double-click its name to rename; × ungroups (the rows stay).
            </p>
          </div>
          <div>
            <div className="font-semibold text-foreground">Toolbar (next to the name)</div>
            <ul className="mt-1 space-y-1.5">
              <li className="flex items-start gap-2">
                <Copy className="mt-0.5 size-4 shrink-0 text-foreground" />
                <span>copies this block&apos;s recipe/module setup to the clipboard;</span>
              </li>
              <li className="flex items-start gap-2">
                <Gamepad2 className="mt-0.5 size-4 shrink-0 text-foreground" />
                <span>
                  shows this block as an in-game build sheet — click a building there for a
                  configured blueprint;
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Hammer className="mt-0.5 size-4 shrink-0 text-foreground" />
                <span>
                  <span className="text-foreground">Building summary</span> — opens a drawer listing
                  the buildings and the one-time materials to construct this block (a shopping list,
                  kept out of the way of the per-second flows).
                </span>
              </li>
            </ul>
          </div>
          <p>
            Per-machine <span className="text-foreground">modules / beacons</span> are tuned in the
            block body to cut building count. The Cybersyn request-combinator generator now lives in
            the in-game mod panel.
          </p>
        </HelpButton>
      </div>

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
              <span className="text-muted-foreground">missing recipe:</span>
              {res.missing.recipes.map((n) => (
                <code key={n} className="bg-destructive/15 px-1.5 py-0.5 text-destructive">
                  {n}
                </code>
              ))}
            </div>
          )}
          {res.missing.goods.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">missing good:</span>
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
        <Card>
          <CardHeader>
            <CardTitle>Goal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Goals as compact stacked cells (icon over rate) so many fit — a block can
                target several products at once (e.g. belts, undergrounds, splitters). Each
                goal has a target rate (a solver target); click the rate to edit it. Click a
                goal's icon to add a recipe that makes it. goals[0] names the block + anchors
                the rate-scaling tools; ★ moves a goal to the front. A good you don't target
                shows up as a byproduct, not here. */}
            <div className="flex flex-wrap gap-2">
              {goals.map((goal, i) => {
                const g = goal.name;
                const isFirst = i === 0;
                const kind = kindOf(g);
                const goalMissing = res?.missing?.goods.includes(g) ?? false;
                // declared but no recipe in the block makes it — fixable, not broken.
                // Suppressed on a broken block: the missing-refs banner already
                // explains why nothing's being made there.
                const goalUnmade =
                  !goalMissing && !res?.broken && (res?.unmadeTargets?.includes(g) ?? false);
                return (
                  <div
                    key={g}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setGoalMenu({ x: e.clientX, y: e.clientY, name: g });
                    }}
                    className={`group relative flex min-w-16 flex-col items-center gap-0.5 px-2 py-1 ${
                      goalMissing
                        ? "bg-destructive/10 ring-1 ring-destructive/40"
                        : goalUnmade
                          ? "bg-warning/10 ring-1 ring-warning/40"
                          : isFirst
                            ? "bg-info/10 ring-1 ring-info/30"
                            : "bg-info/5 ring-1 ring-info/20"
                    }`}
                    title={
                      goalMissing
                        ? `${g} — no longer exists in the current data`
                        : goalUnmade
                          ? `${res?.display?.[g] ?? g} — no recipe in this block makes it. Click the icon to add one.`
                          : `${res?.display?.[g] ?? g}${isFirst ? " — names the block" : ""} · right-click for options`
                    }
                  >
                    {/* move-to-front (not on the first goal) · remove — on hover */}
                    <div className="absolute -top-2 -right-1.5 flex gap-1 opacity-0 group-hover:opacity-100">
                      {!isFirst && (
                        <button
                          onClick={() => makePrimary(g)}
                          title="move to front — name the block after this goal"
                          className="flex size-5 items-center justify-center bg-background text-info shadow ring-1 ring-border hover:brightness-125"
                        >
                          <Star className="size-3" />
                        </button>
                      )}
                      <button
                        onClick={() => removeGoal(g)}
                        title="remove this goal"
                        className="flex size-5 items-center justify-center bg-background text-muted-foreground shadow ring-1 ring-border hover:text-destructive"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                    <button
                      onClick={() => (isFirst && goal.rate < 0 ? useFor(g) : makeFor(g))}
                      title="click to add a recipe that makes this goal (right-click to change the item)"
                    >
                      <Icon kind={kind} name={g} size="lg" title={res?.display?.[g] ?? g} />
                    </button>
                    {goalMissing ? (
                      <span className="flex items-center gap-0.5 text-sm font-semibold text-destructive">
                        <AlertTriangle className="size-3" /> gone
                      </span>
                    ) : goal.stock != null ? (
                      <span className="text-sm">
                        <EditableStock
                          stock={goal.stock}
                          window={goal.window ?? STOCK_WINDOW_DEFAULT}
                          onChange={(n) => setGoalStock(g, n)}
                          onWindowChange={(w) => setGoalWindow(g, w)}
                        />
                      </span>
                    ) : (
                      <span className="text-sm">
                        <EditableRate
                          value={goal.rate}
                          unit={goal.unit ?? "s"}
                          readOnly={isFirst && !!lockedInput}
                          onChange={(v) => setGoalRate(g, v)}
                          onUnitChange={(u) => setGoalUnit(g, u)}
                        />
                      </span>
                    )}
                    {goalUnmade && (
                      <span className="flex items-center gap-0.5 text-sm font-semibold text-warning">
                        <AlertTriangle className="size-3" /> no recipe
                      </span>
                    )}
                    {/* Rates near the solver's noise floor (flows under 1e-6/s read as
                        zero) solve unreliably — and are usually a proxy for "just keep
                        some around", which is a stock goal's job (#38), not a rate's. */}
                    {!goalMissing &&
                      goal.stock == null &&
                      goal.rate !== 0 &&
                      Math.abs(goal.rate) < 1e-4 && (
                        <span
                          className="flex cursor-help items-center gap-0.5 text-sm font-semibold text-warning"
                          title="rates this small can fall below the solver's noise floor — flows may read as zero. If the intent is 'just make/keep some', a keep-in-stock goal (planned) will express that better than a tiny rate."
                        >
                          <AlertTriangle className="size-3" /> very low rate
                        </span>
                      )}
                    {logiResolved && kind === "item" && !goalMissing && (
                      <LogiTag
                        resolved={logiResolved}
                        rate={Math.abs(goal.rate)}
                        machineCount={0}
                        showBelts={showBelts}
                        showInserters={showInserters}
                        launch={launchInfo(g, Math.abs(goal.rate))}
                      />
                    )}
                  </div>
                );
              })}
              {/* add a goal */}
              <button
                onClick={() => setGoalPicker({})}
                title="add a goal product"
                className="flex min-w-16 flex-col items-center justify-center gap-0.5 border border-dashed border-border px-2 py-1 text-muted-foreground hover:text-foreground"
              >
                <Plus className="size-6" />
                <span className="text-sm">goal</span>
              </button>
            </div>
            {!target && (
              <div className="text-sm text-muted-foreground">
                Pick a goal product to size this block.
              </div>
            )}
            {lockedInput && (
              <div className="flex items-center gap-1 text-sm text-info">
                <Lock className="size-3 shrink-0" /> sized by input — edit the locked rate in
                Imports, or unlock it there
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="justify-between">
            <CardTitle>Block balance</CardTitle>
            {res && (
              <span className={statusColor}>
                {res.status}
                {res.message ? ` — ${res.message}` : ""}
              </span>
            )}
          </CardHeader>
          {/* Active disposition overrides — ALWAYS shown when any exist, even if the
              solve is infeasible and the item's chip is hidden, so a forced override
              (e.g. an input cycled to export) can never soft-lock the block. */}
          {hasDisp && (
            <Callout tone="info" icon={null} className="mx-3 mt-2 px-2 py-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span>forced overrides:</span>
                {Object.entries(disp).map(([name, d]) => (
                  <button
                    key={name}
                    onClick={() => setDispFor(name, "auto")}
                    title="click to clear this override (back to auto)"
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 ${dispTag[d].cls} hover:brightness-110`}
                  >
                    <Icon kind="item" name={name} size="sm" title={res?.display?.[name] ?? name} />
                    {res?.display?.[name] ?? name} {dispTag[d].label} <X className="size-3" />
                  </button>
                ))}
                <button
                  onClick={doc.clearDispositions}
                  title="clear all forced overrides"
                  className="text-muted-foreground underline hover:text-foreground"
                >
                  clear all
                </button>
              </div>
            </Callout>
          )}
          {/* Planned spoil losses (#20) — always visible when set: the pinned
              surplus never reaches the boundary flows (it rots), so without this
              strip a planned loss would be invisible. */}
          {Object.keys(spoilRates).length > 0 && (
            <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 border border-warning/30 bg-warning/10 px-2 py-1.5 text-sm">
              <span className="flex items-center gap-1 text-warning">
                <Timer className="size-3" /> planned spoil losses:
              </span>
              {Object.entries(spoilRates).map(([name, r]) => (
                <button
                  key={name}
                  onClick={() => setSpoilDialog(name)}
                  title="production is sized to cover this rot rate — click to edit"
                  className="inline-flex items-center gap-1 bg-warning/20 px-1.5 py-0.5 text-warning hover:brightness-110"
                >
                  <Icon kind="item" name={name} size="sm" title={res?.display?.[name] ?? name} />
                  {res?.display?.[name] ?? name} {num(r)}/s
                </button>
              ))}
            </div>
          )}
          {res?.status === "infeasible" ? (
            <Callout tone="destructive" className="m-3 p-3">
              {/* Only a genuine reverse-running cycle gets the "chain runs backward"
                  story; any other infeasibility shows the solver's own reason. */}
              {res.negativeRecipes?.length ? (
                <>
                  <div className="mb-2 font-semibold">
                    Chain runs backward — a loop has no raw feed. Recipes in red below would run in
                    reverse.
                  </div>
                  {res.stuckItems?.length ? (
                    <>
                      <div className="mb-1 text-muted-foreground">
                        Starved loop items — click one to add a recipe that feeds it:
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-2">
                        {res.stuckItems.map((n) => (
                          <ItemChip
                            key={n}
                            name={n}
                            kind="item"
                            display={res.display?.[n]}
                            link="import"
                            craftable={producible.has(n)}
                            onClick={() => makeFor(n)}
                          />
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="text-muted-foreground">
                      Mark a cycling item as <span className="font-semibold">import</span>, or add a
                      recipe that supplies the loop.
                    </div>
                  )}
                </>
              ) : (
                <div className="font-semibold">
                  {res.message ?? "This block has no exact solution. Adjust a target or recipe."}
                </div>
              )}
            </Callout>
          ) : (
            <>
              {res?.unmadeTargets?.length && !res.broken ? (
                <div className="border-b border-border px-3 py-2 text-sm text-warning">
                  <div className="mb-1 flex items-center gap-1 font-semibold">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    {res.unmadeTargets.length === 1 ? "Goal has" : "Goals have"} no recipe yet — add
                    one to make {res.unmadeTargets.length === 1 ? "it" : "them"}:
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-2">
                    {res.unmadeTargets.map((n) => (
                      <ItemChip
                        key={n}
                        name={n}
                        kind={kindOf(n)}
                        display={res.display?.[n]}
                        link="target"
                        onClick={() => makeFor(n)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {res?.unusedRecipes?.length && !res.broken ? (
                <div className="border-b border-border px-3 py-2 text-sm text-destructive">
                  <div className="mb-1 flex items-center gap-1 font-semibold">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    {res.unusedRecipes.length === 1
                      ? "1 recipe isn't"
                      : `${res.unusedRecipes.length} recipes aren't`}{" "}
                    used by this block&apos;s goal — pinned to 0. Remove{" "}
                    {res.unusedRecipes.length === 1 ? "it" : "them"}, or balance an item to connect{" "}
                    {res.unusedRecipes.length === 1 ? "it" : "them"}:
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-2">
                    {res.unusedRecipes.map((n) => (
                      <span key={n} className="flex min-w-0 items-center gap-1">
                        <Icon kind="recipe" name={n} size="md" noHover />
                        <span className="truncate">{res.display?.[n] ?? n}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {res && res.tempWarnings?.length > 0 && (
                <div className="border-b border-border px-3 py-2 text-sm text-warning">
                  {res.tempWarnings.map((w) => (
                    <div
                      key={`${w.recipe}-${w.item}`}
                      className="flex items-center gap-1"
                      title="the solver links fluids by name — check your heat chain"
                    >
                      <AlertTriangle className="size-3.5 shrink-0" />{" "}
                      {res.display?.[w.recipe] ?? w.recipe} needs {res.display?.[w.item] ?? w.item}{" "}
                      at {w.needs}, but this block makes it at {w.got.join("°, ")}°
                    </div>
                  ))}
                </div>
              )}
              {res &&
                (res.power.totalW > 0 ||
                  res.power.heatW > 0 ||
                  Math.abs(res.power.pollutionPerMin) > 0.005) && (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border px-3 py-2 text-sm">
                    {res.power.totalW > 0 && (
                      <span className="flex items-center gap-1 text-info">
                        <Zap className="size-3.5" /> {fmtW(res.power.totalW)}{" "}
                        <span className="text-muted-foreground">electric</span>
                      </span>
                    )}
                    {Math.abs(res.power.pollutionPerMin) > 0.005 && (
                      <span
                        className={`flex items-center gap-1 ${res.power.pollutionPerMin < 0 ? "text-success" : "text-warning/80"}`}
                        title="pollution per minute from this block's machines (base emissions × energy-consumption × pollution module effects; fuel-type multipliers not modelled). Negative = net absorption — Py forestry and plantations soak pollution like trees."
                      >
                        <Cloud className="size-3.5" /> {num(Math.abs(res.power.pollutionPerMin))}
                        <span className="text-muted-foreground">
                          pollution/min{res.power.pollutionPerMin < 0 ? " absorbed" : ""}
                        </span>
                      </span>
                    )}
                    {res.power.heatW > 0 && (
                      <span
                        className="flex items-center gap-1 text-warning"
                        title="Heat-powered buildings (Py hard mode). Heat doesn't travel far (~15 tiles), so a heat source — e.g. a py-heat-exchanger — must be built LOCAL to this block."
                      >
                        <Flame className="size-3.5" /> {fmtW(res.power.heatW)}{" "}
                        <span className="text-muted-foreground">heat · local source needed</span>
                      </span>
                    )}
                  </div>
                )}
              <div
                className={`grid gap-4 p-3 ${res?.exports.length ? "grid-cols-2" : "grid-cols-1"}`}
              >
                <div>
                  <div className="mb-1 text-sm font-semibold text-warning">
                    Imports — bring these in{" "}
                    <span className="inline-flex items-center gap-0.5 font-normal text-muted-foreground">
                      (dashed <Plus className="inline size-3" /> = craftable in-block)
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-2">
                    {res?.imports.length ? (
                      res.imports.map((f) => (
                        <span key={f.name} className="group flex flex-col items-start gap-1.5">
                          <span className="inline-flex items-center gap-1.5">
                            <ItemChip
                              name={f.name}
                              kind={f.kind}
                              display={res.display?.[f.name]}
                              rate={f.rate}
                              link="import"
                              craftable={producible.has(f.name)}
                              fuel={fuelSet.has(f.name)}
                              disp={disp[f.name]}
                              onClick={() => makeFor(f.name)}
                              onCycleDisp={() => cycleDispFor(f.name)}
                              onClearDisp={() => setDispFor(f.name, "auto")}
                              onContext={(e) =>
                                setCtxMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  name: f.name,
                                  kind: f.kind,
                                  link: "import",
                                })
                              }
                            />
                            {/* Locked-as-block-driver state (set via right-click → "Size block by this
                                input"): edit its rate inline + an unlock control. The toggle itself
                                lives in the context menu, so non-locked rows stay uncluttered. */}
                            {lockedInput === f.name && (
                              <>
                                <Input
                                  type="number"
                                  value={lockedRate}
                                  step="0.01"
                                  min="0"
                                  autoFocus
                                  onChange={(e) => setLockedRate(Number(e.target.value) || 0)}
                                  title="locked rate — the block is sized to consume this much of this input"
                                  className="h-7 w-16 border-info/60 px-1"
                                />
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => setLockedInput(null)}
                                  title="unlock — the Goal rate is editable again"
                                  className="text-info"
                                >
                                  <Lock className="size-3.5" />
                                </Button>
                              </>
                            )}
                            {freed.has(f.name) && !disp[f.name] && (
                              <button
                                title="recycle loop won't self-close — auto-sourced here. Click to pin it as an import (resolves the relaxed solve)."
                                onClick={() => setDispFor(f.name, "import")}
                                className="bg-warning/25 px-1.5 py-0.5 text-sm text-warning hover:brightness-110"
                              >
                                loop · pin import
                              </button>
                            )}
                          </span>
                          {logiResolved && f.kind === "item" && (
                            <LogiTag
                              resolved={logiResolved}
                              rate={f.rate}
                              machineCount={0}
                              showBelts={showBelts}
                              showInserters={showInserters}
                              launch={launchInfo(f.name, f.rate)}
                            />
                          )}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        none — nothing to bring in
                      </span>
                    )}
                  </div>
                </div>
                {!!res?.exports.length && (
                  <div>
                    <div className="mb-1 text-sm font-semibold text-surplus">
                      Exports — surplus, nothing consumes these
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-2">
                      {res.exports.map((f) => (
                        <span key={f.name} className="flex flex-col items-start gap-1.5">
                          <span className="inline-flex items-center gap-1.5">
                            <ItemChip
                              name={f.name}
                              kind={f.kind}
                              display={res.display?.[f.name]}
                              rate={f.rate}
                              link="export"
                              fuel={fuelSet.has(f.name)}
                              disp={disp[f.name]}
                              onClick={() => useFor(f.name)}
                              onCycleDisp={() => cycleDispFor(f.name)}
                              onClearDisp={() => setDispFor(f.name, "auto")}
                              onContext={(e) =>
                                setCtxMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  name: f.name,
                                  kind: f.kind,
                                  link: "export",
                                })
                              }
                            />
                            {freed.has(f.name) && !disp[f.name] && (
                              <button
                                title="recycle loop won't self-close — auto-sunk here. Click to pin it as an export (resolves the relaxed solve)."
                                onClick={() => setDispFor(f.name, "export")}
                                className="bg-warning/25 px-1.5 py-0.5 text-sm text-warning hover:brightness-110"
                              >
                                loop · pin export
                              </button>
                            )}
                            {/* incidental-spoil risk (#20): a SURPLUS spoilable is the
                                one that actually sits around long enough to rot */}
                            {spoilables[f.name] != null && (
                              <button
                                title={`spoils in ${fmtSpoilTime(spoilables[f.name])} — surplus sits in storage, so it WILL rot unless something consumes it. Click to plan the loss so production covers it.`}
                                onClick={() => setSpoilDialog(f.name)}
                                className="flex items-center gap-1 bg-warning/15 px-1.5 py-0.5 text-sm text-warning hover:brightness-110"
                              >
                                <Timer className="size-3.5" /> rots in{" "}
                                {fmtSpoilTime(spoilables[f.name])}
                              </button>
                            )}
                          </span>
                          {logiResolved && f.kind === "item" && (
                            <LogiTag
                              resolved={logiResolved}
                              rate={f.rate}
                              machineCount={0}
                              showBelts={showBelts}
                              showInserters={showInserters}
                              launch={launchInfo(f.name, f.rate)}
                            />
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      <BlockTasks blockId={blockId} />

      {/* Recipe grid: each row's I/O at the solved rate. Click any item to add a
          recipe that makes it (ingredient) or consumes it (product). */}
      <Card>
        <div className={HEAD}>
          <span>Recipe ({recipes.length})</span>
          <span>Machines</span>
          <span>Ingredients ↓ (click to add a producer)</span>
          <span>Products ↑ (click to add a consumer)</span>
        </div>
        {recipes.length === 0 && (
          <div className="px-3 py-2 text-muted-foreground">
            none — pick a recipe for the goal above
          </div>
        )}
        <DndContext
          sensors={recipeSensors}
          collisionDetection={closestCenter}
          onDragEnd={onRecipeDragEnd}
        >
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            {rowSeq.map((entry) => {
              if (entry.type === "group") return renderGroupHeader(entry.group);
              const name = entry.name;
              const grouped = recipeGroups[name] != null; // member of a sub-block (#7)
              const off = disabled.has(name); // toggled out of the solve (#73)
              const row = res?.rows?.find((r) => r.recipe === name);
              const neg = (row?.rate ?? 0) < -1e-6; // running backward — can't physically happen
              const isUnused = !off && unused.has(name); // pinned to 0 — nothing in the block needs it
              // a recipe that no longer exists in the data: show it as a labelled
              // placeholder row (preserved, not silently dropped) rather than solving.
              const missingRecipe = res?.missing?.recipes.includes(name) ?? false;
              if (missingRecipe) {
                return (
                  <SortableRow key={name} id={name}>
                    {() => (
                      <div className={`${GRID} border-t border-border bg-destructive/10`}>
                        <div className="flex min-w-0 items-center gap-2">
                          <Icon kind="recipe" name={name} size="md" noTitle />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono" title={name}>
                              {name}
                            </span>
                            <span className="flex items-center gap-1 text-sm font-semibold text-destructive">
                              <AlertTriangle className="size-3" /> no longer exists
                            </span>
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => drop(name)}
                            title="remove this missing recipe from the block"
                          >
                            <X className="size-3.5" />
                          </Button>
                        </div>
                        <div className="col-span-3 text-sm text-muted-foreground">
                          this recipe isn&apos;t in the current data — re-enable its mod or
                          re-import to restore it, or remove it
                        </div>
                      </div>
                    )}
                  </SortableRow>
                );
              }
              return (
                <SortableRow key={name} id={name}>
                  {({ setActivatorNodeRef, listeners, attributes, isDragging }) => (
                    <div
                      className={`${GRID} relative border-t border-border ${grouped ? "border-l-2 border-l-primary/50" : ""} ${neg || isUnused ? "bg-destructive/10" : ""} ${off ? "bg-muted/30" : ""} ${isDragging ? "bg-card shadow-lg" : ""}`}
                    >
                      <RecipeHover name={name} className="flex min-w-0 items-center gap-2">
                        <span
                          ref={setActivatorNodeRef}
                          {...attributes}
                          {...listeners}
                          title="drag to reorder this recipe"
                          className="flex shrink-0 cursor-grab touch-none items-center text-muted-foreground select-none hover:text-foreground active:cursor-grabbing"
                        >
                          <GripVertical className="size-4" />
                        </span>
                        <span className={off ? "opacity-40" : undefined}>
                          <Icon kind="recipe" name={name} size="md" noHover />
                        </span>
                        <span
                          className={`min-w-0 flex-1 ${off ? "opacity-60" : ""}`}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setRowMenu({ x: e.clientX, y: e.clientY, name });
                          }}
                        >
                          <span
                            className={`block truncate ${off ? "line-through" : ""}`}
                            title={res?.display?.[name] ?? name}
                          >
                            {res?.display?.[name] ?? name}
                          </span>
                          {off ? (
                            <span className="text-sm font-semibold text-muted-foreground">
                              disabled — excluded from the solve
                            </span>
                          ) : isUnused ? (
                            <span className="flex items-center gap-1 text-sm font-semibold text-destructive">
                              <AlertTriangle className="size-3 shrink-0" /> not made — nothing here
                              needs it
                            </span>
                          ) : row ? (
                            <span
                              className={`text-sm ${neg ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                            >
                              {neg && (
                                <AlertTriangle className="mr-0.5 inline size-3 align-text-bottom" />
                              )}
                              {neg && "backward "}
                              {num(row.rate)}/s
                            </span>
                          ) : null}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className={off ? "text-muted-foreground/60" : "text-muted-foreground"}
                          onClick={() => toggleDisabled(name)}
                          title={
                            off
                              ? "enable — include this recipe in the solve"
                              : "disable — keep the recipe but exclude it from the solve"
                          }
                        >
                          <Power className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size={confirmRemove === name ? "xs" : "icon-xs"}
                          className={`shrink-0 hover:text-destructive ${confirmRemove === name ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                          onClick={() => requestRemove(name)}
                          title={confirmRemove === name ? "click again to remove" : "remove"}
                        >
                          {confirmRemove === name ? (
                            <span className="whitespace-nowrap">remove?</span>
                          ) : (
                            <X className="size-3.5" />
                          )}
                        </Button>
                      </RecipeHover>
                      <div className="flex flex-wrap items-center gap-2">
                        <FieldLabel className="w-full md:hidden">Machines</FieldLabel>
                        {row?.machine ? (
                          <>
                            {/* building: icon + count; hover = name/speed, click = picker */}
                            <button
                              onClick={() => setPickMachineFor(name)}
                              title={`${row.machine.display ?? row.machine.name} · ${num(row.machine.craftingSpeed ?? 1)}× speed · click to change building`}
                              className={cellChip}
                            >
                              <Icon kind="entity" name={row.machine.name} size="md" />
                              <span className="font-semibold text-foreground">
                                {num(row.machine.count)}
                              </span>
                            </button>
                            {/* electricity, when the machine draws power */}
                            {row.machine.energySource === "electric" && (
                              <span
                                title="electric power draw"
                                className="flex items-center gap-1 bg-muted/50 px-1.5 py-1 text-sm text-info"
                              >
                                <Zap className="size-3.5" /> {fmtW(row.machine.powerW)}
                              </span>
                            )}
                            {row.machine.energySource === "heat" && (
                              <span
                                title="heat-powered — fed by an upstream reactor"
                                className="flex items-center gap-1 bg-muted/50 px-1.5 py-1 text-sm"
                              >
                                <Flame className="size-3.5" /> heat
                              </span>
                            )}
                            {/* fuel: icon + rate; click = fuel picker */}
                            {row.fuel && (
                              <button
                                onClick={() => setPickFuelFor(name)}
                                title={`${row.fuel.display ?? row.fuel.name} · ${num(row.fuel.perSec)}/s · click to change fuel`}
                                className={`${cellChip} text-warning`}
                              >
                                <Icon
                                  kind={row.fuel.kind as "item" | "fluid"}
                                  name={row.fuel.name}
                                  size="md"
                                  noTitle
                                />
                                <span className="font-semibold">{num(row.fuel.perSec)}</span>
                              </button>
                            )}
                            {/* burnt result (ash, depleted cell): produced 1:1 from burning */}
                            {row.fuel?.burnt && (
                              <span
                                title={`${row.fuel.burnt.display ?? row.fuel.burnt.name} — produced by burning`}
                                className="flex items-center gap-1 bg-muted/50 px-1.5 py-1 text-sm text-muted-foreground"
                              >
                                →<Icon kind="item" name={row.fuel.burnt.name} size="md" noTitle />
                                <span>{num(row.fuel.burnt.perSec)}</span>
                              </span>
                            )}
                            {/* modules + beacons: configured loadout (or ghost ⊞), click to edit */}
                            <ModulesChip
                              modules={row.modules}
                              beacons={row.beacons}
                              slots={row.machine.moduleSlots ?? 0}
                              effects={row.effects}
                              auto={row.autoModules}
                              onClick={() => setPickModulesFor(name)}
                            />
                            {/* TURD: hidden modules the selected upgrades insert (no slot cost) */}
                            {row.turdModules.length > 0 && (
                              <Link
                                to="/turd"
                                title={`TURD: ${row.turdModules.map((m) => m.display ?? m.name).join(", ")} — applied by your selected upgrades`}
                                className="flex items-center gap-1 bg-primary/15 px-1.5 py-1 text-sm text-primary ring-1 ring-primary/40 hover:brightness-110"
                              >
                                <FlaskConical className="size-3.5" />
                                {row.turdModules.map((m) => (
                                  <Icon key={m.name} kind="item" name={m.name} size="sm" noTitle />
                                ))}
                              </Link>
                            )}
                          </>
                        ) : row?.spoil ? (
                          // Spoil-buffer sizing (#19): no machine — the "cost" of a
                          // spoiling step is the storage holding items mid-spoil.
                          <span
                            title={`spoils in ${fmtSpoilTime(row.spoil.seconds * 60)} — at ${num(row.rate)}/s, ≈${num(row.spoil.buffer)} items sit in storage mid-spoil${row.spoil.stacks != null ? ` (≈${Math.ceil(row.spoil.stacks)} stacks @ ${row.spoil.stackSize}/stack)` : ""}`}
                            className="flex items-center gap-1.5 bg-muted/50 px-1.5 py-1 text-sm text-warning"
                          >
                            <Timer className="size-3.5 shrink-0" />
                            {fmtSpoilTime(row.spoil.seconds * 60)} · buffer{" "}
                            {num(Math.ceil(row.spoil.buffer))}
                            {row.spoil.stacks != null && (
                              <span className="text-muted-foreground">
                                ≈ {num(Math.ceil(row.spoil.stacks))} stack
                                {Math.ceil(row.spoil.stacks) === 1 ? "" : "s"}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-3">
                        <FieldLabel className="w-full md:hidden">Ingredients ↓</FieldLabel>
                        {row?.ingredients.map((c) => (
                          <div key={c.name} className="flex flex-col items-start gap-1.5">
                            <ItemChip
                              name={c.name}
                              kind={c.kind}
                              display={c.display}
                              rate={c.rate}
                              link={linkOf(c.name)}
                              craftable={producible.has(c.name)}
                              disp={disp[c.name]}
                              onClick={() => makeFor(c.name)}
                              onCycleDisp={() => cycleDispFor(c.name)}
                              onClearDisp={() => setDispFor(c.name, "auto")}
                              onContext={(e) =>
                                setCtxMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  name: c.name,
                                  kind: c.kind,
                                  link: linkOf(c.name),
                                })
                              }
                            />
                            {logiResolved && c.kind === "item" && (
                              <LogiTag
                                resolved={logiResolved}
                                rate={c.rate}
                                machineCount={row.machine?.count ?? 0}
                                showBelts={showBelts}
                                showInserters={showInserters}
                                launch={launchInfo(c.name, c.rate)}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-3">
                        <FieldLabel className="w-full md:hidden">Products ↑</FieldLabel>
                        {row?.products.map((c) => (
                          <div key={c.name} className="flex flex-col items-start gap-1.5">
                            <ItemChip
                              name={c.name}
                              kind={c.kind}
                              display={c.display}
                              rate={c.rate}
                              link={linkOf(c.name)}
                              disp={disp[c.name]}
                              onClick={() => useFor(c.name)}
                              onCycleDisp={() => cycleDispFor(c.name)}
                              onClearDisp={() => setDispFor(c.name, "auto")}
                              onContext={(e) =>
                                setCtxMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  name: c.name,
                                  kind: c.kind,
                                  link: linkOf(c.name),
                                })
                              }
                            />
                            {logiResolved && c.kind === "item" && (
                              <LogiTag
                                resolved={logiResolved}
                                rate={c.rate}
                                machineCount={row.machine?.count ?? 0}
                                showBelts={showBelts}
                                showInserters={showInserters}
                                launch={launchInfo(c.name, c.rate)}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </SortableRow>
              );
            })}
          </SortableContext>
        </DndContext>
      </Card>

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
      {rowMenu && (
        <RowMenu
          x={rowMenu.x}
          y={rowMenu.y}
          recipe={rowMenu.name}
          display={res?.display?.[rowMenu.name] ?? rowMenu.name}
          groups={rowGroups}
          currentGroup={rowGroups.find((g) => g.id === recipeGroups[rowMenu.name]) ?? null}
          onNewGroup={() => createGroupFromRow(rowMenu.name)}
          onJoinGroup={(gid) => doc.joinRecipeToGroup(rowMenu.name, gid)}
          onLeaveGroup={() => removeFromGroup(rowMenu.name)}
          onClose={() => setRowMenu(null)}
        />
      )}

      {/* Recipe picker — floats over everything, dismissable */}
      {pickFor && !picker.isLoading && !autoAddRecipe && (
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
          recipeDisplay={res?.display?.[pickMachineFor] ?? pickMachineFor}
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
              recipeDisplay={res?.display?.[pickModulesFor] ?? pickModulesFor}
              machineName={mr.machine.name}
              modules={moduleSel[pickModulesFor] ?? (mr.autoModules ? mr.modules : [])}
              beacons={beaconSel[pickModulesFor] ?? []}
              effects={mr.effects}
              auto={mr.autoModules && moduleSel[pickModulesFor] === undefined}
              onChange={(mods, bcns) => doc.setModules(pickModulesFor, mods, bcns)}
              onReset={() => doc.resetModules(pickModulesFor)}
              onClose={() => setPickModulesFor(null)}
            />
          );
        })()}

      {/* Fuel picker — choose what a burner burns */}
      {pickFuelFor &&
        (() => {
          const fr = res?.rows?.find((r) => r.recipe === pickFuelFor);
          return (
            <FuelPickerDialog
              recipeDisplay={res?.display?.[pickFuelFor] ?? pickFuelFor}
              fuels={fr?.availableFuels ?? []}
              current={fr?.fuel?.chosen ?? null}
              onPick={(f) => {
                pickFuel(pickFuelFor, f);
                setPickFuelFor(null);
              }}
              onClose={() => setPickFuelFor(null)}
            />
          );
        })()}

      {/* Planned-spoil-rate dialog (#20) */}
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
          currentDisp={disp[ctxMenu.name] ?? "auto"}
          spoilRate={spoilRates[ctxMenu.name] ?? null}
          onAddGoal={() => addGoal(ctxMenu.name)}
          onLock={(r) => {
            setLockedInput(ctxMenu.name);
            setLockedRate(r);
          }}
          onUnlock={() => setLockedInput(null)}
          onCreateSupplier={(r) => void createSupplier(ctxMenu.name, r)}
          onSetDisp={(d) => setDispFor(ctxMenu.name, d)}
          onEditSpoil={() => setSpoilDialog(ctxMenu.name)}
          onClearSpoil={() => setSpoilRateFor(ctxMenu.name, null)}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
