import { useMemo, useState } from "react";
import { Boxes, Workflow } from "lucide-react";
import { Card } from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { Icon, RawIcon } from "../../lib/icons";
import { ItemHover, RecipeHover } from "../../lib/recipe-card";
import { ENERGY_PSEUDO, rateLabel } from "./format.ts";
import { buildFlowGraph } from "./flow-graph.ts";
import { layoutFlow, type PlacedNode } from "./flow-layout.ts";
import type { SolveResult } from "./solve-view.ts";

/** Boundary-node tint by role — mirrors the item-chip link palette (import =
 * warning, byproduct export = surplus, goal output = info/target). */
const BOUNDARY_TINT: Record<string, string> = {
  import: "border-warning/50 bg-warning/10 text-warning",
  export: "border-surplus/50 bg-surplus/10 text-surplus",
  output: "border-info/50 bg-info/10 text-info",
};

/**
 * The block's material flow as a layered node-link diagram (#101): recipe rows
 * are nodes (icon + building count), imports enter at the left, byproducts and
 * the goal output leave at the right, and every item flow is a link whose width
 * is proportional to its solved rate. Cycles (Py recycle loops) are drawn as
 * dashed back-edges rather than assumed away. An alternative view to the recipe
 * table; clicking a recipe node jumps back to that row in the table.
 */
export function BlockFlowView({
  res,
  goalNames,
  onSelectRecipe,
}: {
  res: SolveResult | undefined;
  goalNames: string[];
  /** focus the matching recipe row back in the table view */
  onSelectRecipe: (recipe: string) => void;
}) {
  const goalKey = goalNames.join(",");
  const graph = useMemo(
    () =>
      res
        ? buildFlowGraph({
            rows: res.rows,
            imports: res.imports,
            exports: res.exports,
            goalNames,
            display: res.display,
          })
        : null,
    // goalNames is stable-keyed by its join; res identity drives the rest
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [res, goalKey],
  );
  const layout = useMemo(() => (graph ? layoutFlow(graph) : null), [graph]);

  // A link is emphasized when hovered directly or when either of its nodes is.
  const [hoverLink, setHoverLink] = useState<string | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const anyHover = hoverLink != null || hoverNode != null;

  if (!res)
    return (
      <Card className="p-4">
        <Skeleton className="h-64 w-full" />
      </Card>
    );
  if (!layout || layout.nodes.length === 0)
    return (
      <Card>
        <EmptyState
          icon={Workflow}
          title="No flows to chart yet"
          description="Add recipes to this block and its material flow — producers, intermediates, imports and byproducts — appears here."
        />
      </Card>
    );

  const isActive = (source: string, target: string, id: string) =>
    hoverLink === id || hoverNode === source || hoverNode === target;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Material flow
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <LegendDot className="bg-warning" label="import" />
          <LegendDot className="bg-info" label="output" />
          <LegendDot className="bg-surplus" label="byproduct" />
          <span className="flex items-center gap-1">
            <svg width="22" height="8" aria-hidden className="text-muted-foreground/60">
              <path d="M0 4 H22" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
            </svg>
            recycle loop
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div
          className="relative"
          style={{ width: layout.width, height: layout.height, minWidth: "100%" }}
        >
          <svg
            width={layout.width}
            height={layout.height}
            className="absolute inset-0"
            style={{ pointerEvents: "none" }}
          >
            {layout.links.map((l) => {
              const active = isActive(l.source, l.target, l.id);
              const stroke = active
                ? "stroke-primary"
                : l.goodKind === "fluid"
                  ? "stroke-info"
                  : "stroke-foreground";
              const opacity = active ? 0.9 : anyHover ? 0.08 : l.goodKind === "fluid" ? 0.4 : 0.28;
              return (
                <g key={l.id}>
                  <path
                    d={l.path}
                    fill="none"
                    className={stroke}
                    strokeWidth={l.width}
                    strokeOpacity={opacity}
                    strokeLinecap="round"
                    strokeDasharray={l.back ? "5 4" : undefined}
                  />
                  {/* wide invisible hit target so thin links are still hoverable */}
                  <path
                    d={l.path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(l.width, 14)}
                    style={{ pointerEvents: "stroke" }}
                    onMouseEnter={() => setHoverLink(l.id)}
                    onMouseLeave={() => setHoverLink((cur) => (cur === l.id ? null : cur))}
                  >
                    <title>{`${l.display} · ${rateLabel(l.good, l.rate, { perSec: true })}`}</title>
                  </path>
                </g>
              );
            })}
          </svg>

          {layout.nodes.map((n) => (
            <div
              key={n.id}
              className="absolute"
              style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
              onMouseEnter={() => setHoverNode(n.id)}
              onMouseLeave={() => setHoverNode((cur) => (cur === n.id ? null : cur))}
            >
              {n.kind === "recipe" ? (
                <RecipeNode node={n} onSelect={() => onSelectRecipe(n.ref)} />
              ) : (
                <BoundaryNode node={n} />
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block size-2.5 ${className}`} aria-hidden />
      {label}
    </span>
  );
}

/** A recipe node: icon + localized name + building count, clickable to focus the
 * table row and hoverable for the rich recipe card. */
function RecipeNode({ node, onSelect }: { node: PlacedNode; onSelect: () => void }) {
  return (
    <RecipeHover name={node.ref} className="h-full w-full">
      <button
        type="button"
        onClick={onSelect}
        title={`${node.display} — click to open in the table`}
        className="flex h-full w-full items-center gap-2 border border-border bg-card px-2 text-left transition-colors hover:border-primary focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Icon kind="recipe" name={node.ref} size="md" noHover />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{node.display}</span>
          {node.machineCount != null && (
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Boxes className="size-3.5 shrink-0" aria-hidden />
              {node.machineCount}×
            </span>
          )}
        </span>
      </button>
    </RecipeHover>
  );
}

/** An import / export / goal-output node: a tinted good chip with its rate. */
function BoundaryNode({ node }: { node: PlacedNode }) {
  const tint = BOUNDARY_TINT[node.kind] ?? BOUNDARY_TINT.import;
  const kind = node.goodKind ?? "item";
  const pseudo = ENERGY_PSEUDO.has(node.ref);
  const body = (
    <div className={`flex h-full w-full items-center gap-2 border px-2 ${tint}`}>
      <RawIcon kind={kind} name={node.ref} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm" title={node.display}>
          {node.display}
        </span>
        <span className="block truncate text-sm opacity-80">
          {rateLabel(node.ref, node.throughput, { perSec: true })}
        </span>
      </span>
    </div>
  );
  // pseudo-goods (electricity/heat/fluid-fuel) have no prototype to card
  if (pseudo) return body;
  return (
    <ItemHover kind={kind} name={node.ref} className="block h-full w-full">
      {body}
    </ItemHover>
  );
}
