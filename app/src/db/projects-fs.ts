/**
 * File-derived project model. Each project is a sqlite file under `projects/`
 * (`projects/<id>.db`); the file *is* the project, and it self-describes its name
 * and creation time in its own `meta` table. The only app-level bit — which
 * project is active — lives in `app-config.json`. There is no `projects.json`
 * registry anymore (a one-time migration retires it).
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

import { readAppConfig, writeAppConfig } from "../server/app-config.ts";

export const PROJECTS_DIR = "projects";
export const DEFAULT_ID = "default";
const REMOVED_DIR = join(PROJECTS_DIR, "_removed");

export const fileForProject = (id: string) => join(PROJECTS_DIR, `${id}.db`);

/** Read a project's self-describing meta (name / createdAt) from its db file. */
export function readProjectMeta(file: string): { name?: string; createdAt?: string } {
  try {
    const d = new Database(file, { readonly: true, fileMustExist: true });
    try {
      const rows = d
        .prepare("SELECT key, value FROM meta WHERE key IN ('project_name','project_created_at')")
        .all() as { key: string; value: string | null }[];
      const m = new Map(rows.map((r) => [r.key, r.value ?? undefined]));
      return { name: m.get("project_name"), createdAt: m.get("project_created_at") };
    } finally {
      d.close();
    }
  } catch {
    return {};
  }
}

/** Write a project's name / createdAt into its own db meta. */
export function writeProjectMeta(file: string, name?: string, createdAt?: string) {
  const d = new Database(file);
  try {
    const up = d.prepare(
      "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    );
    if (name !== undefined) up.run("project_name", name);
    if (createdAt !== undefined) up.run("project_created_at", createdAt);
  } finally {
    d.close();
  }
}

let migrated = false;
/** One-time migration to the file-derived model. Best-effort and guarded so it can
 * be called from anywhere that's about to touch projects:
 *  1. move legacy `dev.db` -> `projects/default.db` (atomic rename, data preserved);
 *  2. import any `projects.json` names into each db's meta + `active` into app-config;
 *  3. back `projects.json` up to `.bak` (kept, not deleted);
 *  4. ensure the default project has a name. */
export function migrateProjectsOnce() {
  if (migrated) return;
  migrated = true;
  try {
    const defaultFile = fileForProject(DEFAULT_ID);
    if (!existsSync(defaultFile) && existsSync("dev.db")) {
      mkdirSync(PROJECTS_DIR, { recursive: true });
      for (const suf of ["", "-wal", "-shm"]) {
        if (existsSync("dev.db" + suf)) renameSync("dev.db" + suf, defaultFile + suf);
      }
    }
    if (existsSync("projects.json")) {
      try {
        const reg = JSON.parse(readFileSync("projects.json", "utf8")) as {
          active?: string;
          projects?: { id: string; name?: string; dbFile?: string; createdAt?: string }[];
        };
        for (const p of reg.projects ?? []) {
          const file = p.id === DEFAULT_ID ? defaultFile : (p.dbFile ?? fileForProject(p.id));
          if (existsSync(file)) writeProjectMeta(file, p.name, p.createdAt);
        }
        if (reg.active && !readAppConfig().active) writeAppConfig({ active: reg.active });
      } catch {
        /* ignore a malformed registry */
      }
      renameSync("projects.json", "projects.json.bak");
    }
    if (existsSync(defaultFile) && !readProjectMeta(defaultFile).name) {
      writeProjectMeta(defaultFile, "Default", new Date(0).toISOString());
    }
  } catch {
    /* never block startup on migration */
  }
}

/** The active project's db file: app-config.active -> its file, else the default. */
export function activeProjectFile(): string {
  migrateProjectsOnce();
  const id = readAppConfig().active ?? DEFAULT_ID;
  const file = fileForProject(id);
  return existsSync(file) ? file : fileForProject(DEFAULT_ID);
}

export type ProjectInfo = { id: string; name: string; file: string; createdAt: string };

/** List projects by scanning `projects/` for `*.db` files; each one self-describes
 * its name. Default first, then by name. */
export function listProjectFiles(): ProjectInfo[] {
  migrateProjectsOnce();
  const out: ProjectInfo[] = [];
  try {
    mkdirSync(PROJECTS_DIR, { recursive: true });
    for (const f of readdirSync(PROJECTS_DIR)) {
      if (!f.endsWith(".db")) continue;
      const file = join(PROJECTS_DIR, f);
      if (!statSync(file).isFile()) continue;
      const id = f.slice(0, -3);
      const m = readProjectMeta(file);
      out.push({
        id,
        name: m.name ?? (id === DEFAULT_ID ? "Default" : id),
        file,
        createdAt: m.createdAt ?? statSync(file).mtime.toISOString(),
      });
    }
  } catch {
    /* ignore */
  }
  out.sort((a, b) =>
    a.id === DEFAULT_ID ? -1 : b.id === DEFAULT_ID ? 1 : a.name.localeCompare(b.name),
  );
  return out;
}

/** Move a project's db out of the active set (kept on disk under `_removed/`, so
 * it's recoverable rather than hard-deleted). */
export function removeProjectFiles(id: string) {
  mkdirSync(REMOVED_DIR, { recursive: true });
  const file = fileForProject(id);
  for (const suf of ["", "-wal", "-shm"]) {
    if (existsSync(file + suf)) renameSync(file + suf, join(REMOVED_DIR, `${id}.db${suf}`));
  }
}
