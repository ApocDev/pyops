import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react";

export type FlowLinkEdgeData = {
  /** the exact SVG path from flow-layout's port distribution — used verbatim,
   * ignoring React Flow's own handle-to-handle geometry */
  path: string;
  width: number;
  /** a recycle loop (cycle back-edge), drawn dashed */
  back: boolean;
  goodKind: "item" | "fluid";
  emphasis: "normal" | "active" | "dimmed";
};

export type FlowLinkEdgeType = Edge<FlowLinkEdgeData, "flowlink">;

/** One item/fluid flow between two nodes of the block diagram. The path is
 * precomputed (ports fanned along node edges, back-edges arcing left), so this
 * component only styles it: width ∝ rate, fluids tinted info, recycle loops
 * dashed, and the board-style focus emphasis. Inline styles because React
 * Flow's stylesheet outranks stroke-* utilities. */
export function FlowLinkEdge({ data }: EdgeProps<FlowLinkEdgeType>) {
  if (!data) return null;
  const active = data.emphasis === "active";
  return (
    <BaseEdge
      path={data.path}
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
