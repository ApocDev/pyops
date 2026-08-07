import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";

export type FlowLinkEdgeData = {
  /** stroke width ∝ the link's solved rate */
  width: number;
  /** a recycle loop (cycle back-edge), drawn dashed */
  back: boolean;
  goodKind: "item" | "fluid";
  emphasis: "normal" | "active" | "dimmed";
};

export type FlowLinkEdgeType = Edge<FlowLinkEdgeData, "flowlink">;

/** One item/fluid flow between two nodes of the block diagram. Geometry comes
 * from React Flow's live handle positions (same as the factory board), so a
 * link follows its nodes when they're dragged. Styling carries the meaning:
 * width ∝ rate, fluids tinted info, recycle loops dashed, board-style focus
 * emphasis. Inline styles because React Flow's stylesheet outranks stroke-*
 * utilities. */
export function FlowLinkEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<FlowLinkEdgeType>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  if (!data) return null;
  const active = data.emphasis === "active";
  return (
    <BaseEdge
      path={path}
      interactionWidth={14}
      style={{
        stroke: active
          ? "var(--primary)"
          : data.goodKind === "fluid"
            ? "var(--info)"
            : "var(--foreground)",
        strokeWidth: data.width,
        strokeOpacity:
          data.emphasis === "active"
            ? 0.9
            : data.emphasis === "dimmed"
              ? 0.08
              : data.goodKind === "fluid"
                ? 0.4
                : 0.28,
        strokeLinecap: "round",
        strokeDasharray: data.back ? "5 4" : undefined,
        fill: "none",
      }}
    />
  );
}
