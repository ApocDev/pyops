/**
 * What an entity's quality does to it (#266), from the imported QualityPrototype
 * multipliers (#265) rather than YAFC-CE's hard-coded 0.3 and 0.2 per level.
 * Pure: computeBlock looks the rows up and applies these before the solve. At
 * normal every function returns its input unchanged, so Py (normal only) never
 * sees a difference.
 */
import { NORMAL_QUALITY, qualityKey } from "../lib/quality.ts";
import type { BeaconConfig, BeaconEff, ModuleEff } from "./effects.ts";

/** The QualityPrototype fields these functions read. */
export type QualityBonuses = {
  name: string;
  level: number;
  moduleSpeedMultiplier: number;
  moduleProductivityMultiplier: number;
  moduleConsumptionMultiplier: number;
  modulePollutionMultiplier: number;
  moduleQualityMultiplier: number;
  craftingMachineSpeedMultiplier: number;
  craftingMachineEnergyUsageMultiplier: number;
  craftingMachineModuleSlotsBonus: number;
  beaconPowerUsageMultiplier: number;
  beaconModuleSlotsBonus: number;
};

/** A module row with its ModulePrototype `<effect>_quality_multiplier` fields. */
export type QualityModule = ModuleEff & {
  effPollution: number;
  effQuality: number;
  speedQualityMultiplier: number;
  productivityQualityMultiplier: number;
  consumptionQualityMultiplier: number;
  pollutionQualityMultiplier: number;
  qualityQualityMultiplier: number;
};

/** Precision the engine floors a quality-scaled module effect to: whole
 * percent, as YAFC-CE does (`Quality.ApplyModuleBonus`, DataClasses.cs:916:
 * productivity module 1 at uncommon is 4% × 1.3 = 5.2% → 5%). The quality
 * effect uses the import's `quality_effect_step` (0.01% in 2.1). */
const MODULE_EFFECT_STEP = 0.01;

/** Floors to a multiple of `step`; the nudge keeps float noise from dropping a
 * whole step (−0.3 × 1.3 is −0.39000000000000001). */
const floorTo = (v: number, step: number) =>
  Number((Math.floor(v / step + 1e-9) * step).toFixed(10));

/**
 * A module's effects at `quality`. Each effect is scaled by the quality's
 * module multiplier for that effect, weighted by the module's own
 * `<effect>_quality_multiplier`: 1 takes the full multiplier, 0 none (the
 * prototype default for a penalty, so a quality module's speed penalty stays
 * −5%). Scaled values floor to the engine's precision (YAFC-CE
 * `ModuleSpecification`, DataClasses.cs:1193-1197, which scales only the
 * beneficial side). Legendary quality module 3: 0.025 × 2.5 = 6.25%.
 */
export function moduleAtQuality<M extends QualityModule>(
  mod: M,
  quality: QualityBonuses,
  qualityStep: number,
): M {
  if (quality.name === NORMAL_QUALITY) return mod;
  const scale = (value: number, multiplier: number, weight: number, step: number) => {
    const factor = 1 + (multiplier - 1) * weight;
    return value === 0 || factor === 1 ? value : floorTo(value * factor, step);
  };
  return {
    ...mod,
    effSpeed: scale(
      mod.effSpeed,
      quality.moduleSpeedMultiplier,
      mod.speedQualityMultiplier,
      MODULE_EFFECT_STEP,
    ),
    effProductivity: scale(
      mod.effProductivity,
      quality.moduleProductivityMultiplier,
      mod.productivityQualityMultiplier,
      MODULE_EFFECT_STEP,
    ),
    effConsumption: scale(
      mod.effConsumption,
      quality.moduleConsumptionMultiplier,
      mod.consumptionQualityMultiplier,
      MODULE_EFFECT_STEP,
    ),
    effPollution: scale(
      mod.effPollution,
      quality.modulePollutionMultiplier,
      mod.pollutionQualityMultiplier,
      MODULE_EFFECT_STEP,
    ),
    effQuality: scale(
      mod.effQuality,
      quality.moduleQualityMultiplier,
      mod.qualityQualityMultiplier,
      qualityStep,
    ),
  };
}

/** A beacon row with its quality fields. */
export type QualityBeacon = BeaconEff & {
  qualityAffectsModuleSlots: boolean;
  distributionEffectivityBonusPerQualityLevel: number;
};

/** A beacon at `quality`: distribution effectivity gains the prototype's
 * per-level bonus (YAFC-CE hard-codes 0.2, DataClasses.cs:918), power scales
 * by `beacon_power_usage_multiplier` (DataClasses.cs:611), and slots gain
 * `beacon_module_slots_bonus` when the beacon opts in. */
