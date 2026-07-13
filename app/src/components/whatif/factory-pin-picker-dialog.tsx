import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog.tsx";
import { ItemSearchList } from "#/components/block/item-search-list.tsx";

export function FactoryPinPickerDialog({
  onPick,
  onClose,
}: {
  onPick: (good: { name: string; kind: string }) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="md:max-w-[34rem]">
        <DialogHeader>
          <DialogTitle>Add factory pin</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
          <ItemSearchList
            prompt="Choose a desired factory output or consumption target."
            onPick={onPick}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
