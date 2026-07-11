import * as React from "react";
import type { UseQueryResult } from "@tanstack/react-query";

import { EmptyState } from "#/components/empty-state.tsx";
import { QueryError } from "#/components/query-error.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";

/** The slice of a `useQuery` result {@link QueryBoundary} needs — accepts the
 * full result, or a hand-built object for non-react-query async state. */
type QueryLike<T> = Pick<UseQueryResult<T>, "data" | "isLoading" | "isError" | "error"> & {
  refetch?: () => unknown;
};

/**
 * The one loading / error / empty convention for a data-bearing surface
 * (docs/development/design.md "Interaction states"): render `<QueryBoundary>` around a
 * `useQuery` and it shows a `Skeleton` while loading, a retryable
 * {@link QueryError} on failure, an `EmptyState` when the data is empty, and
 * finally `children(data)` — so pages stop hand-rolling the same four branches.
 * Route-level (thrown) failures still route to the root `RouteError`; this is
 * for the common in-body query.
 */
export function QueryBoundary<T>({
  query,
  children,
  loading,
  empty,
  isEmpty,
  errorTitle,
}: {
  query: QueryLike<T>;
  children: (data: T) => React.ReactNode;
  /** custom loading placeholder; defaults to a stack of skeleton rows */
  loading?: React.ReactNode;
  /** shown when `isEmpty(data)` is true; omit to always render `children` */
  empty?: React.ReactNode;
  isEmpty?: (data: T) => boolean;
  errorTitle?: React.ReactNode;
}) {
  if (query.isError) {
    return (
      <QueryError
        title={errorTitle}
        message={query.error instanceof Error ? query.error.message : undefined}
        onRetry={query.refetch ? () => void query.refetch?.() : undefined}
      />
    );
  }
  if (query.isLoading || query.data === undefined) {
    return <>{loading ?? <DefaultLoading />}</>;
  }
  if (empty !== undefined && isEmpty?.(query.data)) {
    return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  }
  return <>{children(query.data)}</>;
}

function DefaultLoading() {
  return (
    <div className="space-y-2" data-slot="query-loading" aria-busy>
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-2/3" />
    </div>
  );
}
