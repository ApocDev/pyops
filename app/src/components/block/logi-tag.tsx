import { Rocket } from "lucide-react";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { rowLogistics, type ResolvedLogistics } from "../../lib/logistics";
import { Icon } from "../../lib/icons";
import { fmtCount } from "./format.ts";

/** Compact per-item logistics readout under a chip: belts to carry the row's whole
 * flow of this item, devices (inserters/loaders) to move it in/out of ONE building,
 * and — when rockets are on — rocket launches/min. Devices are omitted on
 * building-less rows; `launch` is omitted unless the rocket toggle is on. */
export function LogiTag({
  resolved,
  rate,
  machineCount,
  showBelts,
  showInserters,
  launch,
}: {
  resolved: ResolvedLogistics;
  rate: number;
  machineCount: number;
  showBelts: boolean;
  showInserters: boolean;
  launch?: { perMin: number; defaulted: boolean } | null;
}) {
  if (!(rate > 1e-9)) return null;
  const r = rowLogistics(resolved, rate, machineCount);
  if (!r) return null;
  const beltOn = showBelts;
  const insOn = showInserters && machineCount > 1e-9; // per-building → rows only
  const rocketOn = !!launch;
  if (!beltOn && !insOn && !rocketOn) return null;
  const beltName = resolved.belt?.name;
  const beltDisp = resolved.belt?.display ?? beltName;
  const moverName =
    resolved.moverKind === "loader" ? resolved.loader?.name : resolved.inserter?.name;
  const moverDisp =
    (resolved.moverKind === "loader" ? resolved.loader?.display : resolved.inserter?.display) ??
    moverName;
  const title = [
    beltOn && `≈${fmtCount(r.belts)} × ${beltDisp}`,
    insOn && `≈${fmtCount(r.devices)} × ${moverDisp} per building`,
    rocketOn &&
      `≈${fmtCount(launch.perMin)} rocket launches/min${launch.defaulted ? " (default item weight — not set in data)" : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Tooltip content={title}>
      <span className="flex items-center gap-2.5 pl-1 text-sm text-muted-foreground">
        {beltOn && beltName && (
          <span className="inline-flex items-center gap-1.5">
            <Icon kind="entity" name={beltName} size="sm" noHover />
            <span className="tabular-nums">{fmtCount(r.belts)}</span>
          </span>
        )}
        {insOn && moverName && (
          <span className="inline-flex items-center gap-1.5">
            <Icon kind="entity" name={moverName} size="sm" noHover />
            <span className="tabular-nums">{fmtCount(r.devices)}</span>
          </span>
        )}
        {rocketOn && (
          <span
            className={`inline-flex items-center gap-1.5 ${launch.defaulted ? "opacity-60" : ""}`}
          >
            <Rocket className="size-3.5" />
            <span className="tabular-nums">{fmtCount(launch.perMin)}/m</span>
          </span>
        )}
      </span>
    </Tooltip>
  );
}
