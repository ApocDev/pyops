import { useEffect, useRef, useState } from "react";
import { GoodDetail } from "./browse/good-detail.tsx";
import { IconProvider } from "../lib/icons.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";

const selector = "[data-good-name][data-good-kind]";

/** Global NEI-style explorer: Alt+Click any tagged item/fluid surface to open
 * its complete recipe graph without navigating away from the current work. */
export function GoodExplorerDialog() {
  const [name, setName] = useState<string | null>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const open = (event: MouseEvent) => {
      if (!event.altKey || !(event.target instanceof Element)) return;
      const target = event.target.closest<HTMLElement>(selector);
      const kind = target?.dataset.goodKind;
      const next = target?.dataset.goodName;
      if (!next || (kind !== "item" && kind !== "fluid")) return;
      event.preventDefault();
      event.stopPropagation();
      setName(next);
    };
    document.addEventListener("click", open, true);
    return () => document.removeEventListener("click", open, true);
  }, []);

  return (
    <Dialog open={name != null} onOpenChange={(open) => !open && setName(null)}>
      <DialogContent
        ref={content}
        className="outline-none md:max-w-[min(94vw,72rem)]"
        // focus the dialog, not its first tabbable: that's the header's price
        // InfoHint, and focusing it opens its tooltip over the dialog
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          content.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Recipe explorer</DialogTitle>
        </DialogHeader>
        <DialogBody className="font-mono text-sm text-foreground">
          <IconProvider>
            <GoodDetail name={name ?? undefined} onPick={setName} />
          </IconProvider>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
