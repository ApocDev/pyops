import { useState } from "react";
import { Input } from "#/components/ui/input.tsx";
import { num } from "./format.ts";

/** The building-count field in a recipe row. Shows the solved count; click it to
 * type a fixed count — a `count` pin (supply-push: "I built N of these"). The
 * fixed state is conveyed by TINT on the number itself, not a separate badge:
 * info tint = fixed, warning tint = capped. Clearing the input removes the pin.
 *
 * A `cap` pin is set in the Pins dialog and its ceiling can differ from the
 * shown (solved) count, so a capped field opens the dialog on click rather than
 * inline-editing a number that isn't the ceiling. */
export function EditableCount({
  count,
  pin,
  onSetCount,
  onClear,
  onOpenPins,
}: {
  /** solved (possibly fractional) building count */
  count: number;
  pin: { kind: "count" | "cap"; count: number } | undefined;
  onSetCount: (n: number) => void;
  onClear: () => void;
  onOpenPins: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const fixed = pin?.kind === "count";
  const capped = pin?.kind === "cap";

  if (editing) {
    const commit = () => {
      const t = draft.trim();
      if (t === "") onClear();
      else {
        const n = Number(t);
        if (Number.isFinite(n) && n > 0) onSetCount(n);
      }
      setEditing(false);
    };
    return (
      <Input
        autoFocus
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-6 w-14 border-info/60 px-1 text-center font-semibold"
      />
    );
  }

  // fixed shows its exact pinned value; capped/unpinned show the solved count
  const shown = fixed ? pin.count : count;
  const tint = fixed
    ? "bg-info/20 text-info ring-1 ring-info/40"
    : capped
      ? "bg-warning/20 text-warning ring-1 ring-warning/40"
      : "text-foreground hover:text-info";
  return (
    <button
      onClick={() => {
        if (capped) {
          onOpenPins();
          return;
        }
        setDraft(fixed ? String(pin.count) : "");
        setEditing(true);
      }}
      title={
        fixed
          ? `Fixed at ${num(pin.count)} building${pin.count === 1 ? "" : "s"} — click to change (clear to unpin)`
          : capped
            ? `Capped at ${num(pin.count)} building${pin.count === 1 ? "" : "s"} — click to edit in Pins`
            : "Click to fix the building count"
      }
      className={`px-1 font-semibold tabular-nums ${tint}`}
    >
      {num(shown)}
    </button>
  );
}
