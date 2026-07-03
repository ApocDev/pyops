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

// Research-driven productivity (#92). Reference values are real Py dump data:
//   technology.microfilters:       change-recipe-productivity fawogae-spore +0.15
//   technology.microfilters-mk02:  change-recipe-productivity fawogae-spore +0.20,
//                                  bhoddos-spore +1.0 (bhoddos has NO allow_productivity)
//   technology.mining-productivity-1..12: mining-drill-productivity-bonus +0.1 each
//   recipe.fawogae-spore.maximum_productivity = 1000000 (Py raises ~all recipes)
describe("computeEffects — research productivity", () => {
  it("adds change-recipe-productivity on top of module productivity", () => {
    // fawogae-spore with microfilters + microfilters-mk02 researched (+0.35)
    const fx = computeEffects(true, ["productivity-module"], [], MODS, BEACONS, [], {
      recipeProd: 0.15 + 0.2,
      miningProd: 0,
      maxProductivity: 1_000_000,
    });
    expect(fx.prodBonus).toBeCloseTo(0.45); // 0.1 module + 0.35 research
    expect(fx.prodMult).toBeCloseTo(1.45);
  });

  it("applies recipe productivity even when productivity modules are not allowed", () => {
    // bhoddos-spore: allow_productivity unset, yet microfilters-mk02 grants +100%
    const fx = computeEffects(false, ["productivity-module"], [], MODS, BEACONS, [], {
      recipeProd: 1.0,
      miningProd: 0,
      maxProductivity: 1_000_000,
    });
    expect(fx.prodBonus).toBeCloseTo(1.0); // module prod dropped, tech prod kept
    expect(fx.prodMult).toBeCloseTo(2.0);
  });

  it("clamps module + recipe productivity to the recipe's maximum_productivity", () => {
    const mods = new Map<string, ModuleEff>([
      ["super", { effSpeed: 0, effProductivity: 2.5, effConsumption: 0 }],
    ]);
    // engine default cap (maxProductivity null → 3)
    const capped = computeEffects(true, ["super"], [], mods, BEACONS, [], {
      recipeProd: 1.0,
      miningProd: 0,
      maxProductivity: null,
    });
    expect(capped.prodBonus).toBe(3);
    // Py-style raised cap: same inputs pass through uncapped
    const raised = computeEffects(true, ["super"], [], mods, BEACONS, [], {
      recipeProd: 1.0,
      miningProd: 0,
      maxProductivity: 1_000_000,
    });
    expect(raised.prodBonus).toBeCloseTo(3.5);
  });

  it("adds mining productivity research beyond the cap (resources have no recipe cap)", () => {
    const mods = new Map<string, ModuleEff>([
      ["super", { effSpeed: 0, effProductivity: 2.5, effConsumption: 0 }],
    ]);
    // 12 researched mining-productivity levels × 0.1 = +1.2, on top of capped modules
    const fx = computeEffects(true, ["super", "super"], [], mods, BEACONS, [], {
      recipeProd: 0,
      miningProd: 1.2,
      maxProductivity: null,
    });
    expect(fx.prodBonus).toBeCloseTo(4.2); // 3 (capped) + 1.2 mining research
    expect(fx.prodMult).toBeCloseTo(5.2);
  });

  it("changes nothing when no research bonuses are passed", () => {
    const a = computeEffects(true, ["productivity-module"], [], MODS, BEACONS);
    const b = computeEffects(true, ["productivity-module"], [], MODS, BEACONS, [], {
      recipeProd: 0,
      miningProd: 0,
      maxProductivity: null,
    });
    expect(b).toEqual(a);
  });
});
