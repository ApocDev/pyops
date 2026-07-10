/**
 * Database provisioning: bring a project's sqlite file up to the current schema by
 * applying the bundled drizzle migrations in-process. The schema lives entirely in
 * `drizzle/`, so provisioning a database needs no dev tooling (drizzle-kit) on the
 * machine — a packaged build is self-contained.
 *
 * Works on a brand-new (empty) file and on one whose tables already exist: the
 * baseline migration uses `CREATE TABLE/INDEX IF NOT EXISTS`, so applying it to a
 * populated db records the migration as applied without touching existing tables.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import * as schema from "../db/schema.ts";
import { MIGRATIONS_DIR } from "./paths.server.ts";

export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

/** Apply the connection-local policy shared by every project handle.
 *
 * WAL lets readers continue while the single SQLite writer commits. NORMAL is
 * the documented durability/performance balance for WAL: transactions remain
 * atomic and consistent, while a power loss may discard only the most recent
 * committed transaction. A short busy timeout absorbs transient contention
 * between the app, data importer, backups, and desktop lifecycle operations.
 *
 * Deliberately leave cache_size, temp_store, mmap_size, and wal_autocheckpoint
 * at SQLite's defaults. They need workload/platform evidence and would otherwise
 * create another memory budget to reason about. Read-only handles get the timeout
 * and integrity policy without trying to change persistent journal settings. */
export function configureSqliteConnection(
  sqlite: Database.Database,
  options: { readonly?: boolean } = {},
): void {
  sqlite.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  sqlite.pragma("foreign_keys = ON");
  if (!options.readonly) {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("synchronous = NORMAL");
  }
}

/** Apply pending migrations to an already-open drizzle connection (used on the hot
 * path in `db/index.ts`, where the connection is cached and reused). Idempotent. */
export function migrateConnection(db: ReturnType<typeof drizzle<typeof schema>>): void {
  configureSqliteConnection(db.$client);
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

/** Create (if needed) and migrate a db file to the current schema, then close.
 * Used when provisioning a freshly-created project before anything writes to it. */
export function migrateToLatest(file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  try {
    migrateConnection(drizzle(sqlite, { schema }));
  } finally {
    sqlite.close();
  }
}
