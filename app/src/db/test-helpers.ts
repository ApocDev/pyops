/**
 * Test-only helpers: spin up a throwaway SQLite database with the REAL schema.
 *
 * The schema DDL is derived straight from `schema.ts` via drizzle-kit's
 * programmatic api (the same engine `db:push` uses), so fixtures never drift
 * from the production schema — change a column and the next test run builds it.
 * Not imported by app code; only `*.test.ts` files use it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import * as schema from "./schema.ts";

type MigrationSnapshot = Parameters<typeof generateSQLiteMigration>[0];

let cached: Promise<string[]> | null = null;
/** CREATE-TABLE statements for the whole schema, generated once per run. */
function schemaStatements(): Promise<string[]> {
  if (!cached) {
    cached = (async () => {
      const empty = (await generateSQLiteDrizzleJson({})) as unknown as MigrationSnapshot;
      const full = (await generateSQLiteDrizzleJson(
        schema as unknown as Record<string, unknown>,
      )) as unknown as MigrationSnapshot;
      return generateSQLiteMigration(empty, full);
    })();
  }
  return cached;
}

export type TestDb = {
  /** raw better-sqlite3 handle, schema applied */
  db: Database.Database;
  /** on-disk path (so file-taking code like computeCostAnalysis can open it too) */
  file: string;
  /** close the handle and delete the temp dir */
  cleanup: () => void;
};

/** Create a fresh temp-file database with every table from `schema.ts`. */
export async function makeTestDb(): Promise<TestDb> {
  const stmts = await schemaStatements();
  const dir = mkdtempSync(join(tmpdir(), "pyops-test-"));
  const file = join(dir, "test.db");
  const db = new Database(file);
  for (const s of stmts) db.exec(s);
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
