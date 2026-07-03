/**
 * Toast primitive (#90/#83) — the render half of the shared toast system.
 * `toast()` in `lib/toast-store.ts` enqueues from anywhere; this `Toaster`
 * (mounted once in the root shell) renders the queue as a non-blocking stack
 * in the bottom-right corner, each entry auto-dismissing after its duration,
 * with an optional action button ("Undo", "Reload", …) and a manual ×.
 */
import { useEffect } from "react";
import { useStore } from "@tanstack/react-store";
import { X } from "lucide-react";

import { dismiss, toastStore, type ToastEntry } from "../../lib/toast-store";
import { Button } from "./button";

const toneCls: Record<ToastEntry["tone"], string> = {
  default: "border-border",
  success: "border-success/40",
  destructive: "border-destructive/40",
};

const toneText: Record<ToastEntry["tone"], string> = {
  default: "text-card-foreground",
  success: "text-success",
  destructive: "text-destructive",
};

function ToastItem({ entry }: { entry: ToastEntry }) {
  // Auto-dismiss timer, per toast. The id is stable for the entry's lifetime,
  // so the timer starts once on mount and is dropped if the toast is dismissed
  // early (unmount clears it).
  useEffect(() => {
    const t = setTimeout(() => dismiss(entry.id), entry.duration);
    return () => clearTimeout(t);
  }, [entry.id, entry.duration]);

  return (
    <div
      role="status"
      className={`pointer-events-auto flex max-w-xs min-w-56 items-start gap-2 border bg-card p-3 shadow-lg ${toneCls[entry.tone]}`}
    >
      <span className={`min-w-0 flex-1 text-sm break-words ${toneText[entry.tone]}`}>
        {entry.message}
      </span>
      {entry.action && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="shrink-0"
          onClick={() => {
            entry.action?.onClick();
            dismiss(entry.id);
          }}
        >
          {entry.action.label}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => dismiss(entry.id)}
        aria-label="Dismiss"
        className="shrink-0 text-muted-foreground"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

/** The toast outlet — mount exactly once (in the root shell). Newest toast at
 * the bottom, nearest the corner. The container ignores pointer events so an
 * empty/waning stack never blocks clicks on the page under it. */
export function Toaster() {
  const queue = useStore(toastStore);
  if (queue.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
      {queue.map((entry) => (
        <ToastItem key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
