import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, Maximize, Workflow } from "lucide-react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { setFlowPositionsFn } from "../../server/board-fns";
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
 * dashed back-edges. Layout stays the pure flow-graph/flow-layout pipeline,
 * which places every node the user has not moved; hand-dragged nodes keep
 * their saved spot (per block, keyed by node id, pruned when a recipe leaves
 * the block). Scroll to zoom, drag the background to pan, drag a node to
 * arrange, click a recipe node to jump to its table row.
 */
export function BlockFlowView({
  blockId,
  res,
  goalNames,
  storedPositions,
  onSelectRecipe,
}: {
  blockId: number;
  res: SolveResult | undefined;
  goalNames: string[];
  /** hand-placed node positions saved for this block (id → {x,y}) */
  storedPositions?: Record<string, { x: number; y: number }> | null;
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
          <FlowCanvas
            blockId={blockId}
            layout={layout}
            storedPositions={storedPositions}
            onSelectRecipe={onSelectRecipe}
          />
        </ReactFlowProvider>
      </div>
    </Card>
  );
}

/** Inner canvas: derives React Flow nodes/edges from the placed layout, applies
 * saved hand positions, and carries the hover-focus + cursor-tooltip state. */
function FlowCanvas({
  blockId,
  layout,
  storedPositions,
  onSelectRecipe,
}: {
  blockId: number;
  layout: FlowLayout;
  storedPositions?: Record<string, { x: number; y: number }> | null;
  onSelectRecipe: (recipe: string) => void;
}) {
  const qc = useQueryClient();
  const { fitView } = useReactFlow();
  const [hoverLink, setHoverLink] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  // positions at drag start, so drag-stop can persist only what really moved
  const dragStart = useRef<Map<string, { x: number; y: number }> | null>(null);

  const save = useMutation({
    mutationFn: (d: {
      positions: Record<string, { x: number; y: number }>;
      liveIds?: string[];
      reset?: boolean;
    }) => setFlowPositionsFn({ data: { blockId, ...d } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["block", blockId] }),
  });

  // Keep the click-through callback in a ref: the parent re-creates it on every
  // render, and rebuilding nodes for that would snap a node being dragged back
  // to its laid-out position mid-drag.
  const selectRef = useRef(onSelectRecipe);
  useEffect(() => {
    selectRef.current = onSelectRecipe;
  }, [onSelectRecipe]);

  // Auto-layout places every node; a saved position overrides it for that node.
  const [nodes, setNodes] = useState<FlowNodeType[]>([]);
  useEffect(() => {
    setNodes(
      layout.nodes.map((n) => {
        const at = storedPositions?.[n.id] ?? { x: n.x, y: n.y };
        return n.kind === "recipe"
          ? {
              id: n.id,
              type: "recipe" as const,
              position: at,
              data: { node: n, onSelect: () => selectRef.current(n.ref) },
            }
          : {
              id: n.id,
              type: "boundary" as const,
              position: at,
              data: { node: n },
            };
      }),
    );
  }, [layout, storedPositions]);

  const relayout = () => {
    setNodes((ns) =>
      ns.map((n) => {
        const placed = layout.nodes.find((l) => l.id === n.id);
        return placed ? { ...n, position: { x: placed.x, y: placed.y } } : n;
      }),
    );
    save.mutate({ positions: {}, reset: true });
    requestAnimationFrame(() => fitView({ padding: 0.1, duration: 300 }));
  };
  const hasCustom = storedPositions != null && Object.keys(storedPositions).length > 0;

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
      onNodesChange={(changes: NodeChange<FlowNodeType>[]) =>
        setNodes((ns) => applyNodeChanges(changes, ns))
      }
      onNodeDragStart={(_e, node, dragged) => {
        const start = new Map<string, { x: number; y: number }>();
        for (const n of dragged.length > 0 ? dragged : [node]) start.set(n.id, { ...n.position });
        dragStart.current = start;
      }}
      onNodeDragStop={(_e, node, dragged) => {
        // Persist only what actually MOVED: React Flow reports a drag for a
        // plain click too, and writing an unchanged position would churn the
        // block row (and pin an auto-laid-out node for no reason).
        const moved = (dragged.length > 0 ? dragged : [node]).filter((n) => {
          const from = dragStart.current?.get(n.id);
          return (
            !from || Math.abs(from.x - n.position.x) > 0.5 || Math.abs(from.y - n.position.y) > 0.5
          );
        });
        dragStart.current = null;
        if (moved.length === 0) return;
        const positions = Object.fromEntries(moved.map((n) => [n.id, n.position]));
        save.mutate({ positions, liveIds: layout.nodes.map((n) => n.id) });
      }}
      onNodeMouseEnter={(_e, node) => setHoverNode(node.id)}
      onNodeMouseLeave={() => setHoverNode(null)}
      onEdgeMouseEnter={(e, edge) => setHoverLink({ id: edge.id, x: e.clientX, y: e.clientY })}
      onEdgeMouseMove={(e, edge) => setHoverLink({ id: edge.id, x: e.clientX, y: e.clientY })}
      onEdgeMouseLeave={() => setHoverLink(null)}
      fitView
      fitViewOptions={{ padding: 0.1 }}
      minZoom={0.1}
      maxZoom={2}
      nodesConnectable={false}
      deleteKeyCode={null}
      className="bg-background"
    >
      <Background variant={BackgroundVariant.Dots} gap={28} size={1.5} color="var(--border)" />
      <MiniMap
        position="bottom-left"
        pannable
        zoomable
        nodeColor="var(--muted)"
        nodeStrokeColor="var(--border)"
        maskColor="color-mix(in oklab, var(--background) 75%, transparent)"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      />
      <Panel position="top-right" className="flex gap-1.5">
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
        <Tooltip label content="Auto-arrange — relayout every node (clears hand-placed positions)">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={relayout}
            disabled={!hasCustom}
            className="bg-card text-muted-foreground"
          >
            <LayoutGrid />
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