export function beaconAtQuality<B extends QualityBeacon>(beacon: B, quality: QualityBonuses): B {
  if (quality.name === NORMAL_QUALITY) return beacon;
  return {
    ...beacon,
    distributionEffectivity:
      (beacon.distributionEffectivity ?? 1) +
      beacon.distributionEffectivityBonusPerQualityLevel * quality.level,
    energyUsageW:
      beacon.energyUsageW == null ? null : beacon.energyUsageW * quality.beaconPowerUsageMultiplier,
    moduleSlots:
      beacon.moduleSlots + (beacon.qualityAffectsModuleSlots ? quality.beaconModuleSlotsBonus : 0),
  };
}

/** A crafting machine row with its quality fields. */
export type QualityMachine = {
  kind: string;
  craftingSpeed: number | null;
  energyUsageW: number | null;
  moduleSlots: number;
  qualityAffectsModuleSlots: boolean;
  qualityAffectsEnergyUsage: boolean;
  craftingSpeedQualityMultiplier: Record<string, number> | null;
  energyUsageQualityMultiplier: Record<string, number> | null;
  moduleSlotsQualityBonus: Record<string, number> | null;
};

/** Kinds that are CraftingMachinePrototypes, the only machines whose crafting
 * speed quality scales. The synthesized drills, labs, boilers and generators
 * keep their base values (YAFC-CE excludes drills too, DataClasses.cs:809-810). */
const CRAFTING_KINDS = new Set(["assembling-machine", "furnace", "rocket-silo"]);

/** A crafting machine at `quality`: crafting speed scales by the machine's
 * per-quality override or the quality's `crafting_machine_speed_multiplier`;
 * energy usage and module slots change only when the machine opts in
 * (`quality_affects_energy_usage`, `quality_affects_module_slots`). */
export function machineAtQuality<T extends QualityMachine>(machine: T, quality: QualityBonuses): T {
  if (quality.name === NORMAL_QUALITY || !CRAFTING_KINDS.has(machine.kind)) return machine;
  const speed =
    machine.craftingSpeedQualityMultiplier?.[quality.name] ??
    quality.craftingMachineSpeedMultiplier;
  const energy = machine.qualityAffectsEnergyUsage
    ? (machine.energyUsageQualityMultiplier?.[quality.name] ??
      quality.craftingMachineEnergyUsageMultiplier)
    : 1;
  const slots = machine.qualityAffectsModuleSlots
    ? (machine.moduleSlotsQualityBonus?.[quality.name] ?? quality.craftingMachineModuleSlotsBonus)
    : 0;
  return {
    ...machine,
    craftingSpeed: machine.craftingSpeed == null ? null : machine.craftingSpeed * speed,
    energyUsageW: machine.energyUsageW == null ? null : machine.energyUsageW * energy,
    moduleSlots: machine.moduleSlots + slots,
  };
}

/**
 * Module and beacon lookups that understand quality: `moduleAt(name, quality)`
 * returns the key computeEffects should read, adding the scaled module under
 * its quality key (`quality-module-3@legendary`) on first use, and `beaconAt`
 * does the same for beacons. Normal, or a quality `bonusesOf` doesn't know,
 * returns the bare name, so the maps read exactly as the plain ones.
 */
export function qualityEffectLookups<M extends QualityModule, B extends QualityBeacon>(
  moduleDb: ReadonlyMap<string, M>,
  beaconDb: ReadonlyMap<string, B>,
  bonusesOf: (quality: string | undefined) => QualityBonuses | null,
  qualityStep: number,
) {
  const modules = new Map<string, ModuleEff>(moduleDb);
  const beacons = new Map<string, BeaconEff>(beaconDb);
  const moduleAt = (name: string, quality: string | undefined) => {
    const bonuses = bonusesOf(quality);
    const row = moduleDb.get(name);
    if (!bonuses || !row) return name;
    const key = qualityKey(name, bonuses.name);
    if (!modules.has(key)) modules.set(key, moduleAtQuality(row, bonuses, qualityStep));
    return key;
  };
  const beaconAt = (name: string, quality: string | undefined) => {
    const bonuses = bonusesOf(quality);
    const row = beaconDb.get(name);
    if (!bonuses || !row) return name;
    const key = qualityKey(name, bonuses.name);
    if (!beacons.has(key)) beacons.set(key, beaconAtQuality(row, bonuses));
    return key;
  };
  /** A beacon config with its beacon and modules at their quality keys. */
  const beaconConfigAt = <C extends BeaconConfig>(cfg: C): C => ({
    ...cfg,
    beacon: beaconAt(cfg.beacon, cfg.quality),
    modules: cfg.modules.map((m) => moduleAt(m, cfg.moduleQuality)),
  });
  return { modules, beacons, moduleAt, beaconConfigAt };
}
