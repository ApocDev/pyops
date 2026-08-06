import { RawIcon } from "../../../lib/icons";
import { rateLabel } from "../../../lib/format";
import type { BoardEdgeGood } from "./board-graph.ts";

/** Cursor-anchored breakdown of the goods riding a hovered edge. Anchoring to
 * the cursor (not the path midpoint) matters because a board edge can span
 * thousands of px — its midpoint is routinely off screen. Flips to the other
 * side of the cursor near the right/bottom viewport edges. */
export function EdgeTooltip({ goods, x, y }: { goods: BoardEdgeGood[]; x: number; y: number }) {
  const shown = goods.slice(0, 8);
  const flipX = typeof window !== "undefined" && x > window.innerWidth - 320;
  const flipY =
    typeof window !== "undefined" && y > window.innerHeight - (shown.length + 1) * 28 - 40;
  return (
    <div
      style={{
        position: "fixed",
        left: x,
        top: y,
        transform: `translate(${flipX ? "calc(-100% - 12px)" : "12px"}, ${flipY ? "calc(-100% - 12px)" : "16px"})`,
      }}
      className="pointer-events-none z-50 border border-border bg-popover px-2 py-1 shadow-md"
    >
      {shown.map((g) => (
        <div key={g.good} className="flex items-center gap-1.5 text-sm whitespace-nowrap">
          <RawIcon kind={g.kind} name={g.good} size="sm" />
          <span className="max-w-40 truncate text-popover-foreground">{g.display}</span>
          <span className="text-muted-foreground">
            {rateLabel(g.good, g.rate, { perSec: true })}
          </span>
          {g.status === "short" && (
            <span className="text-destructive">
              short {rateLabel(g.good, -g.net, { perSec: true })}
            </span>
          )}
        </div>
      ))}
      {goods.length > shown.length && (
        <div className="text-sm text-muted-foreground">+{goods.length - shown.length} more</div>
      )}
    </div>
  );
}
