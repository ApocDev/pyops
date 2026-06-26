import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/block/")({
  component: () => (
    <div className="flex h-full items-center justify-center p-8 text-center text-muted-foreground">
      Select a block from the sidebar, or ＋ to create one.
    </div>
  ),
});
