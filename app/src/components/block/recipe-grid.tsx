import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useStore } from "@tanstack/react-store";
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
import { Card } from "#/components/ui/card.tsx";
import { InfoHint } from "#/components/info-hint.tsx";
import { moveGroupSpan, resolveGroupAfterMove, type RowGroup } from "../../lib/row-groups";
import type { BlockDocStore } from "./doc-store.ts";
import type { LogiView, SolveResult } from "./solve-view.ts";
import { GroupHeaderRow } from "./group-header-row.tsx";
import { MissingRecipeRow } from "./missing-recipe-row.tsx";
import { RecipeRow, type RowOverlayOpeners } from "./recipe-row.tsx";
import type { Link as ItemLink } from "./item-chip.tsx";
import { head } from "./styles.ts";

// Recipe-grid layout. Desktop (md+): a 4-column grid — recipe | machines |
// ingredients | products. Mobile: the columns can't fit (the first two alone need
// 410px), so each row stacks vertically with per-section labels and the column
// header is hidden.
const TPL = "md:[grid-template-columns:minmax(200px,1.6fr)_minmax(240px,1fr)_1.3fr_1.3fr]";
const GRID = `flex flex-col gap-2.5 px-3 py-3 md:grid md:items-center md:gap-4 md:py-3.5 ${TPL}`;
const HEAD = `${head} hidden md:grid md:items-center md:gap-4 ${TPL}`;
// Large blocks (#154): the rows mount once the grid comes within this distance of
// the block's scroll viewport. Until then a spacer stands in at about the rows'
// median height (stacked on mobile, one line per row on md+).
const MOUNT_PX = 1000;
const SPACER = "h-[calc(var(--rows)*470px)] md:h-[calc(var(--rows)*190px)]";
// Rows skip off-screen rendering (see recipe-row.tsx), so a row that hasn't
// rendered yet has only a placeholder height. While a focus request scrolls to a
// row, lay every row out for real so the scroll lands on the target.
const FOCUSING = "[&_[data-recipe-row]]:[content-visibility:visible]";
// Stable sensor options: new objects each render would hand dnd-kit new
// activators, which re-renders every sortable row.
const POINTER = { activationConstraint: { distance: 6 } };
const KEYBOARD = { coordinateGetter: sortableKeyboardCoordinates };
const NO_SPOILAGE: SolveResult["incidentalSpoilage"] = [];

/** The recipe grid: each row's I/O at the solved rate, with drag-reorder,
 * sub-block headers (#7), disable toggles (#73) and click-to-confirm removal.
 * Owns the view-only state: fold state (localStorage), rename-in-place, and the
 * armed remove confirmation. */
