import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { InfoHint } from "#/components/info-hint.tsx";
import { fmtSpoilTime, Icon } from "../../lib/icons";

/** Planned-spoil-rate dialog (#20): the expected rot rate for one item. Production
 * is sized to cover the loss — it solves as extra pinned surplus that spoils away
 * in storage (it never exports). Saving a non-positive/empty rate clears the plan. */
export function SpoilRateDialog({
  item,
  itemDisplay,
  spoilTicks,
  current,
  onSave,
  onClose,
}: {
  item: string;
  itemDisplay: string;
  /** the item's spoil time in ticks, when known — shown as context */
  spoilTicks: number | null;
  /** the currently planned rot rate /s, null = none */
  current: number | null;
  /** rate > 0 sets the plan; null clears it */
  onSave: (rate: number | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(current != null ? String(current) : "");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="md:max-w-[26rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 truncate">
            <Icon kind="item" name={item} size="sm" noHover noTitle />
            Planned spoil loss — {itemDisplay}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3 p-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(draft);
            onSave(Number.isFinite(n) && n > 0 ? n : null);
          }}
        >
          <div className="space-y-1 text-muted-foreground">
            <p className="flex items-center gap-1.5">
              Expected rot rate — production is sized to cover the loss.
              <InfoHint content="Solves as extra pinned surplus that spoils away in storage; it never exports." />
            </p>
            {spoilTicks != null && <p>This item spoils in {fmtSpoilTime(spoilTicks)}.</p>}
          </div>
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              type="text"
              inputMode="decimal"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="0.5"
              className="w-28 text-center"
            />
            <span className="text-muted-foreground">/s</span>
            <Button type="submit" variant="outline" size="sm" className="ml-auto">
              save
            </Button>
            {current != null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onSave(null)}
                className="text-muted-foreground"
              >
                clear
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
