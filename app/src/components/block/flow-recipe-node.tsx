import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Boxes } from "lucide-react";
import { Icon } from "../../lib/icons";
import { RecipeHover } from "../../lib/recipe-card";
import type { PlacedNode } from "./flow-layout.ts";

export type RecipeNodeData = {
  node: PlacedNode;
  /** focus the matching recipe row back in the table view */
  onSelect: () => void;
};

export type RecipeFlowNodeType = Node<RecipeNodeData, "recipe">;

/** Invisible anchors so React Flow accepts the edges; the link paths themselves
 * come precomputed from flow-layout's port distribution, not from handles. */
export const HIDDEN_HANDLE = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 0,
} as const;

/** A recipe node on the flow canvas: icon + localized name + building count,
 * clickable to focus the table row and hoverable for the rich recipe card. */
export function FlowRecipeNode({ data }: NodeProps<RecipeFlowNodeType>) {
  const { node, onSelect } = data;
  return (
    <div style={{ width: node.w, height: node.h }}>
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} isConnectable={false} />
      <RecipeHover name={node.ref} className="h-full w-full">
        <button
          type="button"
          onClick={onSelect}
          title={`${node.display} — click to open in the table`}
          className="flex h-full w-full items-center gap-2 border border-border bg-card px-2 text-left transition-colors hover:border-primary focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Icon kind="recipe" name={node.ref} size="md" noHover />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{node.display}</span>
            {node.machineCount != null && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Boxes className="size-3.5 shrink-0" aria-hidden />
                {node.machineCount}×
              </span>
            )}
          </span>
        </button>
      </RecipeHover>
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} isConnectable={false} />
    </div>
  );
}
