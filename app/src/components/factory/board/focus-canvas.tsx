import { useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, Panel, ReactFlow, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Maximize } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { EdgeTooltip } from "#/components/edge-tooltip.tsx";
import { BlockNode, type BlockFlowNode } from "./block-node.tsx";
import { GoodNode, type GoodFlowNode } from "./good-node.tsx";
import { FoldNode, type FoldFlowNode } from "./fold-node.tsx";
import { BoardFlowEdge, type BoardFlowEdgeType } from "./board-flow-edge.tsx";
import type { FocusGraph, FocusNode, FocusTarget } from "./focus-graph.ts";

const nodeTypes = { block: BlockNode, good: GoodNode, fold: FoldNode };
const edgeTypes = { flow: BoardFlowEdge };
/** Fit padding, as a fraction of the canvas. With the readable zoom floor
 * below, the board sizes its list/canvas switch from these (factory-board.tsx). */
export const FOCUS_FIT_PADDING = 0.05;
/** Smallest zoom at which node labels stay readable. A graph too tall to fit
 * at this zoom opens centered and scrolls instead of shrinking. */
export const MIN_FOCUS_ZOOM = 0.8;
const FIT = { padding: FOCUS_FIT_PADDING, minZoom: MIN_FOCUS_ZOOM, maxZoom: 1 };
/** How long a block click waits for a second click before refocusing. Focusing
 * remounts the canvas, so an immediate refocus would swallow the double-click. */
const DOUBLE_CLICK_MS = 250;

type FocusFlowNode = BlockFlowNode | GoodFlowNode | FoldFlowNode;

const toFlowNode = (n: FocusNode): FocusFlowNode => {
  const position = { x: n.x, y: n.y };
  switch (n.type) {
    case "block":
      return {
        id: n.id,
        type: "block",
        position,
        data: { ...n, shortOutput: false },
      };
    case "good":
      return { id: n.id, type: "good", position, data: n };
    case "fold":
      return { id: n.id, type: "fold", position, data: n };
  }
};

/** Where clicking a node takes the board: a block refocuses on that block, a
 * good or folded group on that good. The centered block stays put. */
const targetFor = (n: FocusNode): FocusTarget | null =>
  n.type === "block"
    ? n.center
      ? null
      : { kind: "block", id: n.blockId }
    : { kind: "good", good: n.good };

/** A focused board view (shortfalls, one good, or one block's neighbors) as a
 * read-only three-column canvas. Remount it per view so the initial fit frames
 * the new graph. */
export function FocusCanvas({
  graph,
  onFocus,
  onOpenBlock,
}: {
  graph: FocusGraph;
  onFocus: (target: FocusTarget) => void;
  onOpenBlock: (id: number) => void;
}) {
  const { fitView } = useReactFlow();
  const [hoveredEdge, setHoveredEdge] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const pendingFocus = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(pendingFocus.current), []);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const nodes = useMemo(() => graph.nodes.map(toFlowNode), [graph]);
  const edges = useMemo<BoardFlowEdgeType[]>(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        type: "flow" as const,
        source: e.source,
        target: e.target,
        data: {
          goods: e.goods,
          status: e.status,
          width: e.width,
          emphasis:
            hoveredNode == null
              ? ("strong" as const)
              : e.source === hoveredNode || e.target === hoveredNode
                ? ("active" as const)
                : ("dimmed" as const),
        },
      })),
    [graph, hoveredNode],
  );
  const hoveredGoods = hoveredEdge
    ? (graph.edges.find((e) => e.id === hoveredEdge.id)?.goods ?? null)
    : null;

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(e, node) => {
        const n = byId.get(node.id);
        const t = n && targetFor(n);
        if (!t) return;
        // goods have no double-click action, so they refocus right away
        if (n.type !== "block") return onFocus(t);
        window.clearTimeout(pendingFocus.current);
        // the second click of a double-click: leave it to onNodeDoubleClick
        if (e.detail > 1) return;
        pendingFocus.current = window.setTimeout(() => onFocus(t), DOUBLE_CLICK_MS);
      }}
      onNodeDoubleClick={(_e, node) => {
        window.clearTimeout(pendingFocus.current);
        const n = byId.get(node.id);
        if (n?.type === "block") onOpenBlock(n.blockId);
      }}
      onEdgeMouseEnter={(e, edge) => setHoveredEdge({ id: edge.id, x: e.clientX, y: e.clientY })}
      onEdgeMouseMove={(e, edge) => setHoveredEdge({ id: edge.id, x: e.clientX, y: e.clientY })}
      onEdgeMouseLeave={() => setHoveredEdge(null)}
      onNodeMouseEnter={(_e, node) => setHoveredNode(node.id)}
      onNodeMouseLeave={() => setHoveredNode(null)}
      fitView
      fitViewOptions={FIT}
      minZoom={0.05}
      maxZoom={2}
      nodesDraggable={false}
      // d3-zoom's double-click zoom swallows the dblclick on non-draggable
      // nodes, so onNodeDoubleClick would never fire
      zoomOnDoubleClick={false}
      // the wheel scrolls a tall column; Ctrl + wheel (or pinch) still zooms
      panOnScroll
      nodesConnectable={false}
      deleteKeyCode={null}
      className="bg-background"
    >
      <Background variant={BackgroundVariant.Dots} gap={28} size={1.5} color="var(--border)" />
      <Panel position="top-right">
        <Tooltip label content="Fit in view">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => fitView({ ...FIT, duration: 300 })}
            className="bg-card text-muted-foreground"
          >
            <Maximize />
          </Button>
        </Tooltip>
      </Panel>
      {hoveredGoods && hoveredEdge && (
        <EdgeTooltip goods={hoveredGoods} x={hoveredEdge.x} y={hoveredEdge.y} />
      )}
    </ReactFlow>
  );
}
