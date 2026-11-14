/**
 * Quality reading for the importer (#265): QualityPrototype rows with the
 * Factorio 2.1 defaults filled in, the 2.0 rescale, and a recipe's
 * `can_set_quality` default. The defaults are from `QualityPrototype` and
 * `RecipePrototype` in Factorio's `doc-html/prototype-api.json`.
 */

type Raw = Record<string, Record<string, any>>;

const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Which quality scale a dump uses, and how the importer brings it to 2.1's. */
export type QualityScale = {
  /** The dump predates Factorio 2.1.7's quality rescale, so it is converted. */
  legacy: boolean;
  /** What decided `legacy`, recorded as the `quality_scale_basis` meta key. */
  basis: string;
  /** Factor for quality effects (module `effect.quality`, a receiver's
   * `base_effect.quality`): 0.1 for a legacy dump, else 1. */
  effectScale: number;
  /** Precision the engine floors a quality-scaled module's quality effect to,
   * in 2.1 units: 0.01% in 2.1, 0.1% before. Recorded as `quality_effect_step`. */
  effectStep: number;
  /** Precision the engine floors a module's other quality-scaled effects to:
   * 0.01% in 2.1 ("Module effects now have resolution of 0.01%", 2.1.7),
   * whole percent before. Recorded as `module_effect_step`. */
  moduleStep: number;
};

/** The first version on the 2.1 quality scale. 2.1.7 divided every prototype
 * quality effect by 10, multiplied `next_probability` by 10, and added
 * `chain_probability` (data/changelog.txt). */
const RESCALE_VERSION = [2, 1, 7];

/** True when `version` ("2.0.76") is older than 2.1.7; null when it doesn't parse. */
function predatesRescale(version: string): boolean | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return null;
  for (let i = 0; i < 3; i++) {
    const part = Number(m[i + 1]);
    if (part !== RESCALE_VERSION[i]) return part < RESCALE_VERSION[i];
  }
  return false;
}

/** Decide a dump's quality scale. `baseVersion` is the `base` mod version the
 * dump was taken with (the sync records it next to the dump) and decides when
 * known. Without it, fall back to the dump itself: base sets
 * `chain_probability` on `normal` from 2.1.7 on, so a `normal` without it reads
 * as the older scale. A modded 2.1 dump could drop that field, which is why the
 * version wins whenever there is one. */
export function resolveQualityScale(raw: Raw, baseVersion?: string | null): QualityScale {
  const byVersion = baseVersion ? predatesRescale(baseVersion) : null;
  const normal = raw.quality?.normal;
  const legacy = byVersion ?? (normal != null && normal.chain_probability === undefined);
  return {
    legacy,
    basis:
      byVersion != null
        ? `base ${baseVersion}`
        : "base version unknown; normal.chain_probability check",
    effectScale: legacy ? 0.1 : 1,
    effectStep: legacy ? 0.001 : 0.0001,
    moduleStep: legacy ? 0.01 : 0.0001,
  };
}

/** One `qualities` row (snake_case, ready for the insert). */
export type QualityRow = ReturnType<typeof qualityRow>;

/** A raw QualityPrototype → its `qualities` row, unset fields at their 2.1
 * defaults. In a 2.0 dump `next_probability` was 10× smaller and also served as
 * the chance of each further step, so it is scaled up and reused as the chain
 * probability (as YAFC-CE does). */
export function qualityRow(
  name: string,
  q: Record<string, unknown>,
  display: string | null,
  legacy: boolean,
) {
  const level = num(q.level, 0);
  const multiplier = num(q.default_multiplier, 1 + 0.3 * level);
  const next = num(q.next_probability, 0);
  return {
    name,
    display,
    level,
    default_multiplier: multiplier,
    next: typeof q.next === "string" ? q.next : null,
    next_probability: legacy ? next * 10 : next,
    chain_probability: legacy ? next : num(q.chain_probability, clamp01(next * 0.1)),
    hidden: q.hidden === true ? 1 : 0,
    module_speed_multiplier: num(q.module_speed_multiplier, multiplier),
    module_productivity_multiplier: num(q.module_productivity_multiplier, multiplier),
    module_consumption_multiplier: num(q.module_consumption_multiplier, multiplier),
    module_pollution_multiplier: num(q.module_pollution_multiplier, multiplier),
    module_quality_multiplier: num(q.module_quality_multiplier, multiplier),
    crafting_machine_speed_multiplier: num(q.crafting_machine_speed_multiplier, multiplier),
    crafting_machine_energy_usage_multiplier: num(q.crafting_machine_energy_usage_multiplier, 1),
    crafting_machine_module_slots_bonus: num(q.crafting_machine_module_slots_bonus, level),
    beacon_power_usage_multiplier: num(q.beacon_power_usage_multiplier, 1),
    beacon_module_slots_bonus: num(q.beacon_module_slots_bonus, level),
    lab_research_speed_multiplier: num(q.lab_research_speed_multiplier, multiplier),
    lab_module_slots_bonus: num(q.lab_module_slots_bonus, level),
    mining_drill_module_slots_bonus: num(q.mining_drill_module_slots_bonus, level),
    science_pack_drain_multiplier: num(q.science_pack_drain_multiplier, 1),
    tool_durability_multiplier: num(q.tool_durability_multiplier, 1 + level),
    science_capacity_multiplier: num(q.science_capacity_multiplier, 1 + level),
  };
}

/** ModulePrototype `<effect>_quality_multiplier` fields, or their defaults
 * when unset: 1 for a beneficial effect (positive speed, productivity and
 * quality; negative consumption and pollution), else 0. */
export function moduleQualityMultipliers(
  mod: Record<string, unknown>,
  effect: Record<string, number | undefined>,
) {
  const pick = (key: string, beneficial: boolean) => num(mod[key], beneficial ? 1 : 0);
  return {
    speed_quality_multiplier: pick("speed_quality_multiplier", (effect.speed ?? 0) > 0),
    productivity_quality_multiplier: pick(
      "productivity_quality_multiplier",
      (effect.productivity ?? 0) > 0,
    ),
    consumption_quality_multiplier: pick(
      "consumption_quality_multiplier",
      (effect.consumption ?? 0) < 0,
    ),
    pollution_quality_multiplier: pick("pollution_quality_multiplier", (effect.pollution ?? 0) < 0),
    quality_quality_multiplier: pick("quality_quality_multiplier", (effect.quality ?? 0) > 0),
  };
}

/** RecipePrototype.can_set_quality, or its default when unset: true for a
 * parameter recipe or one with an item ingredient that sets none of
 * `quality_min`, `quality_max` and `quality_change`. So a recipe with only
 * fluid ingredients runs at normal only. */
export function canSetQuality(
  r: Record<string, unknown>,
  ingredients: { type?: string; [k: string]: unknown }[],
): boolean {
  if (typeof r.can_set_quality === "boolean") return r.can_set_quality;
  if (r.parameter === true) return true;
  return ingredients.some(
    (c) =>
      (c.type ?? "item") === "item" &&
      c.quality_min === undefined &&
      c.quality_max === undefined &&
      c.quality_change === undefined,
  );
}
