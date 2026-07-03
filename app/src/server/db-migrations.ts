import { createServerFn } from "@tanstack/react-start";

import { pendingDbMigrations } from "./db-migrations.server.ts";

/** Schema-migration drift check (#75): how many bundled drizzle migrations the
 * active project db hasn't applied (the dev-server "added a migration while
 * running" case — the cached connection only migrates on first connect). Cheap
 * (one tiny file read + one indexed query), so the app shell polls it and shows
 * a "restart to apply" banner when non-zero. */
export const dbMigrationsPendingFn = createServerFn({ method: "GET" }).handler(async () =>
  pendingDbMigrations(),
);
