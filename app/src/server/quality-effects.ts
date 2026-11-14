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
  defaultMultiplier: number;
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

/** Precisions the engine floors a quality-scaled module effect to, from the
 * import: `module` for speed, productivity, consumption and pollution
 * (`module_effect_step`), `quality` for the quality effect
 * (`quality_effect_step`). Both are 0.01% in Factorio 2.1, so productivity
 * module 1 at uncommon is 4% × 1.3 = 5.2%. Before 2.1.7 the module step was
 * whole percent (5%, as YAFC-CE's `Quality.ApplyModuleBonus` still floors,
 * DataClasses.cs:916) and the quality step 0.1%. */
export type EffectSteps = { module: number; quality: number };

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
  steps: EffectSteps,
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
      steps.module,
    ),
    effProductivity: scale(
      mod.effProductivity,
      quality.moduleProductivityMultiplier,
      mod.productivityQualityMultiplier,
      steps.module,
    ),
    effConsumption: scale(
      mod.effConsumption,
      quality.moduleConsumptionMultiplier,
      mod.consumptionQualityMultiplier,
      steps.module,
    ),
    effPollution: scale(
      mod.effPollution,
      quality.modulePollutionMultiplier,
      mod.pollutionQualityMultiplier,
      steps.module,
    ),
    effQuality: scale(
      mod.effQuality,
      quality.moduleQualityMultiplier,
      mod.qualityQualityMultiplier,
      steps.quality,
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

/** Kinds that are CraftingMachinePrototypes, whose crafting speed quality
 * scales. */
const CRAFTING_KINDS = new Set(["assembling-machine", "furnace", "rocket-silo"]);

/** The synthesized power machines (`db/synthesize.ts`): boilers and heat
 * exchangers, generators (steam engines and turbines, burner generators,
 * solar panels), fuel reactors, and offshore pumps. Their `craftingSpeed` is
 * their output per building, so quality scales it and their fuel draw by the
 * quality's `default_multiplier`, as the engine scales their energy, power
 * output, fluid use and pumping speed (YAFC-CE `Entity.Power`,
 * DataClasses.cs:608-611). Mining drills and labs aren't scaled: quality
 * leaves a drill's mining speed and a lab's energy at base, and a lab's
 * research speed is the science bank's (`lab_research_speed_multiplier`). */
const POWER_KINDS = new Set(["boiler", "generator", "reactor", "offshore-pump"]);

/** A machine at `quality`. A crafting machine's speed scales by its per-quality
 * override or the quality's `crafting_machine_speed_multiplier`; its energy
 * usage and module slots change only when it opts in
 * (`quality_affects_energy_usage`, `quality_affects_module_slots`). A power
 * machine's output and energy usage scale by the quality's
 * `default_multiplier`. */
export function machineAtQuality<T extends QualityMachine>(machine: T, quality: QualityBonuses): T {
  if (quality.name === NORMAL_QUALITY) return machine;
  if (POWER_KINDS.has(machine.kind)) {
    const m = quality.defaultMultiplier;
    return {
      ...machine,
      craftingSpeed: machine.craftingSpeed == null ? null : machine.craftingSpeed * m,
      energyUsageW: machine.energyUsageW == null ? null : machine.energyUsageW * m,
    };
  }
  if (!CRAFTING_KINDS.has(machine.kind)) return machine;
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
  steps: EffectSteps,
) {
  const modules = new Map<string, ModuleEff>(moduleDb);
  const beacons = new Map<string, BeaconEff>(beaconDb);
  const moduleAt = (name: string, quality: string | undefined) => {
    const bonuses = bonusesOf(quality);
    const row = moduleDb.get(name);
    if (!bonuses || !row) return name;
    const key = qualityKey(name, bonuses.name);
    if (!modules.has(key)) modules.set(key, moduleAtQuality(row, bonuses, steps));
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
