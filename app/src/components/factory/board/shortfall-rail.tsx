import { RawIcon } from "../../../lib/icons";
import { rateLabel } from "../../../lib/format";
import { Button } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";
import type { BoardLinkInput } from "./board-graph.ts";

/** The goods that run short factory-wide, worst first. Picking one focuses the
 * board on that good; the active one is the board's current focus. */
export function ShortfallRail({
  goods,
  active,
  onPick,
  className,
}: {
  goods: BoardLinkInput[];
  active: string | null;
  onPick: (good: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col overflow-y-auto bg-card", className)}>
      <div className="flex items-center justify-between px-3 py-2 text-sm text-muted-foreground">
        Short
        <span className="text-destructive">{goods.length}</span>
      </div>
      {goods.map((l) => (
        <Button
          key={l.good}
          variant="ghost"
          aria-pressed={active === l.good}
          onClick={() => onPick(l.good)}
          className={cn(
            "h-auto w-full justify-start gap-2 border-t border-l-2 border-t-border border-l-transparent px-3 py-2 text-left font-normal",
            active === l.good && "border-l-destructive bg-muted",
          )}
        >
          <RawIcon kind={l.kind === "fluid" ? "fluid" : "item"} name={l.good} size="md" noTitle />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-foreground">{l.display ?? l.good}</span>
            <span
              className="block truncate text-muted-foreground"
              title={`${l.producers.length} makers → ${l.consumers.length} users`}
            >
              {l.producers.length} → {l.consumers.length}
            </span>
          </span>
          <span className="shrink-0 text-destructive">
            {rateLabel(l.good, l.net, { perSec: true })}
          </span>
        </Button>
      ))}
    </div>
  );
}
