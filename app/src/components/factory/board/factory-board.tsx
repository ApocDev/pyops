import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { LayoutGrid, Maximize, X } from "lucide-react";
import { factoryCoherenceFn, listBlocksFn } from "../../../server/factorio";
import { setBoardPositionsFn } from "../../../server/board-fns";
import { Button } from "#/components/ui/button.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { QueryError } from "#/components/query-error.tsx";
import { ENERGY_PSEUDO, autoPositions, buildBoardGraph, type BoardGraph } from "./board-graph.ts";
import { FOCUS_GRAPH_W, buildFocusGraph, shortfallGoods, type FocusTarget } from "./focus-graph.ts";
import { FOCUS_FIT_PADDING, FocusCanvas, MIN_FOCUS_ZOOM } from "./focus-canvas.tsx";
import { FocusList } from "./focus-list.tsx";
import { ShortfallRail } from "./shortfall-rail.tsx";
import { BoardSearch, type SearchEntry } from "./board-search.tsx";
import { Segmented } from "#/components/ui/segmented.tsx";
import { RawIcon } from "../../../lib/icons";
import { loadRecents } from "../../../lib/recents";
import { BlockNode, type BlockFlowNode } from "./block-node.tsx";
import { BoardFlowEdge, type BoardFlowEdgeType } from "./board-flow-edge.tsx";
import { EdgeTooltip } from "#/components/edge-tooltip.tsx";

const nodeTypes = { block: BlockNode };
const edgeTypes = { flow: BoardFlowEdge };

/** Narrowest canvas that fits the three-column focus graph at MIN_FOCUS_ZOOM. */
const MIN_CANVAS_W = Math.ceil(FOCUS_GRAPH_W * MIN_FOCUS_ZOOM * (1 + 2 * FOCUS_FIT_PADDING));
/** Page padding plus the board border around the canvas. */
const CHROME_W = 40;
/** The shortfall rail beside the canvas (`w-64`). */
const RAIL_W = 256;

/** Live `matchMedia` result; true on the server (the board renders after mount). */
function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => matchMedia(query).matches,
    () => true,
  );
}

type BoardTarget = FocusTarget | { kind: "all" };

const targetKey = (t: BoardTarget) =>
  t.kind === "good" ? `good:${t.good}` : t.kind === "block" ? `block:${t.id}` : t.kind;

/** The factory as a board. It opens on what needs fixing: the goods that run
 * short, with their makers and users. Search or a click focuses one block or
 * good with its direct neighbors; "All blocks" is the full hand-arranged map
 * (enabled blocks as draggable nodes, supply links tinted by balance). With
 * nothing short it opens on the last block the player viewed. */
