import { useState } from "react";
import type { RateUnit } from "../../db/schema";
import { Input } from "#/components/ui/input.tsx";
import { fmtRate } from "./format.ts";

/** Rate windows (#10): the display/input unit of a goal. The STORED rate stays
 * per-second (the solver's canonical unit) — these only convert at the UI edge. */
const RATE_UNITS: RateUnit[] = ["s", "min", "h"];
const UNIT_FACTOR: Record<RateUnit, number> = { s: 1, min: 60, h: 3600 };

/** A rate shown as plain text ("1.0623/s") that turns into an input on click;
 * commits on blur/Enter, reverts on Escape. Read-only mode just renders the text. */
export function EditableRate({
  value,
  unit = "s",
  readOnly,
  onChange,
  onUnitChange,
}: {
  /** per-second rate (canonical) */
  value: number;
  /** display/input window — the value shown is `value × factor` ("60/min" = 1/s) */
  unit?: RateUnit;
  readOnly?: boolean;
  onChange: (v: number) => void;
  onUnitChange?: (u: RateUnit) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const factor = UNIT_FACTOR[unit];
  const cycleUnit = () =>
    onUnitChange?.(RATE_UNITS[(RATE_UNITS.indexOf(unit) + 1) % RATE_UNITS.length]);
  if (!editing) {
    return (
      <span className="tabular-nums">
        <button
          onClick={() => {
            if (readOnly) return;
            setDraft(fmtRate(value * factor));
            setEditing(true);
          }}
          title={readOnly ? "sized by a locked input" : "click to edit the goal rate"}
          className={readOnly ? "text-muted-foreground" : "hover:text-info"}
        >
          {fmtRate(value * factor)}
        </button>
        <button
          onClick={cycleUnit}
          title="rate window — click to cycle per second / minute / hour"
          className="text-muted-foreground hover:text-info"
        >
          /{unit}
        </button>
      </span>
    );
  }
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n >= 0) onChange(n / factor);
    setEditing(false);
  };
  return (
    <span className="inline-flex items-center gap-0.5">
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
        className="h-7 w-16 border-info/60 px-1 text-center"
      />
      <span className="text-sm text-muted-foreground">/{unit}</span>
    </span>
  );
}
