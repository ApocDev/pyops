import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { RawIcon } from "../../../lib/icons";
import { rateLabel } from "../../../lib/format";
import { BOARD_DIM } from "./board-graph.ts";
import { hiddenHandle } from "./block-node.tsx";

export type FoldNodeData = {
  good: string;
  display: string;
  kind: "item" | "fluid";
  side: "makers" | "users";
  count: number;
  rate: number;
};

export type FoldFlowNode = Node<FoldNodeData, "fold">;

/** The smaller makers or users of one good, folded into a single node so a
 * byproduct trickled out by dozens of blocks draws one edge. Click to focus
 * the good and see them all. */
export function FoldNode({ data }: NodeProps<FoldFlowNode>) {
  return (
    <div
      className="flex cursor-pointer items-center gap-2 border border-dashed border-border bg-card px-2 text-left hover:border-primary/60"
      style={{ width: BOARD_DIM.nodeW, height: BOARD_DIM.nodeH }}
    >
      <Handle type="target" position={Position.Left} style={hiddenHandle} isConnectable={false} />
      <RawIcon kind={data.kind} name={data.good} size="md" noTitle />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">
          {data.count} more {data.side}
        </span>
        <span className="block truncate text-sm text-muted-foreground">
          {data.display} · {rateLabel(data.good, data.rate, { perSec: true })}
        </span>
      </span>
      <Handle type="source" position={Position.Right} style={hiddenHandle} isConnectable={false} />
    </div>
  );
}
