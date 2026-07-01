/**
 * Test-only helpers: spin up a throwaway SQLite database with the REAL schema.
 *
 * The db is provisioned by applying the bundled drizzle migrations — the exact
 * same path production uses (`server/provision.ts`) — so a test db is byte-for-byte
 * what a real install gets, incremental ALTER migrations and all. Keep migrations
 * in sync with `schema.ts` via `vp run db:generate` and fixtures never drift.
 * Not imported by app code; only `*.test.ts` files use it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";
import { migrateConnection } from "../server/provision.ts";

export type TestDb = {
  /** raw better-sqlite3 handle, schema applied */
  db: Database.Database;
  /** on-disk path (so file-taking code like computeCostAnalysis can open it too) */
  file: string;
  /** close the handle and delete the temp dir */
  cleanup: () => void;
};

/** Create a fresh temp-file database migrated to the current schema. */
export async function makeTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), "pyops-test-"));
  const file = join(dir, "test.db");
  const db = new Database(file);
  migrateConnection(drizzle(db, { schema }));
  return {
    db,
    file,
    cleanup: () => {
      try {
        if (db.open) db.close();
      } catch {
        /* already closed */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
