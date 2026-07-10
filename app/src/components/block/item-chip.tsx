import { Flame, Timer } from "lucide-react";
import { ItemHover } from "../../lib/recipe-card";
import { fmtSpoilTime, Icon } from "../../lib/icons";
import { rateLabel } from "./format.ts";

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
  temp,
  spoilTicks,
  link,
  craftable,
  fuel,
  incidental,
  onClick,
  onContext,
}: {
  name: string;
  kind: string;
  display?: string | null;
  rate?: number;
  /** temperature label for fluids ("125°", "≤101°") — shown after the rate */
  temp?: string | null;
  /** visible spoil time for a product; ingredient chips leave this unset */
  spoilTicks?: number;
  link: Link;
  craftable?: boolean;
  fuel?: boolean;
  /** some/all of this export is projected from incidental spoilage */
  incidental?: boolean;
  onClick: () => void;
  onContext?: (e: { clientX: number; clientY: number }) => void;
}) {
  const craftableImport = link === "import" && craftable;
  const cls = craftableImport ? craftableStyle : linkStyle[link];
  const why = craftableImport
    ? "craftable — click to add a producer"
    : link === "import"
      ? "raw input — supply externally"
      : link;
  const spoilTime = spoilTicks != null ? fmtSpoilTime(spoilTicks) : null;
  return (
    <span className="inline-flex items-center gap-1">
      <ItemHover
        name={name}
        kind={kind as "item" | "fluid"}
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
          aria-label={`${display ?? name}${rate != null ? ` ${rateLabel(name, rate, { perSec: true })}` : ""}${spoilTime ? ` · spoils in ${spoilTime}` : ""}${incidental ? " · includes estimated incidental spoilage" : ""} · ${why}`}
          className={`flex items-center gap-1 px-1.5 py-1 text-sm hover:brightness-95 ${cls}`}
        >
          <span className="relative flex">
            <Icon kind={kind as "item" | "fluid"} name={name} size="md" noHover />
            {fuel && (
              <Flame
                aria-label="burned as fuel"
                className="absolute -right-1 -bottom-1 size-3.5 rounded-full bg-background/90 p-px text-warning"
                strokeWidth={2.5}
              />
            )}
          </span>
          {rate != null && <span>{rateLabel(name, rate)}</span>}
          {incidental && (
            <span
              data-incidental-spoilage
              className="flex items-center gap-0.5 text-warning"
              aria-hidden
            >
              <span className="text-muted-foreground">·</span>
              <Timer className="size-3.5" strokeWidth={2.5} /> incidental
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
        </button>
      </ItemHover>
    </span>
  );
}
