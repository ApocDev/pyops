import * as React from "react";
import { RotateCw } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";

/**
 * The house inline error surface (docs/design.md "Interaction states"): a
 * destructive `Callout` that says what failed and offers a retry, so pages stop
 * hand-rolling `{q.isError && <div className="text-destructive">…</div>}`. Pair
 * with {@link QueryBoundary} for the loading/empty/error trio, or drop in on its
 * own next to a mutation. Route-level failures use `RouteError` instead.
 */
export function QueryError({
  title = "Couldn’t load this",
  message,
  onRetry,
  className,
}: {
  title?: React.ReactNode;
  /** the underlying error message, shown as fine print when present */
  message?: string;
  /** wire to the query's `refetch` (or a mutation's `reset`+re-run) */
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Callout
      tone="destructive"
      className={className}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCw /> Retry
          </Button>
        ) : undefined
      }
    >
      {/* Render the heading in the body rather than Callout's `title` prop, which
          collides with the DOM `title` attribute and only accepts a string. */}
      <div className="font-semibold">{title}</div>
      {message ? <span className="break-words opacity-90">{message}</span> : null}
    </Callout>
  );
}
