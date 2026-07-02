import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog.tsx";
import { ItemSearchList } from "./item-search-list.tsx";

/** Goal-item picker — choose what product a goal is (add a new one, or change
 * an existing goal's item). Searches items AND fluids. */
export function GoalPickerDialog({
  replaceDisplay,
  onPick,
  onClose,
}: {
  /** when set, the picker is changing this goal's item (display name for the title) */
  replaceDisplay: string | null;
  onPick: (name: string) => void;
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
          <DialogTitle>
            {replaceDisplay ? `Change goal — ${replaceDisplay}` : "Add a goal product"}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
          <ItemSearchList prompt="type to search for a product…" onPick={(it) => onPick(it.name)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
