/**
 * Projects: each project is a separate sqlite database under `projects/`
 * (usually a different mod list). The files are the source of truth — there is no
 * registry; each db self-describes its name/createdAt in its own `meta`, and the
 * active project id lives in `app-config.json`. Switching repoints the shared `db`
 * proxy; creating provisions a fresh db with the current schema (drizzle-kit push)
 * then the user runs a data sync to fill it.
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { currentDatabaseFile, switchDatabase } from "../db/index.ts";
import {
  DEFAULT_ID,
  fileForProject,
  listProjectFiles,
  migrateProjectsOnce,
  removeProjectFiles,
  writeProjectMeta,
} from "../db/projects-fs.ts";
import { readAppConfig, writeAppConfig } from "./app-config.ts";

const APP_DIR = process.cwd();

export type Project = { id: string; name: string; dbFile: string; createdAt: string };

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";

export async function listProjects() {
  migrateProjectsOnce();
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
  await mkdir("projects", { recursive: true });
  const dbFile = fileForProject(id);

  // provision the schema (drizzle-kit push against the new file)
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("node", ["node_modules/drizzle-kit/bin.cjs", "push", "--force"], {
      cwd: APP_DIR,
      env: { ...process.env, DATABASE_URL: dbFile },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`drizzle push failed:\n${out.slice(-1500)}`)),
    );
  });

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
