import { describe, expect, it } from "vite-plus/test";
import { type ModEntry, diffMods, modVersionsFromEntries, redumpNeeded } from "./dump.server.ts";

const mod = (name: string, version: string | null, enabled = true): ModEntry => ({
  name,
  version,
  enabled,
});

describe("modVersionsFromEntries", () => {
  it("parses versions from packed and unpacked mod entries", () => {
    const v = modVersionsFromEntries([
      "pyalienlife_3.0.10.zip",
      "aai-loaders_0.2.11.zip",
      "Krastorio2", // unpacked, no version → skipped
    ]);
    expect(v.get("pyalienlife")).toBe("3.0.10");
    expect(v.get("aai-loaders")).toBe("0.2.11");
    expect(v.has("Krastorio2")).toBe(false);
  });

  it("keeps underscores in the mod name (version is the trailing _x.y.z)", () => {
    const v = modVersionsFromEntries(["auto_manual_mode_0.0.11.zip", "auto_manual_mode_0.0.11"]);
    expect(v.get("auto_manual_mode")).toBe("0.0.11");
  });

  it("ignores non-mod files in the mods directory", () => {
    const v = modVersionsFromEntries(["mod-list.json", "mod-settings.dat", ".DS_Store"]);
    expect(v.size).toBe(0);
  });
});

describe("diffMods", () => {
  it("categorizes added / removed / enabled / disabled / version-changed", () => {
    const baseline = [
      mod("base", "2.0.55"),
      mod("pyalienlife", "3.0.10"),
      mod("old-mod", "1.0.0"),
      mod("toggled-off", "1.0.0", true),
      mod("toggled-on", "1.0.0", false),
    ];
    const current = [
      mod("base", "2.0.55"), // unchanged
      mod("pyalienlife", "3.0.11"), // version bump
      mod("new-mod", "0.1.0"), // added
      mod("toggled-off", "1.0.0", false), // on → off
      mod("toggled-on", "1.0.0", true), // off → on
    ];
    const d = diffMods(baseline, current);
    expect(d.added.map((m) => m.name)).toEqual(["new-mod"]);
    expect(d.removed.map((m) => m.name)).toEqual(["old-mod"]);
    expect(d.enabled).toEqual(["toggled-on"]);
    expect(d.disabled).toEqual(["toggled-off"]);
    expect(d.versionChanged).toEqual([{ name: "pyalienlife", from: "3.0.10", to: "3.0.11" }]);
  });

  it("reports no drift for an identical set", () => {
    const set = [mod("base", "2.0.55"), mod("pyalienlife", "3.0.10")];
    const d = diffMods(set, set);
    expect(d).toEqual({
      added: [],
      removed: [],
      enabled: [],
      disabled: [],
      versionChanged: [],
    });
  });
});

describe("redumpNeeded", () => {
  const baseline = [
    mod("base", "2.0.55"),
    mod("pyalienlife", "3.0.10"),
    mod("off-mod", "1.0", false),
  ];

  it("is false when the enabled set + versions are unchanged", () => {
    // a disabled mod's version changing is noise — the data doesn't reflect it
    const current = [
      mod("base", "2.0.55"),
      mod("pyalienlife", "3.0.10"),
      mod("off-mod", "9.9", false),
    ];
    expect(redumpNeeded(baseline, current)).toBe(false);
  });

  it("is true when an enabled mod's version changes", () => {
    const current = [
      mod("base", "2.0.55"),
      mod("pyalienlife", "3.0.11"),
      mod("off-mod", "1.0", false),
    ];
    expect(redumpNeeded(baseline, current)).toBe(true);
  });

  it("is true when a mod is enabled or disabled", () => {
    const enabledNow = [
      mod("base", "2.0.55"),
      mod("pyalienlife", "3.0.10"),
      mod("off-mod", "1.0", true),
    ];
    expect(redumpNeeded(baseline, enabledNow)).toBe(true);
  });

  it("is true when an enabled mod is added", () => {
    const current = [...baseline, mod("new-mod", "0.1.0")];
    expect(redumpNeeded(baseline, current)).toBe(true);
  });
});
