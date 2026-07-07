import { useState } from "react";
import { useStore } from "@tanstack/react-store";
import {
  ArrowRight,
  Boxes,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Layers,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { groupMembers, groupNet, type RowGroup } from "../../lib/row-groups";
import { Icon } from "../../lib/icons";
import { SortableRow } from "./sortable-row.tsx";
import { GroupComposeDialog, type GoalCandidate } from "./group-compose-dialog.tsx";
import type { BlockDocStore } from "./doc-store.ts";
import type { SolveResult } from "./solve-view.ts";
import { fmtW, num, rateLabel } from "./format.ts";

/** A sub-block's header row: fold chevron, rename-in-place name, and the chain's
 * net I/O ("ore in → plates out"), machines and power. A group can be a display
 * fold (#7) or PROMOTED to a real, separately-solved module (#76, `composed`) —
 * the same net I/O then reads as the module's boundary contract, and its internal
 * goals (hidden from the factory) are edited from here. */
export function GroupHeaderRow({
  doc,
  group: g,
  resRows,
  sub,
  display,
  folded,
  renaming,
  onToggleFold,
  onRenamingChange,
}: {
  doc: BlockDocStore;
  group: RowGroup;
  resRows: SolveResult["rows"] | undefined;
  /** this group's composed-module summary (#76), when solved as one */
  sub: NonNullable<SolveResult["subBlocks"]>[number] | undefined;
  /** localized good names, for the internal-goal picker */
  display: SolveResult["display"] | undefined;
  folded: boolean;
  /** rename-in-place is active on this header */
  renaming: boolean;
  onToggleFold: () => void;
  onRenamingChange: (renaming: boolean) => void;
}) {
  const recipes = useStore(doc.store, (s) => s.recipes);
  const recipeGroups = useStore(doc.store, (s) => s.recipeGroups);
  const disabled = useStore(doc.store, (s) => s.disabled);
  const [editingGoals, setEditingGoals] = useState(false);
  const members = groupMembers(recipes, recipeGroups, g.id);
  const composed = !!g.composed;
  // disabled rows (#73) contribute nothing to the solve, so keep them out of the
  // net too — the header should read what the chain actually does. Computed
  // whenever rows exist (not just when folded), so the compose picker can offer
  // the module's outputs even while expanded.
  const liveMembers = new Set(members.filter((m) => !disabled.has(m)));
  const netFlows = resRows ? groupNet(resRows, liveMembers) : null;
  const net = folded ? netFlows : null;
  // candidate internal goals = the module's net outputs (bare goods that leave
  // the chain), labelled from the display map.
  const candidates: GoalCandidate[] = (netFlows?.outputs ?? []).map((o) => ({
    name: o.name,
    kind: o.kind === "fluid" ? "fluid" : "item",
    display: display?.[o.name] ?? o.name,
  }));
  const badStatus = composed && sub && sub.status !== "solved";
  return (
    <>
      <SortableRow key={`grp:${g.id}`} id={`grp:${g.id}`}>
        {({ setActivatorNodeRef, listeners, attributes, isDragging }) => (
          <div
            className={`relative flex flex-wrap items-center gap-2 border-t border-border border-l-2 bg-muted/40 px-2 py-2 ${composed ? "border-l-primary" : "border-l-primary/50"} ${isDragging ? "bg-card shadow-lg" : ""}`}
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
            {composed ? (
              <Boxes className="size-4 shrink-0 text-primary" />
            ) : (
              <Layers className="size-4 shrink-0 text-primary/70" />
            )}
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
            {composed && (
              <Badge variant="secondary" className="shrink-0 gap-1">
                <Boxes className="size-3" />
                module
              </Badge>
            )}
            {badStatus && (
              <Tooltip content={sub?.message}>
                <Badge variant="destructive" className="shrink-0">
                  {sub?.status}
                </Badge>
              </Tooltip>
            )}
            {net && (
              <span className="flex flex-wrap items-center gap-1.5 text-sm">
                {net.inputs.map((f) => (
                  <span key={f.name} className="flex items-center gap-1 bg-muted/50 px-1.5 py-0.5">
                    <Icon kind={f.kind as "item" | "fluid"} name={f.name} size="sm" />
                    <span className="tabular-nums">{rateLabel(f.name, f.rate)}</span>
                  </span>
                ))}
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                {net.outputs.map((f) => (
                  <span key={f.name} className="flex items-center gap-1 bg-muted/50 px-1.5 py-0.5">
                    <Icon kind={f.kind as "item" | "fluid"} name={f.name} size="sm" />
                    <span className="tabular-nums">{rateLabel(f.name, f.rate)}</span>
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
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {composed && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setEditingGoals(true)}
                  title="edit this module's internal goals"
                >
                  <SlidersHorizontal className="size-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                className={
                  composed
                    ? "text-primary hover:text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }
                onClick={() =>
                  composed
                    ? doc.uncomposeGroup(g.id)
                    : doc.composeGroup(
                        g.id,
                        (netFlows?.outputs ?? []).map((o) => ({ name: o.name, rate: o.rate })),
                      )
                }
                title={
                  composed
                    ? "revert to a display-only sub-block"
                    : "compose — solve this sub-block as a real module"
                }
              >
                <Boxes className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => doc.ungroupRows(g.id)}
                title="ungroup — dissolve the sub-block, its rows stay"
              >
                <X className="size-3.5" />
              </Button>
            </span>
          </div>
        )}
      </SortableRow>
      {editingGoals && (
        <GroupComposeDialog
          name={g.name}
          candidates={candidates}
          current={g.goals ?? []}
          onSave={(goals) => {
            doc.setGroupGoals(g.id, goals);
            setEditingGoals(false);
          }}
          onClose={() => setEditingGoals(false)}
        />
      )}
    </>
  );
}
