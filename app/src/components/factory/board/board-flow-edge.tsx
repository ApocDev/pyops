import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { BoardEdgeGood, EdgeStatus } from "./board-graph.ts";

export type FlowEdgeData = {
  goods: BoardEdgeGood[];
  status: EdgeStatus;
  width: number;
  /** focus state lifted to the board (RF edge components get no hover events):
   * "active" = hovered/on a focused block, "dimmed" = something else is focused */
  emphasis: "normal" | "active" | "dimmed";
};

export type BoardFlowEdgeType = Edge<FlowEdgeData, "flow">;

// Inline styles, not `stroke-*` utilities: React Flow's stylesheet also sets
// `stroke` on `.react-flow__edge-path` and wins the cascade against a utility
// class, so the tint must be an inline style to stick.
const STROKE: Record<EdgeStatus, string> = {
  short: "var(--destructive)",
  surplus: "var(--surplus)",
  balanced: "var(--muted-foreground)",
};

/** A block→block supply edge: one bezier carrying every good flowing between
 * the pair, tinted by the worst good's factory-wide balance (short = red) and
 * as wide as the (log-scaled) combined flow. The goods breakdown renders as a
 * cursor-anchored tooltip at the board level (see EdgeTooltip) — a midpoint
 * label on a board-spanning edge is routinely off screen. */
export function BoardFlowEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<BoardFlowEdgeType>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  if (!data) return null;
  const active = selected || data.emphasis === "active";
  const dimmed = !active && data.emphasis === "dimmed";
  return (
    <BaseEdge
      path={path}
      style={{
        stroke: active ? "var(--primary)" : STROKE[data.status],
        strokeWidth: active ? Math.max(data.width, 2.5) : data.width,
        strokeOpacity: active
          ? 0.95
          : dimmed
            ? 0.04
            : data.status === "short"
              ? 0.4
              : data.status === "surplus"
                ? 0.18
                : 0.1,
        fill: "none",
      }}
      interactionWidth={16}
    />
  );
}
