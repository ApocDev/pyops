import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Boxes, Zap } from "lucide-react";
import { Icon } from "../../../lib/icons";
import { BOARD_DIM } from "./board-graph.ts";

export type BlockNodeData = {
  name: string;
  iconKind: string | null;
  iconName: string | null;
  electricityW: number | null;
  /** primary producer of a good that runs short — the block to scale up */
  shortOutput: boolean;
};

export type BlockFlowNode = Node<BlockNodeData, "block">;

const fmtW = (w: number) =>
  w >= 1e9
    ? `${(w / 1e9).toFixed(1)} GW`
    : w >= 1e6
      ? `${(w / 1e6).toFixed(1)} MW`
      : `${(w / 1e3).toFixed(0)} kW`;

/** A block on the factory board: icon + name + power draw. Drag to place,
 * double-click to open the block editor (wired at the board level). The
 * handles exist only to anchor edges — connections aren't user-editable. */
export function BlockNode({ data, selected }: NodeProps<BlockFlowNode>) {
  const hiddenHandle = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };
  return (
    <div
      title={`${data.name}${data.shortOutput ? " — its output runs short, scale it up" : ""} — double-click to open`}
      className={`flex items-center gap-2 border bg-card px-2 text-left transition-colors ${
        selected
          ? "border-primary"
          : data.shortOutput
            ? "border-destructive hover:border-primary/60"
            : "border-border hover:border-primary/60"
      }`}
      style={{ width: BOARD_DIM.nodeW, height: BOARD_DIM.nodeH }}
    >
      <Handle type="target" position={Position.Left} style={hiddenHandle} isConnectable={false} />
      {data.iconKind && data.iconName ? (
        <Icon
          kind={data.iconKind as "item" | "fluid" | "recipe"}
          name={data.iconName}
          size="md"
          noHover
        />
      ) : (
        <Boxes className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{data.name}</span>
        {data.electricityW != null && data.electricityW > 1 && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Zap className="size-3.5 shrink-0" aria-hidden />
            {fmtW(data.electricityW)}
          </span>
        )}
      </span>
      <Handle type="source" position={Position.Right} style={hiddenHandle} isConnectable={false} />
    </div>
  );
}
