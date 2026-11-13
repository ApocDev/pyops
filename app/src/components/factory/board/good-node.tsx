import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { RawIcon } from "../../../lib/icons";
import { formatQty, rateLabel } from "../../../lib/format";
import { BOARD_DIM, type EdgeStatus } from "./board-graph.ts";
import { GOOD_NODE_W } from "./focus-graph.ts";
import { hiddenHandle } from "./block-node.tsx";

export type GoodNodeData = {
  good: string;
  display: string;
  kind: "item" | "fluid";
  produced: number;
  consumed: number;
  net: number;
  status: EdgeStatus;
};

export type GoodFlowNode = Node<GoodNodeData, "good">;

const NET_TONE: Record<EdgeStatus, string> = {
  short: "text-destructive",
  surplus: "text-surplus",
  balanced: "text-muted-foreground",
};

/** A good at the center of a focused board view: made / used across the
 * factory and the gap. Click to focus it (wired at the board level). */
export function GoodNode({ data }: NodeProps<GoodFlowNode>) {
  return (
    <div
      title={`${data.display}: made ${formatQty(data.produced)}/s, used ${formatQty(data.consumed)}/s`}
      className={`flex cursor-pointer items-center gap-2 border bg-card px-2 text-left ${
        data.status === "short" ? "border-destructive" : "border-border"
      }`}
      style={{ width: GOOD_NODE_W, height: BOARD_DIM.nodeH }}
    >
      <Handle type="target" position={Position.Left} style={hiddenHandle} isConnectable={false} />
      <RawIcon kind={data.kind} name={data.good} size="md" noTitle />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{data.display}</span>
        <span className="block truncate text-sm text-muted-foreground">
          {formatQty(data.produced)} / {formatQty(data.consumed)}
        </span>
      </span>
      <span className={`shrink-0 text-sm ${NET_TONE[data.status]}`}>
        {rateLabel(data.good, data.net, { perSec: true, sign: true })}
      </span>
      <Handle type="source" position={Position.Right} style={hiddenHandle} isConnectable={false} />
    </div>
  );
}
