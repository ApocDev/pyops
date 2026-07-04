import { Skeleton } from "#/components/ui/skeleton.tsx";

/**
 * The router's default `pendingComponent` (docs/design.md "Interaction states"):
 * a neutral skeleton scaffold — a header bar plus a few content rows — shown
 * while a route with a loader resolves, so navigation never flashes a blank
 * pane. Pages with their own richer skeletons still render those once mounted.
 */
export function RoutePending() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4" aria-busy>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="space-y-2 pt-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-3/4" />
      </div>
    </div>
  );
}
