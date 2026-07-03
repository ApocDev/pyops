import { useQuery } from "@tanstack/react-query";

import { dbMigrationsPendingFn } from "../server/db-migrations";
import { Callout } from "#/components/ui/callout.tsx";

const POLL_MS = 60_000;

/** App-shell warning strip for pending schema migrations (#75): shown when the
 * running server's cached db connection predates newly bundled drizzle
 * migrations (the "added a migration while the dev server runs" case), so the
 * user knows the fix is a restart instead of chasing silently-empty queries.
 * Ambient insurance, not a primary surface — while loading, on error, or with
 * nothing pending it renders nothing. Mounted once in the root shell. */
export function DbMigrationsBanner() {
  const { data } = useQuery({
    queryKey: ["dbMigrationsPending"],
    queryFn: () => dbMigrationsPendingFn(),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
  if (!data || data.pending === 0) return null;
  return (
    <Callout tone="warning" variant="strip" className="shrink-0 border-b border-warning/40">
      {data.pending} database migration{data.pending === 1 ? "" : "s"} pending for project{" "}
      <span className="font-semibold">{data.project}</span> — restart the app to apply.
    </Callout>
  );
}
