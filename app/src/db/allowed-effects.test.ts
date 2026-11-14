import { describe, expect, it } from "vite-plus/test";
import { resolveAllowedEffects } from "./allowed-effects";

describe("resolveAllowedEffects", () => {
  it("reads a missing key as the type default", () => {
    // electric-furnace has no key; in game it reports every effect false
    expect(resolveAllowedEffects(undefined, "crafting-machine")).toEqual([]);
    expect(resolveAllowedEffects(undefined, "lab")).toBeNull();
    expect(resolveAllowedEffects(undefined, "mining-drill")).toBeNull();
  });

  it("reads a dumped empty table as no effects, whatever the type", () => {
    // assembling-machine-2 and burner-mining-drill dump `{}`; both reject every effect
    expect(resolveAllowedEffects({}, "crafting-machine")).toEqual([]);
    expect(resolveAllowedEffects({}, "mining-drill")).toEqual([]);
  });

  it("keeps a list or a single string as written", () => {
    expect(resolveAllowedEffects(["speed", "consumption"], "lab")).toEqual([
      "speed",
      "consumption",
    ]);
    expect(resolveAllowedEffects("speed", "crafting-machine")).toEqual(["speed"]);
  });
});
