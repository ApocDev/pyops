/**
 * Filesystem layout for the app. Two roots, both overridable by env so a packaged
 * build can point them wherever it bundles/stores things — nothing else in the app
 * should join paths off `process.cwd()` directly.
 *
 *  - DATA_DIR     — user-writable state: the project sqlite files (`projects/`), the
 *                   generated icon atlas (`icon-data/`), and `app-config.json`.
 *                   Defaults to the working directory, which is the dev layout
 *                   (`app/projects`, `app/icon-data`, `app/app-config.json`). A
 *                   packaged build sets `PYOPS_DATA_DIR` to a per-OS user-data dir
 *                   (see `defaultUserDataDir`).
 *  - RESOURCE_DIR — read-only assets shipped WITH the app: the drizzle migrations
 *                   and the companion mod source. Defaults to the source tree; a
 *                   packaged build sets `PYOPS_RESOURCE_DIR` (or the per-asset
 *                   overrides) to where those are bundled.
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** The per-OS user-data dir a packaged build should store state in. This is *not*
 * the dev default (dev keeps state in-tree, see `DATA_DIR`) — it's exported so the
 * launcher can set `PYOPS_DATA_DIR` to it and the UI can show where data lives. */
export function defaultUserDataDir(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "pyops");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "pyops");
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "pyops");
}

/** User-writable state root: env override → in-tree working dir (dev). */
export const DATA_DIR = process.env.PYOPS_DATA_DIR ?? process.cwd();

/** Read-only shipped-asset root: env override → the app source tree (cwd is `app/`
 * in dev, so the mod is its sibling and `drizzle/` lives under it). */
export const RESOURCE_DIR = process.env.PYOPS_RESOURCE_DIR ?? process.cwd();

/** Project sqlite files live here, one `<id>.db` per project. */
export const PROJECTS_DIR = join(DATA_DIR, "projects");

/** The generated icon atlas (sheets + manifest.json), served at `/icons`. */
export const ICON_DATA_DIR = join(DATA_DIR, "icon-data");

/** Cross-project app config (active project + AI account settings), written 0600. */
export const APP_CONFIG_FILE = join(DATA_DIR, "app-config.json");

/** Bundled drizzle migrations, applied at runtime to provision/upgrade a db. */
export const MIGRATIONS_DIR = process.env.PYOPS_MIGRATIONS_DIR ?? join(RESOURCE_DIR, "drizzle");

/** Companion mod source, written into the user's Factorio mods dir on install.
 * In the source tree the mod is a sibling of `app/`. */
export const MOD_SOURCE_DIR = process.env.PYOPS_MOD_DIR ?? resolve(RESOURCE_DIR, "..", "mod");

/** Ensure the writable data dirs exist. Cheap + idempotent; call before a write. */
export function ensureDataDir(): void {
  mkdirSync(PROJECTS_DIR, { recursive: true });
  mkdirSync(ICON_DATA_DIR, { recursive: true });
}
