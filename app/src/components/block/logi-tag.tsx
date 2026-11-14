import { Rocket } from "lucide-react";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { rowLogistics, type ResolvedLogistics } from "../../lib/logistics";
import { Icon } from "../../lib/icons";
import { fmtCount } from "./format.ts";
import type { RobotCount } from "./solve-view.ts";

/** Compact per-item logistics readout under a chip: belts to carry the row's whole
 * flow of this item, devices (inserters/loaders) to move it in/out of ONE building
 * (`input` = belt → building, `output` = building → belt), and — when rockets are on — rocket launches/min. Devices are omitted on
 * building-less rows; `launch` is omitted unless the rocket toggle is on.
 * `robots` adds the logistic robots that move the flow over the trip distance
 * (#255), sized from the solved boundary rate; only boundary chips pass it. */
export function LogiTag({
  resolved,
  rate,
  machineCount,
  direction,
  showBelts,
  showInserters,
  launch,
  robots,
}: {
  resolved: ResolvedLogistics;
  rate: number;
  machineCount: number;
  direction: "input" | "output";
  showBelts: boolean;
  showInserters: boolean;
  launch?: { perMin: number; defaulted: boolean } | null;
  robots?: RobotCount | null;
}) {
  if (!(rate > 1e-9)) return null;
  const r = rowLogistics(resolved, rate, machineCount, direction);
  const beltOn = showBelts && !!r;
  const insOn = showInserters && !!r && machineCount > 1e-9; // per-building → rows only
  const rocketOn = !!launch;
  const botsOn = !!robots && robots.count > 0;
  if (!beltOn && !insOn && !rocketOn && !botsOn) return null;
  const beltName = resolved.belt?.name;
  const beltDisp = resolved.belt?.display ?? beltName;
  const moverName =
    resolved.moverKind === "loader" ? resolved.loader?.name : resolved.inserter?.name;
  const moverDisp =
    (resolved.moverKind === "loader" ? resolved.loader?.display : resolved.inserter?.display) ??
    moverName;
  const robotDisp = robots?.robot.display ?? robots?.robot.name;
  const title = [
    beltOn && `≈${fmtCount(r.belts)} × ${beltDisp}`,
    insOn && `≈${fmtCount(r.devices)} × ${moverDisp} per building`,
    botsOn && `≈${fmtCount(robots.count)} × ${robotDisp} over ${robots.distance} tiles`,
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
        {botsOn && (
          <span className="inline-flex items-center gap-1.5 text-foreground" data-robots>
            <Icon kind="entity" name={robots.robot.name} size="sm" noHover />
            <span className="tabular-nums">{fmtCount(robots.count)}</span>
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
