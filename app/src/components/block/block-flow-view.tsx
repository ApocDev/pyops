import { useEffect, useMemo, useState } from "react";
import { Maximize, Workflow } from "lucide-react";
import {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Card } from "#/components/ui/card.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { EdgeTooltip } from "#/components/edge-tooltip.tsx";
import { buildFlowGraph } from "./flow-graph.ts";
import { layoutFlow, type FlowLayout } from "./flow-layout.ts";
import { FlowRecipeNode, type RecipeFlowNodeType } from "./flow-recipe-node.tsx";
import { FlowBoundaryNode, type BoundaryFlowNodeType } from "./flow-boundary-node.tsx";
import { FlowLinkEdge, type FlowLinkEdgeType } from "./flow-link-edge.tsx";
import type { SolveResult } from "./solve-view.ts";

const nodeTypes = { recipe: FlowRecipeNode, boundary: FlowBoundaryNode };
const edgeTypes = { flowlink: FlowLinkEdge };

type FlowNodeType = RecipeFlowNodeType | BoundaryFlowNodeType;

/**
 * The block's material flow as a layered node-link diagram (#101) on a
 * zoomable React Flow viewport (same interaction model as the factory board):
 * recipe rows are nodes, imports enter at the left, byproducts and the goal
 * output leave at the right, and every item flow is a link whose width is
 * proportional to its solved rate. Cycles (Py recycle loops) are drawn as
 * dashed back-edges. Layout stays the pure flow-graph/flow-layout pipeline —
 * React Flow only supplies the viewport, so nodes aren't draggable; scroll to
 * zoom, drag the background to pan, click a recipe node to jump to its table
 * row.
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
            exports: res.displayExports,
            goalNames,
            display: res.display,
          })
        : null,
    // goalNames is stable-keyed by its join; res identity drives the rest
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [res, goalKey],
  );
  const layout = useMemo(() => (graph ? layoutFlow(graph) : null), [graph]);
  // React Flow measures the DOM — render it only on the client, after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!res || !mounted)
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

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-semibold tracking-wide text-muted-foreground">
          Material flow
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <LegendDot className="bg-warning" label="Import" />
          <LegendDot className="bg-info" label="Output" />
          <LegendDot className="bg-surplus" label="Byproduct" />
          <span className="flex items-center gap-1">
            <svg width="22" height="8" aria-hidden className="text-muted-foreground/60">
              <path d="M0 4 H22" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
            </svg>
            Recycle loop
          </span>
        </div>
      </div>
      <div className="h-[max(24rem,calc(100dvh-20rem))]">
        <ReactFlowProvider>
          <FlowCanvas layout={layout} onSelectRecipe={onSelectRecipe} />
        </ReactFlowProvider>
      </div>
    </Card>
  );
}

/** Inner canvas: derives React Flow nodes/edges from the placed layout and
 * carries the hover-focus + cursor-tooltip state. */
function FlowCanvas({
  layout,
  onSelectRecipe,
}: {
  layout: FlowLayout;
  onSelectRecipe: (recipe: string) => void;
}) {
  const { fitView } = useReactFlow();
  const [hoverLink, setHoverLink] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);

  const nodes = useMemo<FlowNodeType[]>(
    () =>
      layout.nodes.map((n) =>
        n.kind === "recipe"
          ? {
              id: n.id,
              type: "recipe" as const,
              position: { x: n.x, y: n.y },
              draggable: false,
              data: { node: n, onSelect: () => onSelectRecipe(n.ref) },
            }
          : {
              id: n.id,
              type: "boundary" as const,
              position: { x: n.x, y: n.y },
              draggable: false,
              data: { node: n },
            },
      ),
    [layout, onSelectRecipe],
  );

  // A link is emphasized when hovered directly or when either of its nodes is.
  const edges = useMemo<FlowLinkEdgeType[]>(() => {
    const anyHover = hoverLink != null || hoverNode != null;
    return layout.links.map((l) => {
      const active = hoverLink?.id === l.id || hoverNode === l.source || hoverNode === l.target;
      return {
        id: l.id,
        type: "flowlink" as const,
        source: l.source,
        target: l.target,
        data: {
          path: l.path,
          width: l.width,
          back: l.back,
          goodKind: l.goodKind,
          emphasis: active
            ? ("active" as const)
            : anyHover
              ? ("dimmed" as const)
              : ("normal" as const),
        },
      };
    });
  }, [layout, hoverLink, hoverNode]);

  const hovered = hoverLink ? layout.links.find((l) => l.id === hoverLink.id) : null;

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeMouseEnter={(_e, node) => setHoverNode(node.id)}
      onNodeMouseLeave={() => setHoverNode(null)}
      onEdgeMouseEnter={(e, edge) => setHoverLink({ id: edge.id, x: e.clientX, y: e.clientY })}
      onEdgeMouseMove={(e, edge) => setHoverLink({ id: edge.id, x: e.clientX, y: e.clientY })}
      onEdgeMouseLeave={() => setHoverLink(null)}
      fitView
      fitViewOptions={{ padding: 0.1 }}
      minZoom={0.1}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      deleteKeyCode={null}
      className="bg-background"
    >
      <Background variant={BackgroundVariant.Dots} gap={28} size={1.5} color="var(--border)" />
      <Panel position="top-right">
        <Tooltip label content="Fit the whole flow in view">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => fitView({ padding: 0.1, duration: 300 })}
            className="bg-card text-muted-foreground"
          >
            <Maximize />
          </Button>
        </Tooltip>
      </Panel>
      {hovered && hoverLink && (
        <EdgeTooltip
          goods={[
            {
              good: hovered.good,
              display: hovered.display,
              kind: hovered.goodKind,
              rate: hovered.rate,
            },
          ]}
          x={hoverLink.x}
          y={hoverLink.y}
        />
      )}
    </ReactFlow>
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
