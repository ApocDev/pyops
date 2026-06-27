import { describe, expect, it } from "vite-plus/test";
import { modVersionsFromEntries } from "./dump.ts";

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
