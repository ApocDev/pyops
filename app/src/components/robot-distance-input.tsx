import { useRef, useState } from "react";
import { Input } from "#/components/ui/input.tsx";
import { cn } from "#/lib/utils.ts";

/** Robot trip distance field (#255): a number in tiles, committed on blur or
 * Enter (Escape reverts). Used for the factory default in the Logistics dialog
 * and for a block's override in its Balance card. */
export function RobotDistanceInput({
  value,
  onCommit,
  label,
  className,
  autoFocus,
  onDone,
}: {
  value: number;
  onCommit: (tiles: number) => void;
  label: string;
  className?: string;
  autoFocus?: boolean;
  /** called after every blur, committed or not */
  onDone?: () => void;
}) {
  // null while not editing, so an outside change (undo, the other control)
  // shows through
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commit = () => {
    const n = Number(draft);
    if (!cancelled.current && draft != null && Number.isFinite(n) && n > 0 && n !== value)
      onCommit(n);
    cancelled.current = false;
    setDraft(null);
    onDone?.();
  };
  return (
    <span
      className={cn(
        "inline-flex h-8 items-stretch border border-input focus-within:border-ring",
        className,
      )}
    >
      <Input
        aria-label={label}
        autoFocus={autoFocus}
        type="number"
        min="1"
        inputMode="decimal"
        value={draft ?? String(value)}
        onFocus={() => setDraft(String(value))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        className="h-full w-16 border-0 px-2 text-right tabular-nums focus-visible:ring-0"
      />
      <span className="flex items-center border-l border-input px-2 text-sm text-muted-foreground">
        tiles
      </span>
    </span>
  );
}
