import { describe, expect, it } from "vite-plus/test";
import { computeEffects, type BeaconEff, type ModuleEff } from "./effects";

const MODS = new Map<string, ModuleEff>([
  // vanilla-ish reference values
  ["speed-module", { effSpeed: 0.4, effProductivity: 0, effConsumption: 1.0 }],
  ["productivity-module", { effSpeed: -0.25, effProductivity: 0.1, effConsumption: 1.2 }],
  ["efficiency-module", { effSpeed: 0, effProductivity: 0, effConsumption: -0.3 }],
]);

const BEACONS = new Map<string, BeaconEff>([
  // Py-style AM/FM beacon: de 1.2, 2 slots, vanilla 1/sqrt(n) profile head
  [
    "beacon-AM3-FM2",
    {
      distributionEffectivity: 1.2,
      moduleSlots: 2,
      energyUsageW: 24_000_000,
      profile: [1, 0.7071, 0.5773],
    },
  ],
]);

describe("computeEffects", () => {
  it("sums machine modules and clamps nothing in normal ranges", () => {
    const fx = computeEffects(true, ["speed-module", "productivity-module"], [], MODS, BEACONS);
    expect(fx.speedBonus).toBeCloseTo(0.15); // +0.4 − 0.25
    expect(fx.prodBonus).toBeCloseTo(0.1);
    expect(fx.consBonus).toBeCloseTo(2.2);
    expect(fx.speedMult).toBeCloseTo(1.15);
    expect(fx.prodMult).toBeCloseTo(1.1);
    expect(fx.consMult).toBeCloseTo(3.2);
  });

  it("drops productivity when the recipe does not allow it", () => {
    const fx = computeEffects(false, ["productivity-module"], [], MODS, BEACONS);
    expect(fx.prodBonus).toBe(0);
    expect(fx.prodMult).toBe(1);
    expect(fx.speedBonus).toBeCloseTo(-0.25); // side effects still apply
  });

  it("clamps consumption multiplier at 0.2", () => {
    const fx = computeEffects(
      true,
      ["efficiency-module", "efficiency-module", "efficiency-module", "efficiency-module"],
      [],
      MODS,
      BEACONS,
    );
    expect(fx.consBonus).toBeCloseTo(-1.2);
    expect(fx.consMult).toBe(0.2);
  });

  it("applies one beacon: de × profile[1] × modules", () => {
    const fx = computeEffects(
      true,
      [],
      [{ beacon: "beacon-AM3-FM2", modules: ["speed-module", "speed-module"], count: 1 }],
      MODS,
      BEACONS,
    );
    // 1 beacon × 1.2 de × profile[0]=1 × (0.4+0.4) = 0.96
    expect(fx.speedBonus).toBeCloseTo(0.96);
    expect(fx.beaconPowerPerMachineW).toBe(24_000_000);
  });

  it("applies the per-count profile falloff for stacked beacons", () => {
    const fx = computeEffects(
      true,
      [],
      [{ beacon: "beacon-AM3-FM2", modules: ["speed-module", "speed-module"], count: 2 }],
      MODS,
      BEACONS,
    );
    // 2 × 1.2 × profile[1]=0.7071 × 0.8 = 1.3576
    expect(fx.speedBonus).toBeCloseTo(2 * 1.2 * 0.7071 * 0.8, 4);
    expect(fx.beaconPowerPerMachineW).toBe(48_000_000);
  });

  it("ignores beacon modules beyond the beacon's slots and unknown names", () => {
    const fx = computeEffects(
      true,
      ["not-a-module"],
      [
        {
          beacon: "beacon-AM3-FM2",
          modules: ["speed-module", "speed-module", "speed-module"],
          count: 1,
        },
      ],
      MODS,
      BEACONS,
    );
    expect(fx.speedBonus).toBeCloseTo(0.96); // only 2 of 3 counted
  });

  it("caps productivity at +300%", () => {
    const mods = new Map<string, ModuleEff>([
      ["super", { effSpeed: 0, effProductivity: 2.5, effConsumption: 0 }],
    ]);
    const fx = computeEffects(true, ["super", "super"], [], mods, BEACONS);
    expect(fx.prodBonus).toBe(3);
    expect(fx.prodMult).toBe(4);
  });
});
