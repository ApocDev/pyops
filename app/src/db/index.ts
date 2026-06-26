import { drizzle } from "drizzle-orm/better-sqlite3";

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
    connections.set(file, c);
  }
  return c;
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
