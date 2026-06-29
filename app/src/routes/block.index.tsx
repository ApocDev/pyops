import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/block/")({
  component: () => (
    <div className="flex h-full items-center justify-center gap-1 p-8 text-center text-muted-foreground">
      Select a block from the sidebar, or <Plus className="inline size-4" /> to create one.
    </div>
  ),
});
