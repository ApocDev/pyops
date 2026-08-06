import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { RawIcon } from "../../lib/icons";
import { ItemHover } from "../../lib/recipe-card";
import { ENERGY_PSEUDO, rateLabel } from "./format.ts";
import { HIDDEN_HANDLE } from "./flow-recipe-node.tsx";
import type { PlacedNode } from "./flow-layout.ts";

export type BoundaryNodeData = { node: PlacedNode };

export type BoundaryFlowNodeType = Node<BoundaryNodeData, "boundary">;

/** Boundary-node tint by role — mirrors the item-chip link palette (import =
 * warning, byproduct export = surplus, goal output = info/target). */
const BOUNDARY_TINT: Record<string, string> = {
  import: "border-warning/50 bg-warning/10 text-warning",
  export: "border-surplus/50 bg-surplus/10 text-surplus",
  output: "border-info/50 bg-info/10 text-info",
};

/** An import / export / goal-output node: a tinted good chip with its rate. */
export function FlowBoundaryNode({ data }: NodeProps<BoundaryFlowNodeType>) {
  const { node } = data;
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
  return (
    <div style={{ width: node.w, height: node.h }}>
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} isConnectable={false} />
      {/* pseudo-goods (electricity/heat/fluid-fuel) have no prototype to card */}
      {pseudo ? (
        body
      ) : (
        <ItemHover kind={kind} name={node.ref} className="block h-full w-full">
          {body}
        </ItemHover>
      )}
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} isConnectable={false} />
    </div>
  );
}
