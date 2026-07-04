import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { RotateCw, TriangleAlert } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { EmptyState } from "#/components/empty-state.tsx";

/**
 * The router's root `errorComponent` (docs/design.md "Interaction states"): any
 * loader/render error thrown under a route lands here instead of a white screen.
 * "Retry" resets the error boundary and invalidates the router so the failed
 * loaders and queries re-run. For an in-body query failure use `QueryBoundary` /
 * `QueryError` — this is the last-resort full-surface fallback.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <EmptyState
        icon={TriangleAlert}
        title="Something went wrong"
        description={
          <>
            This page hit an error while loading.
            {message ? (
              <span className="mt-2 block break-words font-mono text-xs text-destructive">
                {message}
              </span>
            ) : null}
          </>
        }
        action={
          <Button
            variant="outline"
            onClick={() => {
              reset();
              void router.invalidate();
            }}
          >
            <RotateCw /> Retry
          </Button>
        }
        className="border border-destructive/40 bg-card"
      />
    </div>
  );
}
