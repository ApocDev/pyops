import { Grid2x2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog.tsx";
import { Icon } from "../../lib/icons";
import { ItemSearchList } from "./item-search-list.tsx";
import { rowBtn } from "./styles.ts";

/** Block-icon picker (#40) — choose any item/fluid as the block's icon, or
 * reset to auto (follow the first goal). */
export function IconPickerDialog({
  target,
  targetKind,
  customIcon,
  onPick,
  onReset,
  onClose,
}: {
  /** the first goal's good — the "auto" row previews it */
  target: string;
  targetKind: string;
  /** the current explicit pick, null = auto */
  customIcon: { kind: string; name: string } | null;
  onPick: (kind: string, name: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="md:max-w-[34rem]">
        <DialogHeader>
          <DialogTitle>Block icon</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
          <button className={rowBtn} onClick={onReset}>
            {target ? (
              <Icon kind={targetKind as "item" | "fluid"} name={target} size="md" noHover noTitle />
            ) : (
              <Grid2x2 className="size-5 text-muted-foreground" />
            )}
            <span>
              Auto — follow the first goal
              {!customIcon && <span className="ml-2 text-sm text-primary">Current</span>}
            </span>
          </button>
          <ItemSearchList
            prompt="Type to search for an item or fluid…"
            current={customIcon}
            onPick={(it) => onPick(it.kind, it.name)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
