import { Layers, X } from "lucide-react";
import { ContextMenu, ContextMenuItem } from "#/components/context-menu.tsx";
import { Icon } from "../../lib/icons";
import type { RowGroup } from "../../lib/row-groups";

/** Recipe-row context menu — sub-block (#7) actions on the row's name: start a
 * new group from this row, join an existing one, or leave the current one. */
export function RowMenu({
  x,
  y,
  recipe,
  display,
  groups,
  currentGroup,
  onNewGroup,
  onJoinGroup,
  onLeaveGroup,
  onClose,
}: {
  x: number;
  y: number;
  recipe: string;
  display: string;
  groups: RowGroup[];
  /** the group this row belongs to, if any */
  currentGroup: RowGroup | null;
  onNewGroup: () => void;
  onJoinGroup: (groupId: number) => void;
  onLeaveGroup: () => void;
  onClose: () => void;
}) {
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-sm text-muted-foreground">
        <Icon kind="recipe" name={recipe} size="sm" noTitle noHover />
        <span className="truncate">{display}</span>
      </div>
      {currentGroup == null ? (
        <>
          <ContextMenuItem onClick={act(onNewGroup)}>
            <Layers className="size-3.5" /> New sub-block from this row
          </ContextMenuItem>
          {groups.map((g) => (
            <ContextMenuItem key={g.id} onClick={act(() => onJoinGroup(g.id))}>
              <Layers className="size-3.5 text-primary/70" /> Add to “{g.name}”
            </ContextMenuItem>
          ))}
        </>
      ) : (
        <ContextMenuItem onClick={act(onLeaveGroup)}>
          <X className="size-3.5" /> Remove from “{currentGroup.name}”
        </ContextMenuItem>
      )}
    </ContextMenu>
  );
}
