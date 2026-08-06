/**
 * Where Factorio lives on this machine: the game executable, the user-data
 * folder (mods + script-output), and the mods folder. One resolver for every
 * consumer (data sync, launch button, companion-mod installer, screenshot tool)
 * so the paths can't drift apart again.
 *
 * Per-path precedence: env var (deployment override, always wins) → value
 * stored in Settings (`app-config.json`) → per-OS default. The executable
 * default probes the usual install locations and takes the first that exists;
 * the user-data default is the fixed per-OS location Factorio itself uses.
 * Resolution happens at call time, never at module load, so a Settings change
 * takes effect immediately — no restart.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { readAppConfig } from "./app-config.server.ts";

export type FactorioPathSource = "env" | "settings" | "default";

export type ResolvedPath = {
  value: string;
  source: FactorioPathSource;
  /** Whether `value` exists on disk right now — drives the "not found" hint. */
  exists: boolean;
};

export type FactorioPaths = {
  /** The game binary, e.g. …/bin/x64/factorio(.exe). */
  bin: ResolvedPath;
  /** Factorio's user-data folder (contains `mods` and `script-output`). */
  dataDir: ResolvedPath;
  /** The folder holding mod-list.json + installed mods. */
  modsDir: ResolvedPath;
  /** Where the game writes dumps/screenshots. Derived from dataDir (no stored
   * override of its own); `FACTORIO_SCRIPT_OUTPUT` env still wins for odd installs. */
  scriptOutputDir: ResolvedPath;
};

/** Everything resolution depends on, injectable so tests cover each OS without
 * touching the real filesystem or process env. */
export type ResolveInput = {
  platform: NodeJS.Platform;
  home: string;
  /** %APPDATA% on Windows (fallback: <home>/AppData/Roaming). */
  appData?: string;
  env: { bin?: string; dataDir?: string; modsDir?: string; scriptOutputDir?: string };
  stored: { factorioBin?: string; factorioDataDir?: string; factorioModsDir?: string };
  exists: (path: string) => boolean;
};

/** Usual install locations for the game binary, most common first. */
export function defaultBinCandidates(platform: NodeJS.Platform, home: string): string[] {
  if (platform === "win32") {
    return [
      "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Factorio\\bin\\x64\\factorio.exe",
      "C:\\Program Files\\Factorio\\bin\\x64\\factorio.exe",
    ];
  }
  if (platform === "darwin") {
    return [
      join(
        home,
        "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio",
      ),
      "/Applications/factorio.app/Contents/MacOS/factorio",
    ];
  }
  return [
    join(home, ".local/share/Steam/steamapps/common/Factorio/bin/x64/factorio"),
    join(home, ".steam/steam/steamapps/common/Factorio/bin/x64/factorio"),
  ];
}

/** The fixed per-OS user-data folder Factorio itself uses. */
export function defaultDataDir(platform: NodeJS.Platform, home: string, appData?: string): string {
  if (platform === "win32") {
    return join(appData ?? join(home, "AppData", "Roaming"), "Factorio");
  }
  if (platform === "darwin") return join(home, "Library", "Application Support", "factorio");
  return join(home, ".factorio");
}

/** Pure resolution core — the exported getters below feed it the real env. */
export function resolveFactorioPaths(input: ResolveInput): FactorioPaths {
  const { platform, home, appData, env, stored, exists } = input;

  const pick = (
    envValue: string | undefined,
    storedValue: string | undefined,
    fallback: string,
  ): ResolvedPath => {
    const [value, source]: [string, FactorioPathSource] = envValue
      ? [envValue, "env"]
      : storedValue
        ? [storedValue, "settings"]
        : [fallback, "default"];
    return { value, source, exists: exists(value) };
  };

  const candidates = defaultBinCandidates(platform, home);
  const bin = pick(env.bin, stored.factorioBin, candidates.find(exists) ?? candidates[0]);
  const dataDir = pick(
    env.dataDir,
    stored.factorioDataDir,
    defaultDataDir(platform, home, appData),
  );
  const modsDir = pick(env.modsDir, stored.factorioModsDir, join(dataDir.value, "mods"));
  const scriptOutputDir = pick(
    env.scriptOutputDir,
    undefined,
    join(dataDir.value, "script-output"),
  );
  return { bin, dataDir, modsDir, scriptOutputDir };
}

/** Resolve against the real process env, stored Settings, and filesystem. */
export function factorioPaths(): FactorioPaths {
  return resolveFactorioPaths({
    platform: process.platform,
    home: homedir(),
    appData: process.env.APPDATA,
    env: {
      bin: process.env.FACTORIO_BIN,
      dataDir: process.env.FACTORIO_DATA_DIR,
      modsDir: process.env.FACTORIO_MODS_DIR,
      scriptOutputDir: process.env.FACTORIO_SCRIPT_OUTPUT,
    },
    stored: readAppConfig(),
    exists: existsSync,
  });
}

/** The value each field falls back to when neither env nor Settings set it —
 * the Settings card shows these as input placeholders. The mods default derives
 * from the EFFECTIVE data dir, so a custom data dir previews `<it>/mods`. */
export function factorioPathDefaults(): { bin: string; dataDir: string; modsDir: string } {
  const home = homedir();
  const candidates = defaultBinCandidates(process.platform, home);
  return {
    bin: candidates.find((c) => existsSync(c)) ?? candidates[0],
    dataDir: defaultDataDir(process.platform, home, process.env.APPDATA),
    modsDir: join(factorioPaths().dataDir.value, "mods"),
  };
}

export const factorioBin = (): string => factorioPaths().bin.value;
export const factorioModsDir = (): string => factorioPaths().modsDir.value;
export const factorioScriptOutputDir = (): string => factorioPaths().scriptOutputDir.value;