export function RecipeGrid({
  doc,
  blockId,
  res,
  linkOf,
  producible,
  logi,
  open,
  renamingGroup,
  onRenamingGroupChange,
  focusRecipe,
}: {
  doc: BlockDocStore;
  blockId: number;
  res: SolveResult | undefined;
  /** recipes pinned to 0 — nothing in the block needs them */
  linkOf: (name: string) => ItemLink;
  producible: ReadonlySet<string>;
  logi: LogiView;
  open: RowOverlayOpeners;
  /** group id being renamed in place — owned by the editor, since "new sub-block
   * from this row" (in the row context menu) starts a rename on creation */
  renamingGroup: number | null;
  onRenamingGroupChange: (id: number | null) => void;
  /** recipe row to ring + scroll to, set when a flow-view node is clicked (#101) */
  focusRecipe?: string | null;
}) {
  const recipes = useStore(doc.store, (s) => s.recipes);
  const rowGroups = useStore(doc.store, (s) => s.rowGroups);
  const recipeGroups = useStore(doc.store, (s) => s.recipeGroups);
  const disabled = useStore(doc.store, (s) => s.disabled);
  const solveFailed = res?.status === "infeasible" || res?.status === "error";

  // Mount the rows lazily: a big block's goals can push the grid thousands of
  // pixels down, and mounting ~60 rows up front dominates opening the block. Once
  // mounted the rows stay mounted (the editor remounts per block), and a focus
  // request mounts them at once so the target row can scroll into view.
  const [nearView, setNearView] = useState(false);
  const mounted = nearView || !!focusRecipe;
  const spacerRef = useRef<HTMLDivElement>(null);
  const hasRecipes = recipes.length > 0; // the spacer only renders with rows to stand in for
  useLayoutEffect(() => {
    if (nearView) return;
    const el = spacerRef.current;
    if (focusRecipe || !el) {
      if (focusRecipe) setNearView(true);
      return;
    }
    const root = el.closest<HTMLElement>("[data-block-scroll]");
    // Already near the viewport (e.g. a small block): mount before the first
    // paint rather than flashing the spacer for a frame.
    const bottom = root ? root.getBoundingClientRect().bottom : window.innerHeight;
    if (el.getBoundingClientRect().top < bottom + MOUNT_PX) {
      setNearView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        // a transition renders the rows in slices, so the scroll that brings
        // the grid near doesn't stall on mounting all of them at once
        if (entries.some((e) => e.isIntersecting)) startTransition(() => setNearView(true));
      },
      { root, rootMargin: `${MOUNT_PX}px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nearView, focusRecipe, hasRecipes]);

  // Sub-block fold state is a view preference — localStorage, not the doc, so
  // folding doesn't churn auto-save.
  const [foldedGroups, setFoldedGroups] = useState<Record<number, boolean>>({});
  useEffect(() => {
    try {
      const f = JSON.parse(localStorage.getItem(`pyops.groupFold.${blockId}`) || "{}");
      if (f && typeof f === "object") setFoldedGroups(f);
    } catch {
      /* ignore */
    }
  }, [blockId]);
  const toggleFold = (id: number) =>
    setFoldedGroups((f) => {
      const next = { ...f, [id]: !f[id] };
      localStorage.setItem(`pyops.groupFold.${blockId}`, JSON.stringify(next));
      return next;
    });
  // Recipe removal is a click-to-confirm: the first click on × arms the row (× →
  // "remove?"), the second removes it (in the row). Removing loses the row's
  // machine/fuel/module picks, so a lone misclick shouldn't destroy it.
  // Auto-disarms after a few seconds.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armRemove = useCallback((name: string | null) => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    setConfirmRemove(name);
    if (name) removeTimer.current = setTimeout(() => setConfirmRemove(null), 3000);
  }, []);
  useEffect(() => () => void (removeTimer.current && clearTimeout(removeTimer.current)), []);

  // Bring a focused row (#101) to the middle of the viewport. Rows can still
  // grow after the table remounts, which leaves a smooth scroll short of its
  // target (#276), so aim again whenever the grid resizes during the focus.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const card = cardRef.current;
    const row =
      focusRecipe && card?.querySelector(`[data-recipe-row="${CSS.escape(focusRecipe)}"]`);
    if (!card || !row) return;
    const aim = () => row.scrollIntoView({ block: "center", behavior: "smooth" });
    aim();
    const ro = new ResizeObserver(aim);
    ro.observe(card);
    return () => ro.disconnect();
  }, [focusRecipe]);

  // Drag-reorder of recipe rows via dnd-kit. PointerSensor covers mouse + touch; the
  // small activation distance keeps a tap/click on the grip from registering as a drag.
  const recipeSensors = useSensors(
    useSensor(PointerSensor, POINTER),
    useSensor(KeyboardSensor, KEYBOARD),
  );
  // Reorder is display/authoring only — the solver is order-independent. Sub-blocks
  // (#7) make it three cases: drag a group header to move the whole span; drop a row
  // on a header or member to join that group; drop a row between two members to adopt
  // their group. Accepting a member as the target is important for one-row groups: their
  // narrow header otherwise loses closest-center collision detection to the larger row.
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
    const targetGroup = recipeGroups[oid];
    if (targetGroup != null && recipeGroups[aid] !== targetGroup) {
      doc.joinRecipeToGroup(aid, targetGroup);
      return;
    }
    const from = recipes.indexOf(aid);
    const to = recipes.indexOf(oid);
    if (from < 0 || to < 0) return;
    const moved = arrayMove(recipes, from, to);
    doc.applyReorder(moved, resolveGroupAfterMove(moved, recipeGroups, aid));
  };

  // Sub-blocks (#7): flatten recipes+groups into the render sequence. A group
  // renders a header at its first member's position; members follow (contiguous
  // by invariant) unless the group is folded, in which case they're skipped and
  // the header shows the chain's net flows instead. Empty until the rows mount.
  // Memoized: a new `sortableIds` array re-renders every sortable row.
  const rowSeq = useMemo(() => {
    const seq: ({ type: "group"; group: RowGroup } | { type: "recipe"; name: string })[] = [];
    if (!mounted) return seq;
    const byId = new Map(rowGroups.map((g) => [g.id, g]));
    const seen = new Set<number>();
    for (const name of recipes) {
      const g = recipeGroups[name] != null ? byId.get(recipeGroups[name]) : undefined;
      if (g) {
        if (!seen.has(g.id)) {
          seen.add(g.id);
          seq.push({ type: "group", group: g });
        }
        if (!foldedGroups[g.id]) seq.push({ type: "recipe", name });
      } else seq.push({ type: "recipe", name });
    }
    return seq;
  }, [mounted, recipes, rowGroups, recipeGroups, foldedGroups]);
  const sortableIds = useMemo(
    () => rowSeq.map((e) => (e.type === "group" ? `grp:${e.group.id}` : e.name)),
    [rowSeq],
  );

  return (
    <Card ref={cardRef} className={focusRecipe ? FOCUSING : undefined}>
      <div className={HEAD}>
        <span>Recipe ({recipes.length})</span>
        <span>Machines</span>
        <span className="flex items-center gap-1.5">
          Ingredients ↓<InfoHint content="Click an ingredient to add a producer" />
        </span>
        <span className="flex items-center gap-1.5">
          Products ↑<InfoHint content="Click a product to add a consumer" />
        </span>
      </div>
      {recipes.length === 0 && (
        <div className="px-3 py-2 text-muted-foreground">
          None — pick a recipe for the goal above
        </div>
      )}
      {!mounted && hasRecipes && (
        <div
          ref={spacerRef}
          className={SPACER}
          style={{ "--rows": recipes.length } as CSSProperties}
        />
      )}
      <DndContext
        sensors={recipeSensors}
        collisionDetection={closestCenter}
        onDragEnd={onRecipeDragEnd}
      >
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {rowSeq.map((entry) => {
            if (entry.type === "group")
              return (
                <GroupHeaderRow
                  key={`grp:${entry.group.id}`}
                  doc={doc}
                  group={entry.group}
                  resRows={res?.rows}
                  sub={res?.subBlocks?.find((s) => s.id === entry.group.id)}
                  display={res?.display}
                  folded={!!foldedGroups[entry.group.id]}
                  renaming={renamingGroup === entry.group.id}
                  onToggleFold={() => toggleFold(entry.group.id)}
                  onRenamingChange={(r) => onRenamingGroupChange(r ? entry.group.id : null)}
                />
              );
            const name = entry.name;
            if (res?.missing?.recipes.includes(name))
              return (
                <MissingRecipeRow
                  key={name}
                  name={name}
                  gridClass={GRID}
                  onDrop={() => doc.dropRecipe(name)}
                />
              );
            const off = disabled.has(name);
            return (
              <RecipeRow
                key={name}
                doc={doc}
                name={name}
                row={res?.rows?.find((r) => r.recipe === name)}
                display={res?.recipeDisplay?.[name] ?? name}
                differs={res?.recipeDiffers?.[name]}
                grouped={recipeGroups[name] != null}
                off={off}
                error={solveFailed && !off}
                gridClass={GRID}
                confirmRemove={confirmRemove === name}
                onArmRemove={armRemove}
                linkOf={linkOf}
                producible={producible}
                logi={logi}
                open={open}
                moduleHints={!!res?.moduleHints}
                incidentalSpoilage={res?.incidentalSpoilage ?? NO_SPOILAGE}
                goodDisplay={res?.display}
                recipeDisplay={res?.recipeDisplay}
                highlight={focusRecipe === name}
                tempWarnings={res?.tempWarnings}
              />
            );
          })}
        </SortableContext>
      </DndContext>
    </Card>
  );
}