export function FactoryBoard() {
  const navigate = useNavigate();
  const blocks = useQuery({ queryKey: ["blocks"], queryFn: () => listBlocksFn() });
  const coherence = useQuery({ queryKey: ["coherence"], queryFn: () => factoryCoherenceFn() });
  // React Flow measures the DOM — render it only on the client, after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // null = the default view, resolved below once the data is in
  const [picked, setPicked] = useState<BoardTarget | null>(null);

  const enabled = useMemo(() => (blocks.data ?? []).filter((b) => b.enabled), [blocks.data]);
  const links = coherence.data?.links;
  const shorts = useMemo(() => (links ? shortfallGoods(links) : []), [links]);
  // Room for a readable three-column canvas, after the rail takes its width?
  // Otherwise focused views render as lists.
  const wide = useMediaQuery(
    `(min-width: ${MIN_CANVAS_W + CHROME_W + (shorts.length > 0 ? RAIL_W : 0)}px)`,
  );
  const target = useMemo<BoardTarget>(() => {
    if (picked) return picked;
    if (shorts.length > 0) return { kind: "shortfalls" };
    // loadRecents reads localStorage, so this waits for mount
    const enabledIds = new Set(enabled.map((b) => b.id));
    const last = mounted
      ? loadRecents().find((r) => r.type === "block" && enabledIds.has(r.id))
      : undefined;
    return last?.type === "block" ? { kind: "block", id: last.id } : { kind: "all" };
  }, [picked, shorts, enabled, mounted]);

  const graph = useMemo(
    () => (blocks.data && links && target.kind === "all" ? buildBoardGraph(enabled, links) : null),
    [blocks.data, links, enabled, target.kind],
  );
  const focus = useMemo(
    () => (links && target.kind !== "all" ? buildFocusGraph(enabled, links, target) : null),
    [links, enabled, target],
  );
  const searchEntries = useMemo<SearchEntry[]>(
    () => [
      ...(links ?? [])
        .filter((l) => !ENERGY_PSEUDO.has(l.good))
        .map((l) => ({
          type: "good" as const,
          good: l.good,
          display: l.display ?? l.good,
          kind: l.kind === "fluid" ? ("fluid" as const) : ("item" as const),
        })),
      ...enabled.map((b) => ({
        type: "block" as const,
        id: b.id,
        name: b.name,
        iconKind: b.iconKind,
        iconName: b.iconName,
      })),
    ],
    [links, enabled],
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
  if (!mounted || !blocks.data || !links) return <Skeleton className="h-full min-h-96 w-full" />;
  if (enabled.length === 0) {
    return (
      <EmptyState
        title="No blocks on the board yet"
        description="Enabled blocks appear here as draggable nodes, wired by the goods they exchange — build a block to start your map."
      />
    );
  }

  const openBlock = (id: number) => void navigate({ to: "/block/$id", params: { id: String(id) } });
  const focusedBlock =
    target.kind === "block" ? enabled.find((b) => b.id === target.id) : undefined;
  const focusedGood =
    target.kind === "good" ? links.find((l) => l.good === target.good) : undefined;
  // Wide: rail beside the canvas. Narrow: the canvas would shrink past reading
  // size, so shortfalls show as the rail alone and a focus as stacked lists.
  const showRail =
    shorts.length > 0 && (wide ? target.kind !== "all" : target.kind === "shortfalls");
  const clearFocus = () => setPicked(shorts.length > 0 ? { kind: "shortfalls" } : { kind: "all" });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
        <BoardSearch entries={searchEntries} onPick={setPicked} className="w-full sm:w-64" />
        {(focusedBlock || focusedGood) && (
          <div className="flex h-8 min-w-0 items-center gap-1.5 border border-primary/60 pl-2 text-sm">
            {focusedGood ? (
              <RawIcon
                kind={focusedGood.kind === "fluid" ? "fluid" : "item"}
                name={focusedGood.good}
                size="sm"
                noTitle
              />
            ) : focusedBlock?.iconKind && focusedBlock.iconName ? (
              <RawIcon
                kind={focusedBlock.iconKind as "item" | "fluid" | "recipe"}
                name={focusedBlock.iconName}
                size="sm"
                noTitle
              />
            ) : null}
            <span className="truncate">
              {focusedGood ? (focusedGood.display ?? focusedGood.good) : focusedBlock?.name}
            </span>
            {focusedBlock && (
              <Button variant="ghost" size="sm" onClick={() => openBlock(focusedBlock.id)}>
                Open
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              title="Clear focus"
              onClick={clearFocus}
              className="text-muted-foreground"
            >
              <X />
            </Button>
          </div>
        )}
        <Segmented<"shortfalls" | "all" | "focus">
          aria-label="Board view"
          className="ml-auto"
          size="sm"
          value={target.kind === "shortfalls" || target.kind === "all" ? target.kind : "focus"}
          onValueChange={(v) => v !== "focus" && setPicked({ kind: v })}
          options={[
            { value: "shortfalls", label: "Shortfalls" },
            { value: "all", label: `All blocks · ${enabled.length}` },
          ]}
        />
      </div>
      <div className="flex min-h-0 flex-1">
        {showRail && (
          <ShortfallRail
            goods={shorts}
            active={target.kind === "good" ? target.good : null}
            onPick={(good) => setPicked({ kind: "good", good })}
            className={wide ? "w-64 shrink-0 border-r border-border" : "flex-1"}
          />
        )}
        {(wide || !showRail) && (
          <div className="relative min-w-0 flex-1">
            {graph ? (
              <ReactFlowProvider>
                <BoardCanvas graph={graph} />
              </ReactFlowProvider>
            ) : focus && focus.nodes.length > 0 ? (
              wide ? (
                <ReactFlowProvider key={targetKey(target)}>
                  <FocusCanvas graph={focus} onFocus={setPicked} onOpenBlock={openBlock} />
                </ReactFlowProvider>
              ) : (
                <FocusList graph={focus} onFocus={setPicked} />
              )
            ) : (
              <EmptyState
                title={target.kind === "shortfalls" ? "Nothing is short" : "Nothing connects here"}
                description={
                  target.kind === "shortfalls"
                    ? "Every good one block makes for another is covered."
                    : "No other enabled block makes or uses this."
                }
                action={
                  <Button variant="outline" size="sm" onClick={() => setPicked({ kind: "all" })}>
                    All blocks
                  </Button>
                }
              />
            )}
          </div>
        )}
      </div>
    </div>
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
  // positions at drag start, so drag-stop can persist only what really moved
  const dragStart = useRef<Map<string, { x: number; y: number }> | null>(null);

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
      onNodeDragStart={(_e, node, dragged) => {
        const start = new Map<string, { x: number; y: number }>();
        for (const n of dragged.length > 0 ? dragged : [node]) start.set(n.id, { ...n.position });
        dragStart.current = start;
      }}
      onNodeDragStop={(_e, node, dragged) => {
        // Persist only what actually MOVED: React Flow reports a drag for a
        // plain click too, and writing an unchanged position would pin an
        // auto-laid-out block for no reason.
        const moved = (dragged.length > 0 ? dragged : [node]).filter((n) => {
          const from = dragStart.current?.get(n.id);
          return (
            !from || Math.abs(from.x - n.position.x) > 0.5 || Math.abs(from.y - n.position.y) > 0.5
          );
        });
        dragStart.current = null;
        if (moved.length === 0) return;
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
          <span className="inline-block h-0.5 w-4 bg-surplus" aria-hidden /> Surplus
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-muted-foreground" aria-hidden /> Balanced
        </span>
      </Panel>
    </ReactFlow>
  );
}
