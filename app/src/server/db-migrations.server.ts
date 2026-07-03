/**
 * Schema-migration drift (#75): detect when the bundled drizzle migrations are
 * newer than what has been applied to the ACTIVE project db by the running
 * server. Provisioning only migrates on first connect (`db/index.server.ts`
 * caches connections), so adding a migration while the dev server runs leaves
 * the open connection on the old schema — queries silently miss the new
 * columns. The fix is a restart; this module supplies the detection behind the
 * "restart to apply" banner. Auto-applying at runtime is intentionally out of
 * scope.
 *
 * Not to be confused with `migrations.ts`, which handles Factorio mods'
 * prototype-rename migrations — a completely separate concern.
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { currentDatabaseFile, db } from "../db/index.server.ts";
import { readProjectMeta } from "../db/projects-fs.ts";
import { MIGRATIONS_DIR } from "./paths.server.ts";

/** One entry of `drizzle/meta/_journal.json`: the migration's tag (file name
 * stem) and its generation timestamp (drizzle's `folderMillis`). */
export type JournalEntry = { tag: string; when: number };

export type PendingMigrations = {
  /** Bundled migrations the active db hasn't applied. Restart to apply. */
  pending: number;
  /** Their journal tags (e.g. `0003_add_pollution`), oldest first. */
  tags: string[];
  /** The active project's display name (from its own `meta`). */
  project: string;
};

/** The rule drizzle's sqlite migrator itself uses (`SQLiteSyncDialect.migrate`):
 * a migration is applied iff its journal `when` is <= the newest `created_at`
 * recorded in `__drizzle_migrations`. Anything newer is pending. */
export function pendingEntries(journal: JournalEntry[], lastApplied: number): JournalEntry[] {
  return journal.filter((e) => e.when > lastApplied);
}

/** Read the bundled migration journal (`drizzle/meta/_journal.json`). */
export function readJournal(): JournalEntry[] {
  const raw = readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8");
  const parsed = JSON.parse(raw) as { entries?: unknown };
  if (!Array.isArray(parsed.entries)) return [];
  return parsed.entries.flatMap((e: unknown) => {
    const entry = e as { tag?: unknown; when?: unknown };
    return typeof entry.tag === "string" && typeof entry.when === "number"
      ? [{ tag: entry.tag, when: entry.when }]
      : [];
  });
}

/** Compare the bundled journal against the active project db's
 * `__drizzle_migrations` rows. Goes through the shared `db` proxy on purpose:
 * resolving it opens (and fully migrates) the connection if none exists yet, so
 * a freshly started server always reports zero — only a connection cached from
 * before new migration files appeared can be behind. Best-effort: any failure
 * reports zero rather than nagging falsely. */
export function pendingDbMigrations(): PendingMigrations {
  try {
    const file = currentDatabaseFile();
    const row = db.$client
      .prepare("SELECT MAX(created_at) AS last FROM __drizzle_migrations")
      .get() as { last: number | string | null } | undefined;
    const pending = pendingEntries(readJournal(), Number(row?.last ?? 0));
    const project = readProjectMeta(file).name ?? basename(file, ".db");
    return { pending: pending.length, tags: pending.map((e) => e.tag), project };
  } catch {
    return { pending: 0, tags: [], project: "" };
  }
}
