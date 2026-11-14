import { describe, expect, it } from "vite-plus/test";
import { qualityRow } from "../db/quality-import.ts";
import { computeEffects, type BeaconEff } from "./effects.ts";
import {
  beaconAtQuality,
  machineAtQuality,
  moduleAtQuality,
  type QualityBonuses,
  type QualityModule,
} from "./quality-effects.ts";

/** A `qualities` row from the importer's own defaults, camel-cased. The raw
 * fields are Factorio 2.1's `quality/prototypes/quality.lua` and base's
 * `normal` (`base/prototypes/categories/quality.lua`). */
function bonuses(name: string, raw: Record<string, unknown>): QualityBonuses {
  const row = qualityRow(name, raw, null, false);
  return {
    name,
    level: row.level,
    moduleSpeedMultiplier: row.module_speed_multiplier,
    moduleProductivityMultiplier: row.module_productivity_multiplier,
    moduleConsumptionMultiplier: row.module_consumption_multiplier,
    modulePollutionMultiplier: row.module_pollution_multiplier,
    moduleQualityMultiplier: row.module_quality_multiplier,
    craftingMachineSpeedMultiplier: row.crafting_machine_speed_multiplier,
    craftingMachineEnergyUsageMultiplier: row.crafting_machine_energy_usage_multiplier,
    craftingMachineModuleSlotsBonus: row.crafting_machine_module_slots_bonus,
    beaconPowerUsageMultiplier: row.beacon_power_usage_multiplier,
    beaconModuleSlotsBonus: row.beacon_module_slots_bonus,
  };
}
const normal = bonuses("normal", { level: 0, next_probability: 1, chain_probability: 0.1 });
const uncommon = bonuses("uncommon", { level: 1, beacon_power_usage_multiplier: 5 / 6 });
const legendary = bonuses("legendary", { level: 5, beacon_power_usage_multiplier: 1 / 6 });
const STEP_2_1 = 0.0001;

/** Module rows as the importer writes them: base/quality `item.lua` effects,
 * `<effect>_quality_multiplier` at the prototype defaults (1 for a benefit,
 * 0 for a penalty). */
const mod = (
  effect: Partial<
    Record<"speed" | "productivity" | "consumption" | "pollution" | "quality", number>
  >,
): QualityModule => ({
  effSpeed: effect.speed ?? 0,
  effProductivity: effect.productivity ?? 0,
  effConsumption: effect.consumption ?? 0,
  effPollution: effect.pollution ?? 0,
  effQuality: effect.quality ?? 0,
  speedQualityMultiplier: (effect.speed ?? 0) > 0 ? 1 : 0,
  productivityQualityMultiplier: (effect.productivity ?? 0) > 0 ? 1 : 0,
  consumptionQualityMultiplier: (effect.consumption ?? 0) < 0 ? 1 : 0,
  pollutionQualityMultiplier: (effect.pollution ?? 0) < 0 ? 1 : 0,
  qualityQualityMultiplier: (effect.quality ?? 0) > 0 ? 1 : 0,
});
const qualityModule3 = mod({ quality: 0.025, speed: -0.05 });
const productivityModule = mod({
  productivity: 0.04,
  consumption: 0.4,
  pollution: 0.05,
  speed: -0.05,
});
const efficiencyModule = mod({ consumption: -0.3 });
const speedModule = mod({ speed: 0.2, consumption: 0.5, quality: -0.01 });

describe("moduleAtQuality", () => {
  it("leaves a normal module untouched", () => {
    expect(moduleAtQuality(productivityModule, normal, STEP_2_1)).toBe(productivityModule);
  });

  it("scales only the beneficial effects", () => {
    const q3 = moduleAtQuality(qualityModule3, legendary, STEP_2_1);
    expect(q3.effQuality).toBe(0.0625); // 0.025 × 2.5
    expect(q3.effSpeed).toBe(-0.05); // the penalty doesn't scale
    const speed = moduleAtQuality(speedModule, uncommon, STEP_2_1);
    expect(speed.effSpeed).toBe(0.26);
    expect(speed.effConsumption).toBe(0.5);
    expect(speed.effQuality).toBe(-0.01);
  });

  it("floors scaled effects to whole percent, quality to the import's step", () => {
    // YAFC-CE's own example: productivity module 1 at uncommon is 5.2% → 5%
    expect(moduleAtQuality(productivityModule, uncommon, STEP_2_1).effProductivity).toBe(0.05);
    expect(moduleAtQuality(efficiencyModule, uncommon, STEP_2_1).effConsumption).toBe(-0.39);
    expect(moduleAtQuality(efficiencyModule, legendary, STEP_2_1).effConsumption).toBe(-0.75);
    expect(moduleAtQuality(qualityModule3, uncommon, STEP_2_1).effQuality).toBe(0.0325);
    // a 2.0 dump floors quality at 0.1%
    expect(moduleAtQuality(qualityModule3, uncommon, 0.001).effQuality).toBe(0.032);
  });
});

