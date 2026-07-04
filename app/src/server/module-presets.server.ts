/**
 * Module templates (#99): compatibility filtering + default auto-apply.
 *
 * A saved preset only offers/applies where the target machine+recipe accept
 * every module in it. Rather than re-deriving Factorio's rules, compatibility
 * is checked against `modulePickerData`'s already-filtered sets — the exact
 * category (`allowed_module_categories` of machine, recipe, and beacon),
 * effect (`allowed_effects` of machine and beacon), and `allow_productivity`
 * gates the module picker itself enforces — so a template can never place a
 * module the picker wouldn't offer.
 *
 * Slot COUNT is not a compatibility gate: applying truncates the module list
 * to the machine's slots (same as the picker's manual apply), so a "prod
 * everywhere" template saved from a 4-slot machine still fits a 2-slot one.
 * A machine with no slots at all only accepts beacon-only templates.
 *
 * Default templates (`is_default`) auto-apply to NEW recipe rows: at add time
 * the first compatible default (name order) is baked into the row's stored
 * picks (see recipeDefaultsFn), exactly like favorite machines/fuels (#18) —
 * per-row overrides always win, and no compatible default means the row stays
 * unset and the module auto-fill takes over.
 */
import * as q from "../db/queries.server.ts";
import type { BeaconConfig } from "./effects";

export type PresetLoadout = { modules: string[]; beacons: BeaconConfig[] };
export type PresetCompat = { ok: true } | { ok: false; reason: string };

/** The slice of `modulePickerData` the compatibility check reads. */
export type PickerLike = {
  machine: { name: string; display: string | null; moduleSlots: number };
  allowProductivity: boolean;
  modules: { name: string }[];
  beacons: { name: string; display: string | null; modules: string[] }[];
};

/** Display + productivity for modules that might be OUTSIDE the accepted sets
 * (the picker data only carries rows for modules it accepts). */
export type ModuleFacts = ReadonlyMap<string, { display: string | null; effProductivity: number }>;

/** Is this loadout applicable to the machine+recipe the picker data describes?
 * Reasons are user-facing (localized names), for the disabled preset chips. */
export function presetCompatibility(
  preset: PresetLoadout,
  picker: PickerLike,
  facts: ModuleFacts,
): PresetCompat {
  const machineName = picker.machine.display ?? picker.machine.name;
  const disp = (n: string) => facts.get(n)?.display ?? n;
  const prodBlocked = (n: string) =>
    !picker.allowProductivity && (facts.get(n)?.effProductivity ?? 0) > 0;

  if (preset.modules.length) {
    if (picker.machine.moduleSlots <= 0)
      return { ok: false, reason: `${machineName} has no module slots` };
    const accepted = new Set(picker.modules.map((m) => m.name));
    for (const n of new Set(preset.modules)) {
      if (accepted.has(n)) continue;
      return {
        ok: false,
        reason: prodBlocked(n)
          ? `this recipe does not accept productivity (${disp(n)})`
          : `${disp(n)} does not fit ${machineName}`,
      };
    }
  }
  for (const b of preset.beacons) {
    const bk = picker.beacons.find((x) => x.name === b.beacon);
    if (!bk) return { ok: false, reason: `beacon not placeable here` };
    const accepted = new Set(bk.modules);
    for (const n of new Set(b.modules)) {
      if (accepted.has(n)) continue;
      return {
        ok: false,
        reason: prodBlocked(n)
          ? `this recipe does not accept productivity (${disp(n)})`
          : `${disp(n)} does not work in ${bk.display ?? bk.name} for ${machineName}`,
      };
    }
  }
  return { ok: true };
}

/** Facts for every module any preset references (they may fall outside the
 * picker's accepted sets, so fetch them independently). */
function factsFor(presets: PresetLoadout[]): ModuleFacts {
  const names = [
    ...new Set(presets.flatMap((p) => [...p.modules, ...p.beacons.flatMap((b) => b.modules)])),
  ];
  return new Map(q.moduleInfo(names).map((m) => [m.name, m]));
}

/** All saved presets, each annotated with its compatibility for one recipe row
 * (the modules dialog disables the incompatible ones, with the reason). */
export function presetsForRow(recipe: string, machine: string) {
  const presets = q.listModulePresets();
  const picker = q.modulePickerData(recipe, machine);
  if (!picker) {
    const compat: PresetCompat = { ok: false, reason: "unknown machine or recipe" };
    return presets.map((p) => ({ ...p, compat }));
  }
  const facts = factsFor(presets);
  return presets.map((p) => ({ ...p, compat: presetCompatibility(p, picker, facts) }));
}

/** The loadout a NEW row should start with: the first compatible default
 * preset (name order), its module list truncated to the machine's slots.
 * Null → no compatible default; the row falls back to the module auto-fill. */
export function defaultPresetLoadout(recipe: string, machine: string): PresetLoadout | null {
  const defaults = q.listModulePresets().filter((p) => p.isDefault);
  if (!defaults.length) return null;
  const picker = q.modulePickerData(recipe, machine);
  if (!picker) return null;
  const facts = factsFor(defaults);
  for (const p of defaults) {
    if (!presetCompatibility(p, picker, facts).ok) continue;
    const modules = p.modules.slice(0, Math.max(0, picker.machine.moduleSlots));
    if (!modules.length && !p.beacons.length) continue; // nothing would apply
    return { modules, beacons: p.beacons };
  }
  return null;
}
