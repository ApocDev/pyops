import { Flame, Timer } from "lucide-react";
import type { ReactNode } from "react";
import { ItemHover } from "../../lib/recipe-card";
import { fmtSpoilTime, Icon } from "../../lib/icons";
import { num, quantityLabel, rateLabel } from "./format.ts";

/** A block item's role under the current solve — drives the chip colour so it's
 * obvious which flows are linked internally vs. need a recipe vs. spill out. */
export type Link = "target" | "import" | "export" | "linked";
export const linkStyle: Record<Link, string> = {
  target: "bg-info/20 ring-1 ring-info/40 text-info",
  import: "bg-warning/20 ring-1 ring-warning/40 text-warning", // nothing in-block makes it
  export: "bg-surplus/20 ring-1 ring-surplus/40 text-surplus", // surplus, nothing consumes it
  linked: "bg-success/15 ring-1 ring-success/30 text-success", // produced AND consumed in-block
};

export const craftableStyle = "border border-dashed border-warning/60 bg-warning/10 text-warning";

/** Clickable ingredient/product pill: icon + rate, tinted by link state. Click
 * opens the recipe picker (produce for an input, consume for an output).
 * A craftable import (a recipe exists to make it) gets a dashed ring so it
 * reads as "you could make this in-block"; a raw import is solid.
 * Right-click opens the good menu (goal / sizing-lock / made-here / spoil). */
export function ItemChip({
  name,
  kind,
  display,
  rate,
  total,
  probability,
  amountExpected,
  amountMin,
  amountMax,
  rateMin,
  rateMax,
  temp,
  spoilTicks,
  link,
  craftable,
  fuel,
  incidental,
  indicator,
  indicatorLabel,
  temperatureControl,
  onClick,
  onContext,
}: {
  name: string;
  kind: string;
  display?: string | null;
  rate?: number;
  /** Finite campaign amount. Replaces the throughput rate as the chip's
   * primary value; the caller may show the derived average separately. */
  total?: number;
  /** Per-craft chance and yield context for a recipe product. */
  probability?: number;
  amountExpected?: number;
  amountMin?: number;
  amountMax?: number;
  /** Variable energy production range; `rate` is the planner average. */
  rateMin?: number;
  rateMax?: number;
  /** temperature label for fluids ("125°", "≤101°") — shown after the rate */
  temp?: string | null;
  /** visible spoil time for a product; ingredient chips leave this unset */
  spoilTicks?: number;
  link: Link;
  craftable?: boolean;
  fuel?: boolean;
  /** some/all of this export is projected from incidental spoilage */
  incidental?: boolean;
  /** Compact status rendered inside the chip rather than between grid columns. */
  indicator?: ReactNode;
  /** Accessible text corresponding to `indicator`. */
  indicatorLabel?: string;
  /** Interactive replacement for `temp`, kept inside the same chip surface. */
  temperatureControl?: ReactNode;
  onClick: () => void;
  onContext?: (e: { clientX: number; clientY: number }) => void;
}) {
  const craftableImport = link === "import" && craftable;
  const cls = craftableImport ? craftableStyle : linkStyle[link];
  const why = craftableImport
    ? "Craftable — click to add a producer"
    : link === "import"
      ? "Raw input — supply externally"
      : link === "target"
        ? "Target"
        : link === "export"
          ? "Export"
          : "Linked";
  const spoilTime = spoilTicks != null ? fmtSpoilTime(spoilTicks) : null;
  const variableRate =
    rate != null &&
    rateMin != null &&
    rateMax != null &&
    (Math.abs(rateMin - rate) > 1e-9 || Math.abs(rateMax - rate) > 1e-9);
  const displayedRate =
    rate == null
      ? ""
      : variableRate
        ? `${rateLabel(name, rate)} avg · ${rateLabel(name, rateMin)}–${rateLabel(name, rateMax)}`
        : rateLabel(name, rate);
  const accessibleRate =
    rate == null ? "" : variableRate ? displayedRate : rateLabel(name, rate, { perSec: true });
  const displayedTotal = total == null ? "" : `${quantityLabel(name, total)} total`;
  const totalRate = total != null && rate != null ? rateLabel(name, rate, { perSec: true }) : "";
  const chance = probability != null && probability < 1 ? `${num(probability * 100)}%` : "";
  const chanceContext = chance ? (
    <div>
      <div className="text-warning">{chance} chance per craft</div>
      {amountExpected != null && (
        <div className="text-muted-foreground">
          {amountMin != null && amountMax != null
            ? amountMin === amountMax
              ? `${num(amountMin)} on success · `
              : `${num(amountMin)}–${num(amountMax)} on success · `
            : ""}
          {num(amountExpected)} expected per craft
        </div>
      )}
    </div>
  ) : undefined;
  return (
    <span className={`inline-flex items-center gap-1 ${cls}`}>
      <ItemHover
        name={name}
        kind={kind as "item" | "fluid"}
        extraText={chanceContext}
        className="inline-flex"
        // the rich card (cost, produced-by / used-in) replaces the old native title;
        // role is the chip colour, rate is shown on the chip, actions are on right-click
      >
        <button
          onClick={onClick}
          onContextMenu={(e) => {
            if (!onContext) return;
            e.preventDefault();
            onContext(e);
          }}
          aria-label={`${display ?? name}${displayedTotal ? ` ${displayedTotal}${totalRate ? ` · ${totalRate} average` : ""}` : accessibleRate ? ` ${accessibleRate}` : ""}${chance ? ` · ${chance} chance` : ""}${spoilTime ? ` · spoils in ${spoilTime}` : ""}${incidental ? " · includes estimated incidental spoilage" : ""}${indicatorLabel ? ` · ${indicatorLabel}` : ""} · ${why}`}
          className="flex items-center gap-1 px-1.5 py-1 text-sm hover:brightness-95"
        >
          <span className="relative flex">
            <Icon kind={kind as "item" | "fluid"} name={name} size="md" noHover />
            {fuel && (
              <Flame
                aria-label="Burned as fuel"
                className="absolute -right-1 -bottom-1 size-3.5 rounded-full bg-background/90 p-px text-warning"
                strokeWidth={2.5}
              />
            )}
          </span>
          {displayedTotal ? (
            <span className="flex flex-col items-start leading-tight tabular-nums">
              <span data-campaign-total className="font-semibold">
                {displayedTotal}
              </span>
              {totalRate && (
                <span data-campaign-rate className="text-xs font-normal text-muted-foreground">
                  {totalRate}
                </span>
              )}
            </span>
          ) : rate != null ? (
            chance ? (
              <span className="flex flex-col items-start leading-tight tabular-nums">
                <span data-rate-range={variableRate ? "variable" : undefined}>{displayedRate}</span>
                <span data-product-probability className="text-xs text-warning">
                  {chance}
                </span>
              </span>
            ) : (
              <span data-rate-range={variableRate ? "variable" : undefined}>{displayedRate}</span>
            )
          ) : null}
          {incidental && (
            <span
              data-incidental-spoilage
              className="flex items-center gap-0.5 text-warning"
              aria-hidden
            >
              <span className="text-muted-foreground">·</span>
              <Timer className="size-3.5" strokeWidth={2.5} /> Incidental
            </span>
          )}
          {spoilTime && (
            <>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <span data-item-spoil-time className="text-warning">
                {spoilTime}
              </span>
            </>
          )}
          {temp && <span className="text-sm text-muted-foreground">{temp}</span>}
          {indicator}
        </button>
      </ItemHover>
      {temperatureControl && <span className="pr-1.5">{temperatureControl}</span>}
    </span>
  );
}
