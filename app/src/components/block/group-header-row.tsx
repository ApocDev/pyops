import { useStore } from "@tanstack/react-store";
import { ArrowRight, ChevronDown, ChevronRight, GripVertical, Layers, X } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { groupMembers, groupNet, type RowGroup } from "../../lib/row-groups";
import { Icon } from "../../lib/icons";
import { SortableRow } from "./sortable-row.tsx";
import type { BlockDocStore } from "./doc-store.ts";
import type { SolveResult } from "./solve-view.ts";
import { fmtW, num } from "./format.ts";

/** A sub-block's header row (#7): fold chevron, rename-in-place name, and — when
 * folded — the chain's net I/O ("ore in → plates out"), machines and power. */
export function GroupHeaderRow({
  doc,
  group: g,
  resRows,
  folded,
  renaming,
  onToggleFold,
  onRenamingChange,
}: {
  doc: BlockDocStore;
  group: RowGroup;
  resRows: SolveResult["rows"] | undefined;
  folded: boolean;
  /** rename-in-place is active on this header */
  renaming: boolean;
  onToggleFold: () => void;
  onRenamingChange: (renaming: boolean) => void;
}) {
  const recipes = useStore(doc.store, (s) => s.recipes);
  const recipeGroups = useStore(doc.store, (s) => s.recipeGroups);
  const disabled = useStore(doc.store, (s) => s.disabled);
  const members = groupMembers(recipes, recipeGroups, g.id);
  // disabled rows (#73) contribute nothing to the solve, so keep them out of
  // the net too — the header should read what the chain actually does
  const net =
    folded && resRows ? groupNet(resRows, new Set(members.filter((m) => !disabled.has(m)))) : null;
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
            onClick={onToggleFold}
            title={folded ? "expand this sub-block" : "collapse this sub-block to one line"}
            className="text-muted-foreground"
          >
            {folded ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
          <Layers className="size-4 shrink-0 text-primary/70" />
          {renaming ? (
            <Input
              autoFocus
              defaultValue={g.name}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => {
                doc.renameGroup(g.id, e.target.value.trim() || g.name);
                onRenamingChange(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") onRenamingChange(false);
              }}
              className="h-7 w-44 px-1.5"
            />
          ) : (
            <span
              className="cursor-default font-semibold select-none"
              onDoubleClick={() => onRenamingChange(true)}
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
            onClick={() => doc.ungroupRows(g.id)}
            title="ungroup — dissolve the sub-block, its rows stay"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      )}
    </SortableRow>
  );
}
