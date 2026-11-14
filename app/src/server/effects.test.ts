import { describe, expect, it } from "vite-plus/test";
import { parseEffectReceiver } from "../db/effect-receiver";
import { computeEffects, type BeaconEff, type EffectReceiver, type ModuleEff } from "./effects";

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
    expect(fx.consMult).toBeCloseTo(0.2);
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

// A real build shares a beacon between neighbouring machines. Sharing is purely a
// question of how many BUILDINGS exist: every machine in range still sits in the
// full field, so only power moves.
describe("computeEffects — beacon sharing", () => {
  const cfg = (shared?: number) => [
    { beacon: "beacon-AM3-FM2", modules: ["speed-module", "speed-module"], count: 1, shared },
  ];

  it("leaves every effect untouched — a shared beacon still fully affects each machine", () => {
    const priv = computeEffects(true, [], cfg(), MODS, BEACONS);
    const shared = computeEffects(true, [], cfg(8), MODS, BEACONS);
    expect(shared.speedBonus).toBeCloseTo(priv.speedBonus);
    expect(shared.prodBonus).toBeCloseTo(priv.prodBonus);
    expect(shared.consBonus).toBeCloseTo(priv.consBonus);
    expect(shared.pollutionMult).toBeCloseTo(priv.pollutionMult);
  });

  it("splits the building's power across the machines it serves", () => {
    const priv = computeEffects(true, [], cfg(), MODS, BEACONS);
    expect(priv.beaconPowerPerMachineW).toBeCloseTo(24_000_000);
    // one 24 MW beacon serving 8 machines costs each of them an eighth
    expect(computeEffects(true, [], cfg(8), MODS, BEACONS).beaconPowerPerMachineW).toBeCloseTo(
      3_000_000,
    );
  });

  it("treats absent, 1 and nonsense sharing as a private beacon", () => {
    const w = (shared?: number) =>
      computeEffects(true, [], cfg(shared), MODS, BEACONS).beaconPowerPerMachineW;
    expect(w(undefined)).toBeCloseTo(24_000_000);
    expect(w(1)).toBeCloseTo(24_000_000);
    expect(w(0)).toBeCloseTo(24_000_000); // never divide by zero
    expect(w(-4)).toBeCloseTo(24_000_000);
  });

  it("scales with beacons-per-machine independently of sharing", () => {
    const fx = computeEffects(
      true,
      [],
      [{ beacon: "beacon-AM3-FM2", modules: ["speed-module"], count: 3, shared: 2 }],
      MODS,
      BEACONS,
    );
    // 3 beacons each serving 2 machines → 1.5 buildings' worth of draw per machine
    expect(fx.beaconPowerPerMachineW).toBeCloseTo(36_000_000);
  });
});

// Machine base effects (#258). Receivers are real Py/base dump values
// (data-raw-dump `effect_receiver`), parsed the way the importer stores them.
describe("computeEffects — machine effect receiver", () => {
  const receiver = (raw: unknown) => JSON.parse(parseEffectReceiver(raw)!) as EffectReceiver;
  // 184 Py farms/creature buildings, e.g. assembling-machine.fawogae-plantation-mk01
  const farm = receiver({ base_effect: { speed: -1 }, speed_limits: { low: -0.9999 } });
  const FAWOGAE = new Map<string, ModuleEff>([
    // module.fawogae.effect = { speed = 1, pollution = 1 }
    ["fawogae", { effSpeed: 1, effProductivity: 0, effConsumption: 0, effPollution: 1 }],
  ]);
  const farmFx = (n: number) =>
    computeEffects(
      false,
      Array<string>(n).fill("fawogae"),
      [],
      FAWOGAE,
      BEACONS,
      [],
      undefined,
      farm,
    );

  it("adds a Py farm's base speed -1 to its creature modules", () => {
    expect(farmFx(10).speedMult).toBeCloseTo(10); // -1 + 10, not 1 + 10
    expect(farmFx(5).speedMult).toBeCloseTo(5);
  });

  it("clamps speed at the receiver's own low limit instead of 0.2", () => {
    expect(farmFx(0).speedBonus).toBe(-1);
    expect(farmFx(0).speedMult).toBeCloseTo(0.0001); // 1 + max(-0.9999, -1)
    // the default receiver keeps the engine's -0.8 floor (0.2×)
    const slow = new Map<string, ModuleEff>([
      ["slow", { effSpeed: -2, effProductivity: 0, effConsumption: 0 }],
    ]);
    expect(computeEffects(true, ["slow"], [], slow, BEACONS).speedMult).toBeCloseTo(0.2);
  });

  it("adds a Py mine's base consumption +9", () => {
    // mining-drill.salt-mine.effect_receiver = { base_effect = { consumption = 9 } }
    const fx = computeEffects(
      true,
      [],
      [],
      MODS,
      BEACONS,
      [],
      undefined,
      receiver({ base_effect: { consumption: 9 } }),
    );
    expect(fx.consMult).toBeCloseTo(10);
  });

  it("keeps base productivity on a recipe that disallows productivity", () => {
    // In game: furnace.compost-plant-mk01-turd (base_effect.productivity = 0.05)
    // running biomass-guar-seeds (allowed_effects.productivity = false) showed
    // productivity_bonus 0.05 and bonus_progress 0.0664 after 1.328 crafts.
    const compost = receiver({ base_effect: { productivity: 0.05 } });
    const fx = computeEffects(false, [], [], MODS, BEACONS, [], undefined, compost);
    expect(fx.prodBonus).toBeCloseTo(0.05);
    expect(fx.prodMult).toBeCloseTo(1.05);
  });

  it("still blocks module and beacon productivity next to the base", () => {
    const compost = receiver({ base_effect: { productivity: 0.05 } });
    const prodBeacon = [{ beacon: "beacon-AM3-FM2", modules: ["productivity-module"], count: 1 }];
    const fx = computeEffects(
      false,
      ["productivity-module"],
      prodBeacon,
      MODS,
      BEACONS,
      [{ effSpeed: 0, effProductivity: 0.3, effConsumption: 0 }],
      undefined,
      compost,
    );
    expect(fx.prodBonus).toBeCloseTo(0.05); // only the base survives
  });

  it("clamps base productivity to the recipe's maximum_productivity", () => {
    const strong = receiver({ base_effect: { productivity: 5 } });
    const research = { recipeProd: 0, miningProd: 0, maxProductivity: 3 };
    expect(computeEffects(false, [], [], MODS, BEACONS, [], research, strong).prodBonus).toBe(3);
  });

  it("ignores modules, beacons and the TURD beacon on a machine that doesn't use them", () => {
    // base assembling-machine-1 / stone-furnace
    const am1 = receiver({ uses_module_effects: false, uses_beacon_effects: false });
    const beacon = [
      { beacon: "beacon-AM3-FM2", modules: ["speed-module", "speed-module"], count: 1 },
    ];
    const turd = [{ effSpeed: 0.5, effProductivity: 0, effConsumption: 0 }];
    const fx = computeEffects(true, ["speed-module"], beacon, MODS, BEACONS, turd, undefined, am1);
    expect(fx.speedMult).toBe(1);
    expect(fx.consMult).toBe(1);
  });
});

