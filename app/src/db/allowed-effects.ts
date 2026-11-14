/** Prototype types whose `allowed_effects` default differs. */
export type EffectReceiverType = "crafting-machine" | "lab" | "mining-drill";

/** The effects a prototype receives when `allowed_effects` is missing (Factorio
 * 2.1 prototype docs). Crafting machines get none; labs get all but quality and
 * mining drills get all, both stored as null ("every effect") since quality isn't
 * modelled (Py has none). */
const DEFAULTS: Record<EffectReceiverType, string[] | null> = {
  "crafting-machine": [],
  lab: null,
  "mining-drill": null,
};

/** A prototype's raw `allowed_effects` (EffectTypeLimitation: a list, one string,
 * or absent) → the effect kinds it accepts. Null = every effect, `[]` = none.
 *
 * A present value is taken as written, including `{}` (how Lua dumps an empty
 * table): in game, Py's assembling-machine-2 and burner-mining-drill (both `{}`)
 * report every effect false. Only a missing key falls back to the type default,
 * e.g. electric-furnace (no key) also reports every effect false. */
export function resolveAllowedEffects(raw: unknown, type: EffectReceiverType): string[] | null {
  if (raw === undefined || raw === null) return DEFAULTS[type];
  if (typeof raw === "string") return [raw];
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}
