import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
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
import { LayoutGrid, Maximize } from "lucide-react";
import { factoryCoherenceFn, listBlocksFn } from "../../../server/factorio";
import { setBoardPositionsFn } from "../../../server/board-fns";
import { Button } from "#/components/ui/button.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { QueryError } from "#/components/query-error.tsx";
import { autoPositions, buildBoardGraph, type BoardGraph } from "./board-graph.ts";
import { BlockNode, type BlockFlowNode } from "./block-node.tsx";
import { BoardFlowEdge, type BoardFlowEdgeType } from "./board-flow-edge.tsx";
import { EdgeTooltip } from "./edge-tooltip.tsx";

const nodeTypes = { block: BlockNode };
const edgeTypes = { flow: BoardFlowEdge };

/** The factory as a spatial board: enabled blocks are draggable nodes, supply
 * links are edges tinted by their goods' factory-wide balance. Positions
 * persist per block; auto-layout places anything never dragged. */
export function FactoryBoard() {
  const blocks = useQuery({ queryKey: ["blocks"], queryFn: () => listBlocksFn() });
  const coherence = useQuery({ queryKey: ["coherence"], queryFn: () => factoryCoherenceFn() });
  // React Flow measures the DOM — render it only on the client, after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const enabled = useMemo(() => (blocks.data ?? []).filter((b) => b.enabled), [blocks.data]);
  const graph = useMemo(
    () => (blocks.data && coherence.data ? buildBoardGraph(enabled, coherence.data.links) : null),
    [blocks.data, coherence.data, enabled],
  );

  if (blocks.isError || coherence.isError) {
    const err = blocks.error ?? coherence.error;
    return (
      <QueryError
        title="Couldn’t load the factory board"
        message={err instanceof Error ? err.message : undefined}
        onRetry={() => {
          void blocks.refetch();
          void coherence.refetch();
        }}
      />
    );
  }
  if (!mounted || !graph) return <Skeleton className="h-full min-h-96 w-full" />;
  if (graph.nodes.length === 0) {
    return (
      <EmptyState
        title="No blocks on the board yet"
        description="Enabled blocks appear here as draggable nodes, wired by the goods they exchange — build a block to start your map."
      />
    );
  }
  return (
    <ReactFlowProvider>
      <BoardCanvas graph={graph} />
    </ReactFlowProvider>
  );
}

/** Inner canvas (needs the ReactFlowProvider above it for fitView etc.). */
function BoardCanvas({ graph }: { graph: BoardGraph }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { fitView } = useReactFlow();
  // edge hover carries the cursor position so the goods tooltip can track it
  const [hoveredEdge, setHoveredEdge] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);

  const save = useMutation({
    mutationFn: (positions: { id: number; x: number | null; y: number | null }[]) =>
      setBoardPositionsFn({ data: { positions } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["blocks"] }),
  });

  const [nodes, setNodes] = useState<BlockFlowNode[]>([]);
  useEffect(() => {
    setNodes(
      graph.nodes.map((n) => ({
        id: String(n.id),
        type: "block" as const,
        position: { x: n.x, y: n.y },
        data: {
          name: n.name,
          iconKind: n.iconKind,
          iconName: n.iconName,
          electricityW: n.electricityW,
          shortOutput: n.shortOutput,
        },
      })),
    );
  }, [graph]);

  // Focus model: hovering (or selecting) a block lights up its edges and fades
  // the rest of the web — on a dense Py factory that's the only way to read a
  // single block's connections without dragging it out.
  const selectedIds = useMemo(
    () => new Set(nodes.filter((n) => n.selected).map((n) => Number(n.id))),
    [nodes],
  );
  const edges = useMemo<BoardFlowEdgeType[]>(() => {
    const focused = hoveredEdge != null || hoveredNode != null || selectedIds.size > 0;
    const touchesFocus = (e: { id: string; source: number; target: number }) =>
      hoveredEdge?.id === e.id ||
      e.source === hoveredNode ||
      e.target === hoveredNode ||
      selectedIds.has(e.source) ||
      selectedIds.has(e.target);
    return graph.edges.map((e) => {
      const active = focused && touchesFocus(e);
      return {
        id: e.id,
        type: "flow" as const,
        source: String(e.source),
        target: String(e.target),
        data: {
          goods: e.goods,
          status: e.status,
          width: e.width,
          emphasis: active
            ? ("active" as const)
            : focused
              ? ("dimmed" as const)
              : ("normal" as const),
        },
      };
    });
  }, [graph, hoveredEdge, hoveredNode, selectedIds]);
  const hoveredGoods = hoveredEdge
    ? (graph.edges.find((e) => e.id === hoveredEdge.id)?.goods ?? null)
    : null;

  const autoArrange = () => {
    const placed = autoPositions(
      graph.nodes.map((n) => ({ ...n, boardX: null, boardY: null })),
      graph.edges,
    );
    setNodes((ns) =>
      ns.map((n) => {
        const p = placed.get(Number(n.id));
        return p ? { ...n, position: p } : n;
      }),
    );
    // nulls = "back to auto", so a reload recomputes this same arrangement
    save.mutate(graph.nodes.map((n) => ({ id: n.id, x: null, y: null })));
    requestAnimationFrame(() => fitView({ padding: 0.15, duration: 300 }));
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={(changes: NodeChange<BlockFlowNode>[]) =>
        setNodes((ns) => applyNodeChanges(changes, ns))
      }
      onNodeDragStop={(_e, node, dragged) => {
        const moved = dragged.length > 0 ? dragged : [node];
        save.mutate(moved.map((n) => ({ id: Number(n.id), x: n.position.x, y: n.position.y })));
      }}
      onNodeDoubleClick={(_e, node) => void navigate({ to: "/block/$id", params: { id: node.id } })}
      onEdgeMouseEnter={(e, edge) => setHoveredEdge({ id: edge.id, x: e.clientX, y: e.clientY })}
      onEdgeMouseMove={(e, edge) => setHoveredEdge({ id: edge.id, x: e.clientX, y: e.clientY })}
      onEdgeMouseLeave={() => setHoveredEdge(null)}
      onNodeMouseEnter={(_e, node) => setHoveredNode(Number(node.id))}
      onNodeMouseLeave={() => setHoveredNode(null)}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.05}
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
        <Tooltip label content="Fit the whole factory in view">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => fitView({ padding: 0.15, duration: 300 })}
            className="bg-card text-muted-foreground"
          >
            <Maximize />
          </Button>
        </Tooltip>
        <Tooltip label content="Auto-arrange — relayout every block (clears hand-placed positions)">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={autoArrange}
            className="bg-card text-muted-foreground"
          >
            <LayoutGrid />
          </Button>
        </Tooltip>
      </Panel>
      {hoveredGoods && hoveredEdge && (
        <EdgeTooltip goods={hoveredGoods} x={hoveredEdge.x} y={hoveredEdge.y} />
      )}
      <Panel
        position="bottom-right"
        className="flex items-center gap-3 border border-border bg-card/90 px-2 py-1 text-sm text-muted-foreground"
      >
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-destructive" aria-hidden /> Short
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-surplus" aria-hidden /> Overproduced
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-muted-foreground" aria-hidden /> Balanced
        </span>
      </Panel>
    </ReactFlow>
  );
}
