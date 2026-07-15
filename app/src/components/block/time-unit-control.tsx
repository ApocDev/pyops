import type { RateUnit } from "../../db/schema.ts";

export const TIME_UNITS: RateUnit[] = ["s", "min", "h"];
export const TIME_UNIT_FACTOR: Record<RateUnit, number> = { s: 1, min: 60, h: 3600 };

/** The compact click-to-cycle time-unit control shared by goal rates and
 * temporary campaign duration. */
export function TimeUnitControl({
  unit,
  onChange,
  prefix = "/",
  title = "Time unit — click to cycle seconds / minutes / hours",
  className = "",
}: {
  unit: RateUnit;
  onChange: (unit: RateUnit) => void;
  prefix?: string;
  title?: string;
  className?: string;
}) {
  const cycle = () => onChange(TIME_UNITS[(TIME_UNITS.indexOf(unit) + 1) % TIME_UNITS.length]);
  return (
    <button
      type="button"
      onClick={cycle}
      title={title}
      className={`whitespace-nowrap text-muted-foreground hover:text-info ${className}`}
    >
      {prefix}
      {unit}
    </button>
  );
}
