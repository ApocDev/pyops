import { Boxes } from "lucide-react";
import { RawIcon } from "../../../lib/icons";
import { formatQty, rateLabel } from "../../../lib/format";
import { Button } from "#/components/ui/button.tsx";
import type { FocusGraph, FocusNode, FocusTarget } from "./focus-graph.ts";

const NodeIcon = ({ n }: { n: FocusNode }) =>
  n.type !== "block" ? (
    <RawIcon kind={n.kind} name={n.good} size="md" noTitle />
  ) : n.iconKind && n.iconName ? (
    <RawIcon kind={n.iconKind as "item" | "fluid" | "recipe"} name={n.iconName} size="md" noTitle />
  ) : (
    <Boxes className="size-6 text-muted-foreground" aria-hidden />
  );

const label = (n: FocusNode) =>
  n.type === "block" ? n.name : n.type === "good" ? n.display : `${n.count} more ${n.side}`;

/** A focused board view as stacked lists, for widths where the three-column
 * canvas would shrink past reading size: the center, then what feeds it and
 * what it feeds, each row with the goods and rate on its edge. Tapping a row
 * focuses that block or good, like clicking it on the canvas. */
export function FocusList({
  graph,
  onFocus,
}: {
  graph: FocusGraph;
  onFocus: (target: FocusTarget) => void;
}) {
  const center = graph.nodes.filter((n) => n.col === 1);
  const sections = [
    { title: "Made by", col: 0 },
    { title: "Used by", col: 2 },
  ] as const;
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-2">
      {center.map((n) => (
        <div key={n.id} className="flex items-center gap-2 border border-border bg-card p-2">
          <NodeIcon n={n} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-foreground">{label(n)}</span>
            {n.type === "good" && (
              <span className="block text-sm text-muted-foreground">
                {formatQty(n.produced)} / {formatQty(n.consumed)}
              </span>
            )}
          </span>
          {n.type === "good" && (
            <span className={n.status === "short" ? "text-destructive" : "text-muted-foreground"}>
              {rateLabel(n.good, n.net, { perSec: true, sign: true })}
            </span>
          )}
        </div>
      ))}
      {sections.map(({ title, col }) => {
        const rows = graph.nodes.filter((n) => n.col === col);
        if (rows.length === 0) return null;
        return (
          <div key={title} className="flex flex-col gap-1">
            <div className="text-sm text-muted-foreground">
              {title} · {rows.length}
            </div>
            {rows.map((n) => {
              const goods = graph.edges
                .filter((e) => e.source === n.id || e.target === n.id)
                .flatMap((e) => e.goods);
              const target: FocusTarget =
                n.type === "block"
                  ? { kind: "block", id: n.blockId }
                  : { kind: "good", good: n.good };
              return (
                <Button
                  key={n.id}
                  variant="outline"
                  onClick={() => onFocus(target)}
                  className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-left font-normal"
                >
                  <NodeIcon n={n} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">{label(n)}</span>
                    <span className="block truncate text-muted-foreground">
                      {goods.map((g, i) => (
                        <span key={g.good}>
                          {i > 0 && ", "}
                          {g.display}{" "}
                          <span className={g.status === "short" ? "text-destructive" : ""}>
                            {rateLabel(g.good, g.rate, { perSec: true })}
                          </span>
                        </span>
                      ))}
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
