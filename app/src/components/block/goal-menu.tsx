import { Pencil, RefreshCw, Star, X } from "lucide-react";
import { ContextMenu, ContextMenuItem } from "#/components/context-menu.tsx";
import { Icon } from "../../lib/icons";

/** Goal context menu — right-click a goal cell: change item, make primary,
 * switch between rate and keep-in-stock (#38), remove. */
export function GoalMenu({
  x,
  y,
  name,
  display,
  kind,
  isPrimary,
  isStock,
  onChangeItem,
  onMakePrimary,
  onMakeStock,
  onMakeRate,
  onRemove,
  onClose,
}: {
  x: number;
  y: number;
  name: string;
  display: string;
  kind: "item" | "fluid";
  /** the first goal names the block — hide "move to front" on it */
  isPrimary: boolean;
  isStock: boolean;
  onChangeItem: () => void;
  onMakePrimary: () => void;
  onMakeStock: () => void;
  onMakeRate: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-sm text-muted-foreground">
        <Icon kind={kind} name={name} size="sm" title={display} />
        <span className="truncate">{display}</span>
      </div>
      <ContextMenuItem onClick={act(onChangeItem)}>
        <Pencil className="size-3.5" /> Change item
      </ContextMenuItem>
      {!isPrimary && (
        <ContextMenuItem onClick={act(onMakePrimary)}>
          <Star className="size-3.5" /> Move to front (names the block)
        </ContextMenuItem>
      )}
      {!isStock ? (
        <ContextMenuItem onClick={act(onMakeStock)}>
          <RefreshCw className="size-3.5" /> Keep in stock instead (buffer, not throughput)
        </ContextMenuItem>
      ) : (
        <ContextMenuItem onClick={act(onMakeRate)}>
          <RefreshCw className="size-3.5" /> Track a rate instead
        </ContextMenuItem>
      )}
      <div className="my-1 border-t border-border" />
      <ContextMenuItem onClick={act(onRemove)}>
        <X className="size-3.5" /> Remove goal
      </ContextMenuItem>
    </ContextMenu>
  );
}
