import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";

import * as schema from "./schema.ts";
import { activeProjectFile } from "./projects-fs.ts";

/**
 * Per-project databases: each PyOps project (usually a different mod list)
 * is its own sqlite file under `projects/`. Which one is active lives in
 * `app-config.json` (no registry); `db` is a thin proxy that always points at the
 * active connection so the whole query layer stays untouched on project switches.
 */

export type Drizzle = ReturnType<typeof drizzle<typeof schema>>;

function activeDbFile(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return activeProjectFile();
}

const connections = new Map<string, Drizzle>();
let activeFile = activeDbFile();

function connection(file: string): Drizzle {
  let c = connections.get(file);
  if (!c) {
    c = drizzle(file, { schema });
    ensureCoreUpgrades(c);
    connections.set(file, c);
  }
  return c;
}

/**
 * Columns added to core tables after some project dbs were already provisioned.
 * `drizzle-kit push` gives brand-new dbs the full schema, but existing dbs have no
 * migrate step — so without this, selecting a newer column throws "no such column".
 * Apply each ALTER idempotently on first connect (the ALTER errors harmlessly when
 * the column already exists). Mirrors the per-feature `ensureSchema()` guards used
 * by conversations/tasks. Runs once per db file (connections are cached).
 */
function ensureCoreUpgrades(c: Drizzle) {
  for (const stmt of [sql`ALTER TABLE blocks ADD COLUMN solve_status text`]) {
    try {
      c.run(stmt);
    } catch {
      /* column already present (or table not created yet — push will include it) */
    }
  }
}

/** Point `db` at another project's database file. */
export function switchDatabase(file: string) {
  activeFile = file;
}

export function currentDatabaseFile(): string {
  return activeFile;
}

/** The active project's drizzle instance. A proxy so existing call sites
 * (`db.select()...`) transparently follow project switches. */
export const db: Drizzle = new Proxy({} as Drizzle, {
  get(_t, prop) {
    const target = connection(activeFile) as unknown as Record<PropertyKey, unknown>;
    const v = target[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
  },
});
