import { useEffect, useRef, useState } from "react";
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
const TPL = "md:[grid-template-columns:minmax(170px,1.1fr)_minmax(240px,1.2fr)_1.4fr_1.4fr]";
const GRID = `flex flex-col gap-2.5 px-3 py-3 md:grid md:items-center md:gap-4 md:py-3.5 ${TPL}`;
const HEAD = `${head} hidden md:grid md:items-center md:gap-4 ${TPL}`;

/** The recipe grid: each row's I/O at the solved rate, with drag-reorder,
 * sub-block headers (#7), disable toggles (#73) and click-to-confirm removal.
 * Owns the view-only state: fold state (localStorage), rename-in-place, and the
 * armed remove confirmation. */
export function RecipeGrid({
  doc,
  blockId,
  res,
  unused,
  linkOf,
  producible,
  logi,
  open,
  renamingGroup,
  onRenamingGroupChange,
}: {
  doc: BlockDocStore;
  blockId: number;
  res: SolveResult | undefined;
  /** recipes pinned to 0 — nothing in the block needs them */
  unused: ReadonlySet<string>;
  linkOf: (name: string) => ItemLink;
  producible: ReadonlySet<string>;
  logi: LogiView;
  open: RowOverlayOpeners;
  /** group id being renamed in place — owned by the editor, since "new sub-block
   * from this row" (in the row context menu) starts a rename on creation */
  renamingGroup: number | null;
  onRenamingGroupChange: (id: number | null) => void;
}) {
  const recipes = useStore(doc.store, (s) => s.recipes);
  const rowGroups = useStore(doc.store, (s) => s.rowGroups);
  const recipeGroups = useStore(doc.store, (s) => s.recipeGroups);
  const disabled = useStore(doc.store, (s) => s.disabled);

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
  // "remove?"), the second removes it. Removing loses the row's machine/fuel/module
  // picks, so a lone misclick shouldn't destroy it. Auto-disarms after a few seconds.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRemove = (name: string) => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (confirmRemove === name) {
      setConfirmRemove(null);
      doc.dropRecipe(name);
      // label the save for the undo stack (#90) — display name when solved
      doc.note(`Remove recipe "${res?.display?.[name] ?? name}"`);
      return;
    }
    setConfirmRemove(name);
    removeTimer.current = setTimeout(() => setConfirmRemove(null), 3000);
  };
  useEffect(() => () => void (removeTimer.current && clearTimeout(removeTimer.current)), []);

  // Drag-reorder of recipe rows via dnd-kit. PointerSensor covers mouse + touch; the
  // small activation distance keeps a tap/click on the grip from registering as a drag.
  const recipeSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Reorder is display/authoring only — the solver is order-independent. Sub-blocks
  // (#7) make it three cases: drag a group header to move the whole span; drop a row
  // on a header to join that group; drop a row between two members to adopt their group.
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

  return (
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
            if (entry.type === "group")
              return (
                <GroupHeaderRow
                  key={`grp:${entry.group.id}`}
                  doc={doc}
                  group={entry.group}
                  resRows={res?.rows}
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
                display={res?.display?.[name] ?? name}
                grouped={recipeGroups[name] != null}
                off={off}
                isUnused={!off && unused.has(name)}
                gridClass={GRID}
                confirmRemove={confirmRemove === name}
                onRequestRemove={() => requestRemove(name)}
                linkOf={linkOf}
                producible={producible}
                logi={logi}
                open={open}
              />
            );
          })}
        </SortableContext>
      </DndContext>
    </Card>
  );
}
