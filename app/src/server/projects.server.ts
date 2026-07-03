/**
 * Projects: each project is a separate sqlite database under `projects/`
 * (usually a different mod list). The files are the source of truth — there is no
 * registry; each db self-describes its name/createdAt in its own `meta`, and the
 * active project id lives in `app-config.json`. Switching repoints the shared `db`
 * proxy; creating provisions a fresh db with the current schema by applying the
 * bundled migrations, then the user runs a data sync to fill it.
 */
import { currentDatabaseFile, switchDatabase } from "../db/index.server.ts";
import {
  DEFAULT_ID,
  fileForProject,
  listProjectFiles,
  removeProjectFiles,
  writeProjectMeta,
} from "../db/projects-fs.ts";
import { readAppConfig, writeAppConfig } from "./app-config.server.ts";
import { migrateToLatest } from "./provision.ts";

export type Project = { id: string; name: string; dbFile: string; createdAt: string };

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";

export async function listProjects() {
  const projects: Project[] = listProjectFiles().map((p) => ({
    id: p.id,
    name: p.name,
    dbFile: p.file,
    createdAt: p.createdAt,
  }));
  // a brand-new install has no file yet — still show the default so the UI works
  if (!projects.some((p) => p.id === DEFAULT_ID)) {
    projects.unshift({
      id: DEFAULT_ID,
      name: "Default",
      dbFile: fileForProject(DEFAULT_ID),
      createdAt: new Date(0).toISOString(),
    });
  }
  const stored = readAppConfig().active ?? DEFAULT_ID;
  const active = projects.some((p) => p.id === stored) ? stored : DEFAULT_ID;
  return { active, projects, dbFile: currentDatabaseFile() };
}

/** Create a project: fresh db file with the current schema, named in its own meta,
 * registered (by virtue of existing) and switched to. Data comes from a sync. */
export async function createProject(name: string): Promise<Project> {
  const existing = new Set(listProjectFiles().map((p) => p.id));
  let id = slugify(name);
  while (existing.has(id) || id === DEFAULT_ID) id = `${id}-2`;
  const dbFile = fileForProject(id);

  // provision the schema in-process by applying the bundled drizzle migrations
  migrateToLatest(dbFile);

  const createdAt = new Date().toISOString();
  writeProjectMeta(dbFile, name, createdAt);
  writeAppConfig({ active: id });
  switchDatabase(dbFile);
  return { id, name, dbFile, createdAt };
}

export async function setActiveProject(id: string) {
  writeAppConfig({ active: id });
  switchDatabase(fileForProject(id));
  return { id };
}

/** Remove a project: its db is moved to `projects/_removed/` (kept on disk, so it's
 * recoverable) and the active project falls back to default. */
export async function removeProject(id: string) {
  if (id === DEFAULT_ID) throw new Error("the default project can't be removed");
  removeProjectFiles(id);
  if (readAppConfig().active === id) {
    writeAppConfig({ active: DEFAULT_ID });
    switchDatabase(fileForProject(DEFAULT_ID));
  }
}