// What a receiver accepts (#283). Values are Py dump data; outcomes were
// measured in game against `entity.effects`.
describe("computeEffects — receiver allowed effects and module categories", () => {
  const PY_MODS = new Map<string, ModuleEff>([
    ["speed-module-3", { effSpeed: 1, effProductivity: 0, effConsumption: 1.5, category: "speed" }],
    [
      "efficiency-module-3",
      { effSpeed: 0, effProductivity: 0, effConsumption: -0.5, category: "efficiency" },
    ],
    [
      "productivity-module-3",
      { effSpeed: -0.75, effProductivity: 0.3, effConsumption: 2, category: "productivity" },
    ],
    [
      "sap-tree",
      { effSpeed: 1, effProductivity: 0, effConsumption: 0, effPollution: 1, category: "sap-mk01" },
    ],
  ]);
  const PY_BEACONS = new Map<string, BeaconEff>([
    [
      "beacon",
      { distributionEffectivity: 1.5, moduleSlots: 2, energyUsageW: 480_000, profile: null },
    ],
  ]);
  const beacon = (...modules: string[]) => [{ beacon: "beacon", modules, count: 1 }];
  const ANY_CATEGORY = ["productivity", "speed", "efficiency", "quality"];
  const fx = (
    accepts: { allowedEffects: string[] | null; allowedModuleCategories: string[] | null },
    modules: string[],
    beacons: ReturnType<typeof beacon>,
  ) => computeEffects(true, modules, beacons, PY_MODS, PY_BEACONS, [], undefined, null, accepts);

  it("ignores a speed or efficiency beacon on assembling-machine-2, which allows no effects", () => {
    const am2 = { allowedEffects: [], allowedModuleCategories: ANY_CATEGORY };
    for (const mod of ["speed-module-3", "efficiency-module-3"]) {
      const r = fx(am2, [], beacon(mod, mod));
      expect(r.speedMult).toBe(1);
      expect(r.consMult).toBe(1);
      expect(r.beaconPowerPerMachineW).toBe(480_000); // it still draws power
    }
  });

  it("applies the same speed beacon to chemical-plant: speed +3, consumption +4.5", () => {
    const chem = { allowedEffects: null, allowedModuleCategories: ANY_CATEGORY };
    const r = fx(chem, [], beacon("speed-module-3", "speed-module-3"));
    expect(r.speedBonus).toBeCloseTo(3);
    expect(r.consBonus).toBeCloseTo(4.5);
  });

  it("ignores a speed beacon on the sap extractor, whose slots take only sap modules", () => {
    const sap = {
      allowedEffects: ["consumption", "speed", "pollution", "productivity"],
      allowedModuleCategories: ["sap-mk01", "sap-mk02", "sap-mk03", "sap-mk04"],
    };
    expect(fx(sap, [], beacon("speed-module-3", "speed-module-3")).speedBonus).toBe(0);
    expect(fx(sap, ["sap-tree"], []).speedBonus).toBe(1); // its own module still works
  });

  it("applies a module's disallowed harmful effects once its benefits are allowed", () => {
    // fluid-drill-mk01 allows consumption + productivity, not speed. In game a
    // de-1.5 beacon with 2 × productivity-module-3 gave productivity +0.9,
    // consumption +6 and speed -0.8 (the -2.25 clamped at the floor).
    const drill = {
      allowedEffects: ["consumption", "productivity"],
      allowedModuleCategories: null,
    };
    const r = fx(drill, [], beacon("productivity-module-3", "productivity-module-3"));
    expect(r.prodBonus).toBeCloseTo(0.9);
    expect(r.consBonus).toBeCloseTo(6);
    expect(r.speedMult).toBeCloseTo(0.2);
  });

  it("drops a TURD module whose benefit the machine does not allow", () => {
    const noSpeed = { allowedEffects: ["consumption"], allowedModuleCategories: null };
    const turd = [{ effSpeed: 0.5, effProductivity: 0, effConsumption: 0 }];
    const r = computeEffects(true, [], [], PY_MODS, PY_BEACONS, turd, undefined, null, noSpeed);
    expect(r.speedMult).toBe(1);
  });
});
