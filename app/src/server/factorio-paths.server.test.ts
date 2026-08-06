import { describe, expect, it } from "vite-plus/test";
import {
  defaultBinCandidates,
  defaultDataDir,
  resolveFactorioPaths,
  type ResolveInput,
} from "./factorio-paths.server.ts";

const base = (over: Partial<ResolveInput> = {}): ResolveInput => ({
  platform: "linux",
  home: "/home/u",
  env: {},
  stored: {},
  exists: () => false,
  ...over,
});

describe("resolveFactorioPaths precedence", () => {
  it("falls back to the platform default when nothing is set", () => {
    const p = resolveFactorioPaths(base());
    expect(p.bin).toMatchObject({
      value: "/home/u/.local/share/Steam/steamapps/common/Factorio/bin/x64/factorio",
      source: "default",
      exists: false,
    });
    expect(p.dataDir).toMatchObject({ value: "/home/u/.factorio", source: "default" });
    expect(p.modsDir).toMatchObject({ value: "/home/u/.factorio/mods", source: "default" });
    expect(p.scriptOutputDir).toMatchObject({
      value: "/home/u/.factorio/script-output",
      source: "default",
    });
  });

  it("prefers the stored Settings value over the default", () => {
    const p = resolveFactorioPaths(
      base({
        stored: {
          factorioBin: "/opt/factorio/bin/x64/factorio",
          factorioDataDir: "/srv/factorio-data",
        },
      }),
    );
    expect(p.bin).toMatchObject({ value: "/opt/factorio/bin/x64/factorio", source: "settings" });
    expect(p.dataDir).toMatchObject({ value: "/srv/factorio-data", source: "settings" });
    // mods + script-output derive from the CONFIGURED data dir
    expect(p.modsDir.value).toBe("/srv/factorio-data/mods");
    expect(p.scriptOutputDir.value).toBe("/srv/factorio-data/script-output");
  });

  it("lets env win over both stored and default", () => {
    const p = resolveFactorioPaths(
      base({
        env: { bin: "/env/factorio", dataDir: "/env/data", modsDir: "/env/mods" },
        stored: { factorioBin: "/stored/factorio", factorioDataDir: "/stored/data" },
      }),
    );
    expect(p.bin).toMatchObject({ value: "/env/factorio", source: "env" });
    expect(p.dataDir).toMatchObject({ value: "/env/data", source: "env" });
    expect(p.modsDir).toMatchObject({ value: "/env/mods", source: "env" });
  });

  it("supports a mods dir stored independently of the data dir", () => {
    const p = resolveFactorioPaths(base({ stored: { factorioModsDir: "/elsewhere/mods" } }));
    expect(p.modsDir).toMatchObject({ value: "/elsewhere/mods", source: "settings" });
    expect(p.dataDir.source).toBe("default");
  });

  it("keeps the FACTORIO_SCRIPT_OUTPUT env override", () => {
    const p = resolveFactorioPaths(base({ env: { scriptOutputDir: "/mnt/so" } }));
    expect(p.scriptOutputDir).toMatchObject({ value: "/mnt/so", source: "env" });
  });

  it("probes bin candidates and takes the first that exists", () => {
    const steam = "/home/u/.steam/steam/steamapps/common/Factorio/bin/x64/factorio";
    const p = resolveFactorioPaths(base({ exists: (path) => path === steam }));
    expect(p.bin).toMatchObject({ value: steam, source: "default", exists: true });
  });

  it("reports exists for the chosen value, whatever its source", () => {
    const p = resolveFactorioPaths(
      base({
        stored: { factorioBin: "/gone/factorio" },
        exists: (path) => path !== "/gone/factorio",
      }),
    );
    expect(p.bin.exists).toBe(false);
  });
});

describe("per-OS defaults", () => {
  it("uses %APPDATA%\\Factorio and Program Files on Windows", () => {
    expect(defaultDataDir("win32", "C:\\Users\\u", "C:\\Users\\u\\AppData\\Roaming")).toMatch(
      /AppData[\\/]Roaming[\\/]Factorio$/,
    );
    const bins = defaultBinCandidates("win32", "C:\\Users\\u");
    expect(bins[0]).toContain("Steam\\steamapps\\common\\Factorio");
    expect(bins[1]).toContain("Program Files\\Factorio");
  });

  it("uses Application Support on macOS", () => {
    expect(defaultDataDir("darwin", "/Users/u")).toBe(
      "/Users/u/Library/Application Support/factorio",
    );
    expect(defaultBinCandidates("darwin", "/Users/u")[1]).toBe(
      "/Applications/factorio.app/Contents/MacOS/factorio",
    );
  });
});
