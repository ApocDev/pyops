/**
 * Companion-mod installer: link or copy the repo's mod/ into the Factorio mods
 * folder so the in-game bridge mod loads. Node-only (fs/os/path) — imported
 * dynamically from the server fns so it never reaches the client bundle.
 *
 * Two install methods, surfaced to the user:
 *  - symlink (recommended): the installed mod tracks the repo — pull and it
 *    updates. On Windows we use a directory *junction*, which (unlike a real
 *    symlink) needs no admin / Developer Mode and Factorio follows it the same.
 *  - copy: a plain snapshot in the mods folder; must be re-copied after updates.
 *
 * The target is always <mods>/pyops (the folder name must equal the mod's
 * info.json name). We only ever remove a target we can prove is ours (a symlink,
 * or a directory whose info.json says name "pyops").
 */
import { cp, lstat, mkdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

import { MOD_SOURCE_DIR } from "./paths.server.ts";

const FACTORIO_DATA = process.env.FACTORIO_DATA_DIR ?? join(homedir(), ".factorio");
const MODS_DIR = join(FACTORIO_DATA, "mods");
// the bundled mod source (sibling mod/ dir in the source tree; overridable for a
// packaged build via PYOPS_MOD_DIR — see server/paths.ts)
const SOURCE_DIR = MOD_SOURCE_DIR;
const TARGET = join(MODS_DIR, "pyops");

export type CompanionPlatform = "linux" | "mac" | "windows" | "other";
export type InstallMethod = "symlink" | "copy";

function detectPlatform(): CompanionPlatform {
  switch (platform()) {
    case "linux":
      return "linux";
    case "darwin":
      return "mac";
    case "win32":
      return "windows";
    default:
      return "other";
  }
}

async function readVersion(dir: string): Promise<string | null> {
  try {
    const info = JSON.parse(await readFile(join(dir, "info.json"), "utf8")) as { version?: string };
    return info.version ?? null;
  } catch {
    return null;
  }
}

export type CompanionStatus = {
  platform: CompanionPlatform;
  modsDir: string;
  sourceDir: string;
  /** A directory junction is used for "symlink" on Windows — no admin needed. */
  symlinkIsJunction: boolean;
  installed: boolean;
  method: InstallMethod | null;
  /** A symlink/junction that resolves to our mod source (vs. a dangling/foreign link). */
  linkedToSource: boolean;
  sourceVersion: string | null;
  installedVersion: string | null;
  /** symlink → resolves to source; copy → versions match. */
  upToDate: boolean;
};

export async function companionStatus(): Promise<CompanionStatus> {
  const platformName = detectPlatform();
  const sourceVersion = await readVersion(SOURCE_DIR);

  let installed = false;
  let method: InstallMethod | null = null;
  let linkedToSource = false;
  let installedVersion: string | null = null;

  if (existsSync(TARGET)) {
    installed = true;
    const st = await lstat(TARGET);
    if (st.isSymbolicLink()) {
      method = "symlink";
      try {
        linkedToSource = (await realpath(TARGET)) === (await realpath(SOURCE_DIR));
      } catch {
        linkedToSource = false; // dangling link
      }
    } else {
      method = "copy";
    }
    installedVersion = await readVersion(TARGET); // follows the link for symlinks
  }

  const upToDate =
    method === "symlink"
      ? linkedToSource
      : method === "copy"
        ? installedVersion != null && installedVersion === sourceVersion
        : false;

  return {
    platform: platformName,
    modsDir: MODS_DIR,
    sourceDir: SOURCE_DIR,
    symlinkIsJunction: platformName === "windows",
    installed,
    method,
    linkedToSource,
    sourceVersion,
    installedVersion,
    upToDate,
  };
}

/** Remove an existing <mods>/pyops only if we can prove it's ours — a symlink, or
 * a directory whose info.json declares name "pyops". Refuses anything else. */
async function removeExisting(): Promise<void> {
  if (!existsSync(TARGET)) return;
  const st = await lstat(TARGET);
  if (st.isSymbolicLink()) {
    await rm(TARGET, { force: true });
    return;
  }
  let name: string | undefined;
  try {
    name = (JSON.parse(await readFile(join(TARGET, "info.json"), "utf8")) as { name?: string })
      .name;
  } catch {
    throw new Error(`${TARGET} exists but has no readable info.json — remove it by hand`);
  }
  if (name !== "pyops") {
    throw new Error(
      `${TARGET} exists and isn't the PyOps mod (name "${name}") — remove it by hand`,
    );
  }
  await rm(TARGET, { recursive: true, force: true });
}

export async function installCompanion(method: InstallMethod): Promise<CompanionStatus> {
  if (!existsSync(SOURCE_DIR)) throw new Error(`mod source not found at ${SOURCE_DIR}`);
  await mkdir(MODS_DIR, { recursive: true });
  await removeExisting();
  if (method === "symlink") {
    // junction on Windows (no admin/Developer Mode needed); dir symlink elsewhere
    await symlink(SOURCE_DIR, TARGET, platform() === "win32" ? "junction" : "dir");
  } else {
    await cp(SOURCE_DIR, TARGET, { recursive: true });
  }
  return companionStatus();
}

export async function uninstallCompanion(): Promise<CompanionStatus> {
  await removeExisting();
  return companionStatus();
}
