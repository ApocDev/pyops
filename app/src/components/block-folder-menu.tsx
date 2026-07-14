import { Plus } from "lucide-react";
import { ContextMenu, ContextMenuItem } from "#/components/context-menu.tsx";

/** Folder right-click actions in the Blocks sidebar. */
export function BlockFolderMenu({
  x,
  y,
  name,
  onCreateBlock,
  onClose,
}: {
  x: number;
  y: number;
  name: string;
  onCreateBlock: () => void;
  onClose: () => void;
}) {
  return (
    <ContextMenu x={x} y={y} onClose={onClose} className="min-w-48">
      <div className="border-b border-border px-3 py-1.5 text-sm text-muted-foreground">{name}</div>
      <ContextMenuItem
        onClick={() => {
          onCreateBlock();
          onClose();
        }}
      >
        <Plus className="size-3.5" /> New block here
      </ContextMenuItem>
    </ContextMenu>
  );
}
