import { Flame, Plus } from "lucide-react";
import type { Disposition } from "../../solver/block";
import { ItemHover } from "../../lib/recipe-card";
import { Icon } from "../../lib/icons";
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

/** Disposition override cycle (alt/right-click) + how the small tag reads. */
export const DISP_CYCLE = ["auto", "import", "export", "balance"] as const;
export const dispTag: Record<Disposition, { label: string; cls: string }> = {
  import: { label: "→ import", cls: "bg-warning/30 text-warning" },
  export: { label: "→ export", cls: "bg-surplus/30 text-surplus" },
  balance: { label: "= balance", cls: "bg-success/30 text-success" },
};

/** Clickable ingredient/product pill: icon + rate, tinted by link state. Click
 * opens the recipe picker (produce for an input, consume for an output).
 * A craftable import (a recipe exists to make it) gets a dashed ring + "＋" so
 * it reads as "you could make this in-block"; a raw import is solid.
 * Alt-click / right-click cycles the solver disposition; when overridden, a
 * small tag shows the forced state (click the tag to clear back to auto). */
export function ItemChip({
  name,
  kind,
  display,
  rate,
  link,
  craftable,
  fuel,
  disp,
  onClick,
  onCycleDisp,
  onClearDisp,
  onContext,
}: {
  name: string;
  kind: string;
  display?: string | null;
  rate?: number;
  link: Link;
  craftable?: boolean;
  fuel?: boolean;
  disp?: Disposition;
  onClick: () => void;
  onCycleDisp?: () => void;
  onClearDisp?: () => void;
  onContext?: (e: { clientX: number; clientY: number }) => void;
}) {
  const craftableImport = link === "import" && craftable;
  const cls = craftableImport ? craftableStyle : linkStyle[link];
  const why = craftableImport
    ? "craftable — click to add a producer"
    : link === "import"
      ? "raw input — supply externally"
      : link;
  return (
    <span className="inline-flex items-center gap-1">
      <ItemHover
        name={name}
        kind={kind as "item" | "fluid"}
        className="inline-flex"
        // the rich card (cost, produced-by / used-in) replaces the old native title;
        // role is the chip colour, rate is shown on the chip, alt-click hint is in the legend
      >
        <button
          onClick={(e) => {
            if (e.altKey && onCycleDisp) return onCycleDisp();
            onClick();
          }}
          onContextMenu={(e) => {
            if (!onContext) return;
            e.preventDefault();
            onContext(e);
          }}
          aria-label={`${display ?? name}${rate != null ? ` ${rateLabel(name, rate, { perSec: true })}` : ""} · ${why}`}
          className={`flex items-center gap-1 px-1.5 py-1 text-sm hover:brightness-95 ${cls} ${
            disp ? "ring-2 ring-info/60" : ""
          }`}
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
          {craftableImport && <Plus className="size-3.5 text-warning" strokeWidth={3} />}
        </button>
      </ItemHover>
      {disp && (
        <button
          onClick={onClearDisp}
          title="forced disposition — click to clear back to auto"
          className={`px-1 py-0.5 text-sm ${dispTag[disp].cls} hover:brightness-110`}
        >
          {dispTag[disp].label}
        </button>
      )}
    </span>
  );
}