describe("beaconAtQuality", () => {
  const beacon: BeaconEff & {
    qualityAffectsModuleSlots: boolean;
    distributionEffectivityBonusPerQualityLevel: number;
  } = {
    distributionEffectivity: 1.5,
    distributionEffectivityBonusPerQualityLevel: 0.2,
    moduleSlots: 2,
    energyUsageW: 480_000,
    profile: [1, 0.7071],
    qualityAffectsModuleSlots: false,
  };

  it("raises effectivity per level and cuts power (base `beacon`, legendary)", () => {
    const b = beaconAtQuality(beacon, legendary);
    expect(b.distributionEffectivity).toBeCloseTo(2.5);
    expect(b.energyUsageW).toBeCloseTo(80_000);
    expect(b.moduleSlots).toBe(2);
    expect(
      beaconAtQuality({ ...beacon, qualityAffectsModuleSlots: true }, legendary).moduleSlots,
    ).toBe(7);
    expect(beaconAtQuality(beacon, normal)).toBe(beacon);
  });
});

describe("machineAtQuality", () => {
  const assembler3 = {
    kind: "assembling-machine",
    craftingSpeed: 1.25,
    energyUsageW: 375_000,
    moduleSlots: 4,
    qualityAffectsModuleSlots: false,
    qualityAffectsEnergyUsage: false,
    craftingSpeedQualityMultiplier: null,
    energyUsageQualityMultiplier: null,
    moduleSlotsQualityBonus: null,
  };

  it("scales crafting speed by the quality's multiplier", () => {
    const m = machineAtQuality(assembler3, legendary);
    expect(m.craftingSpeed).toBeCloseTo(3.125);
    expect(m.energyUsageW).toBe(375_000);
    expect(m.moduleSlots).toBe(4);
  });

  it("uses the machine's per-quality overrides and opt-in flags", () => {
    const m = machineAtQuality(
      {
        ...assembler3,
        qualityAffectsEnergyUsage: true,
        qualityAffectsModuleSlots: true,
        craftingSpeedQualityMultiplier: { uncommon: 2 },
        energyUsageQualityMultiplier: { uncommon: 0.5 },
      },
      uncommon,
    );
    expect(m.craftingSpeed).toBe(2.5);
    expect(m.energyUsageW).toBe(187_500);
    expect(m.moduleSlots).toBe(5);
  });

  it("leaves mining drills and other synthesized machines alone", () => {
    const drill = { ...assembler3, kind: "mining-drill" };
    expect(machineAtQuality(drill, legendary)).toBe(drill);
  });
});

describe("computeEffects quality", () => {
  const mods = new Map([
    ["quality-module-3", qualityModule3],
    ["quality-module-3@legendary", moduleAtQuality(qualityModule3, legendary, STEP_2_1)],
    ["speed-module", speedModule],
  ]);
  const beacons = new Map<string, BeaconEff>([
    [
      "beacon",
      { distributionEffectivity: 1.5, moduleSlots: 2, energyUsageW: 480_000, profile: [1] },
    ],
  ]);

  it("sums module quality into the bonus", () => {
    const fx = computeEffects(true, Array(4).fill("quality-module-3"), [], mods, beacons);
    expect(fx.qualityBonus).toBeCloseTo(0.1);
    const legend = computeEffects(
      true,
      Array(4).fill("quality-module-3@legendary"),
      [],
      mods,
      beacons,
    );
    expect(legend.qualityBonus).toBeCloseTo(0.25);
  });

  it("floors a negative total at 0 (speed modules) and drops it when the recipe disallows quality", () => {
    const beaconed = computeEffects(
      true,
      ["quality-module-3"],
      [{ beacon: "beacon", modules: ["speed-module", "speed-module"], count: 1 }],
      mods,
      beacons,
    );
    expect(beaconed.qualityBonus).toBe(0); // 0.025 − 2 × 1.5 × 0.01 < 0
    const blocked = computeEffects(
      true,
      Array(4).fill("quality-module-3"),
      [],
      mods,
      beacons,
      [],
      undefined,
      null,
      null,
      false,
    );
    expect(blocked.qualityBonus).toBe(0);
  });
});
