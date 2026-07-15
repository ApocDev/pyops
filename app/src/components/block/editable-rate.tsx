import { useState } from "react";
import type { RateUnit } from "../../db/schema";
import { Input } from "#/components/ui/input.tsx";
import { fmtPower, fmtRate, parseRateInput } from "./format.ts";
import { TIME_UNIT_FACTOR, TimeUnitControl } from "./time-unit-control.tsx";

/** Rate windows (#10): the display/input unit of a goal. The STORED rate stays
 * per-second (the solver's canonical unit) — these only convert at the UI edge. */

/** A rate shown as plain text ("1.0623/s") that turns into an input on click;
 * commits on blur/Enter, reverts on Escape. Read-only mode just renders the text. */
export function EditableRate({
  value,
  unit = "s",
  readOnly,
  power,
  onChange,
  onUnitChange,
}: {
  /** per-second rate (canonical) */
  value: number;
  /** display/input window — the value shown is `value × factor` ("60/min" = 1/s) */
  unit?: RateUnit;
  readOnly?: boolean;
  /** energy pseudo-fluid (1 unit = 1 MJ): the input also accepts W/kW/MW/GW/TW */
  power?: boolean;
  onChange: (v: number) => void;
  onUnitChange?: (u: RateUnit) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const factor = TIME_UNIT_FACTOR[unit];
  if (!editing) {
    return (
      <span className="tabular-nums">
        <button
          onClick={() => {
            if (readOnly) return;
            // edit the exact per-second number (power display is lossy-rounded)
            setDraft(fmtRate(power ? value : value * factor));
            setEditing(true);
          }}
          title={
            readOnly
              ? "Sized by a locked input"
              : power
                ? "Click to edit the goal rate — accepts 500MW / 5GW / 5TW, or k/M/G/T"
                : "Click to edit the goal rate — accepts k/M/G/T suffixes"
          }
          className={readOnly ? "text-muted-foreground" : "hover:text-info"}
        >
          {power ? fmtPower(value) : fmtRate(value * factor)}
        </button>
        {/* watts are already per-second — no rate window on power display */}
        {!power && onUnitChange && (
          <TimeUnitControl
            unit={unit}
            onChange={onUnitChange}
            title="Rate window — click to cycle per second / minute / hour"
          />
        )}
      </span>
    );
  }
  const commit = () => {
    const parsed = parseRateInput(draft, power);
    // a power-unit value is already per-second — the display window doesn't apply
    if (parsed) onChange(parsed.perSecond ? parsed.value : parsed.value / factor);
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
      {!power && <span className="text-sm text-muted-foreground">/{unit}</span>}
    </span>
  );
}
