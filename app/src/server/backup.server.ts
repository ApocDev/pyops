/**
 * Whole-project backup + restore (#82): download the active project's sqlite db
 * as a file, and install an uploaded .db as a NEW project. The download uses
 * better-sqlite3's online backup API (safe while the connection is open, WAL
 * included) into a temp file that the route streams and then deletes. An import
 * never overwrites an existing project — it always gets a fresh id (and the
 * bundled migrations upgrade an older backup on first connect, like any db).
 */
import Database from "better-sqlite3";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { currentDatabaseFile } from "../db/index.server.ts";
import {
  DEFAULT_ID,
  fileForProject,
  listProjectFiles,
  writeProjectMeta,
  readProjectMeta,
} from "../db/projects-fs.ts";
import { uniqueName } from "../lib/plan-export";
import { ensureDataDir } from "./paths.server.ts";
import { slugify } from "./projects.server.ts";
import { configureSqliteConnection, migrateToLatest } from "./provision.ts";

export type ProjectBackup = {
  /** temp file holding the consistent snapshot — stream it, then `cleanup()` */
  file: string;
  downloadName: string;
  size: number;
  cleanup: () => void;
};

/** Snapshot the ACTIVE project's db into a temp file (online backup — consistent
 * even mid-write) and describe the download. Caller streams + cleans up. */
export async function createProjectBackup(): Promise<ProjectBackup> {
  const src = currentDatabaseFile();
  // brand-new install: the active db may not have been touched yet — provision
  // it (empty, current schema) so "download backup" works from minute one
  if (!existsSync(src)) migrateToLatest(src);
  const dir = mkdtempSync(join(tmpdir(), "pyops-backup-"));
  const out = join(dir, "backup.db");
  const d = new Database(src, { readonly: true, fileMustExist: true });
  try {
    configureSqliteConnection(d, { readonly: true });
    await d.backup(out);
  } finally {
    d.close();
  }
  const id = basename(src).replace(/\.db$/, "");
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    file: out,
    downloadName: `pyops-${id}-${stamp}.db`,
    size: statSync(out).size,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// the 16-byte sqlite header prefix: "SQLite format 3" followed by a NUL
const SQLITE_MAGIC = "SQLite format 3\u0000";

function assertSqliteProjectDb(file: string) {
  const buf = Buffer.alloc(16);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buf, 0, 16, 0);
  } finally {
    closeSync(fd);
  }
  if (buf.toString("latin1") !== SQLITE_MAGIC) {
    throw new Error("that file isn't a SQLite database (.db) — expected a PyOps project backup");
  }
  const d = new Database(file, { readonly: true, fileMustExist: true });
  try {
    configureSqliteConnection(d, { readonly: true });
    const hasMeta = d
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'")
      .get();
    if (!hasMeta) {
      throw new Error("that database doesn't look like a PyOps project (no meta table)");
    }
  } finally {
    d.close();
  }
}

/** Install an uploaded db file as a NEW project: validate it, pick a fresh id
 * (never overwriting an existing project) and a de-collided display name, and
 * copy it into `projects/`. Does NOT switch the active project — the caller
 * decides (the UI offers a switch). */
export function importProjectDb(
  uploadedFile: string,
  requestedName?: string,
): { id: string; name: string } {
  assertSqliteProjectDb(uploadedFile);
  const selfName = readProjectMeta(uploadedFile).name;
  const base = requestedName?.trim() || selfName || "Imported project";

  const existing = listProjectFiles();
  const ids = new Set(existing.map((p) => p.id));
  let id = slugify(base);
  while (ids.has(id) || id === DEFAULT_ID) id = `${id}-2`;
  const name = uniqueName(base, new Set(existing.map((p) => p.name)));

  ensureDataDir();
  const dest = fileForProject(id);
  copyFileSync(uploadedFile, dest);
  writeProjectMeta(dest, name, new Date().toISOString());
  return { id, name };
}
