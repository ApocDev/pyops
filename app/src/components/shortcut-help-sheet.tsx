import { useEffect, useMemo, useState } from "react";
import { Keyboard } from "lucide-react";
import { activeHotkeys, formatCombo, summarizeHotkeys, useHotkey } from "../lib/hotkeys";
import { EmptyState } from "./empty-state";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";

// The palette (or anything else) opens the mounted sheet through this module
// hook instead of threading state up to the root layout.
let openListener: (() => void) | null = null;

/** Open the shortcut help sheet from anywhere (it's mounted once in the root). */
export function openShortcutHelp(): void {
  openListener?.();
}

/**
 * The keyboard-shortcut help sheet (#78): every live hotkey registration,
 * grouped by what it does. Opens on `?` (outside text fields) or through the
 * command palette's "Keyboard shortcuts" entry. The list is read at open time
 * from the hotkey registry, so page-scoped shortcuts appear exactly while the
 * page that registers them is mounted.
 */
export function ShortcutHelpSheet() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    openListener = () => setOpen(true);
    return () => {
      openListener = null;
    };
  }, []);
  useHotkey("?", () => setOpen(true), { description: "Show keyboard shortcuts" });

  // Snapshot the registry when the sheet opens (not on every render — the
  // registry itself isn't reactive, and while the sheet is up nothing mounts).
  const rows = useMemo(() => (open ? summarizeHotkeys(activeHotkeys()) : []), [open]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" aria-describedby={undefined} className="w-96 max-w-[92vw]">
        <SheetHeader>
          <SheetTitle>Keyboard shortcuts</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {rows.length === 0 ? (
            <EmptyState
              icon={Keyboard}
              title="No shortcuts registered"
              description="Shortcuts register per page — open a planning page and try again."
            />
          ) : (
            <ul className="flex flex-col gap-1">
              {rows.map((row) => (
                <li
                  key={row.description}
                  className="flex min-h-8 items-center justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 text-foreground/90">{row.description}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {row.combos.map((combo, i) => (
                      <span key={combo} className="flex items-center gap-1">
                        {i > 0 && <span className="text-xs text-muted-foreground">or</span>}
                        <kbd className="border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                          {formatCombo(combo)}
                        </kbd>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-sm text-muted-foreground">
            Shortcuts are contextual — this lists the ones active on the current page.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
