import { createFileRoute } from "@tanstack/react-router";
import { Boxes, Plus } from "lucide-react";
import { EmptyState } from "#/components/empty-state.tsx";

export const Route = createFileRoute("/block/")({
  component: () => (
    <EmptyState
      className="h-full"
      icon={Boxes}
      title="No block selected"
      description={
        <>
          Pick a block from the sidebar, or use the{" "}
          <Plus className="inline size-3.5" aria-label="new block" /> button to create one.
        </>
      }
    />
  ),
});
