import { useQuery } from "@tanstack/react-query";
import { dataStatusFn, modDriftFn } from "#/server/factorio.ts";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { QueryError } from "#/components/query-error.tsx";

/** Settings → Advanced: the fingerprints and data-format versions behind the
 * Game data tab's "Stale — re-sync needed" badge, for debugging a sync. Shares
 * query keys with the Game data tab, so the data is cached across tabs. */
export function GameDataDetailsCard() {
  const status = useQuery({ queryKey: ["dataStatus"], queryFn: () => dataStatusFn() });
  const drift = useQuery({ queryKey: ["modDrift"], queryFn: () => modDriftFn() });
  const format = drift.data?.dataFormat;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Game data details</CardTitle>
      </CardHeader>
      <div className="space-y-1 px-3 pb-3 text-sm text-muted-foreground">
        {status.isPending || drift.isPending ? (
          <Skeleton className="h-14 w-full" />
        ) : status.isError || drift.isError ? (
          <QueryError
            message={(status.error ?? drift.error)?.message}
            onRetry={() => {
              void status.refetch();
              void drift.refetch();
            }}
          />
        ) : (
          <>
            <div>
              Data fingerprint:{" "}
              <span className="text-foreground">{status.data.meta.data_fingerprint ?? "—"}</span>
            </div>
            {status.data.currentFingerprint && (
              <div>
                Current mod list:{" "}
                <span className="text-foreground">{status.data.currentFingerprint}</span>
              </div>
            )}
            {format && (
              <div className={format.stale ? "text-warning" : ""}>
                Imported data format{" "}
                {format.imported == null ? "unversioned" : `v${format.imported}`} · Current reader v
                {format.current}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
