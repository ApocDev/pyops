import {
  DEFAULT_EFFECT_RECEIVER,
  type EffectKind,
  type EffectReceiver,
} from "../server/effects.ts";

const KINDS: EffectKind[] = ["speed", "productivity", "consumption", "pollution"];
const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);

/** The dump's `effect_receiver` (EffectReceiver prototype), every field optional. */
type RawReceiver = {
  base_effect?: Partial<Record<EffectKind, unknown>>;
  uses_module_effects?: unknown;
  uses_beacon_effects?: unknown;
} & Partial<Record<`${EffectKind}_limits`, { low?: unknown; high?: unknown }>>;

/** A crafting machine's or mining drill's raw `effect_receiver` → the JSON
 * stored in `crafting_machines.effect_receiver`, with unset fields at their
 * prototype defaults. Null when the prototype has none (all defaults). */
export function parseEffectReceiver(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawReceiver;
  const d = DEFAULT_EFFECT_RECEIVER;
  const rx: EffectReceiver = {
    baseEffect: Object.fromEntries(
      KINDS.map((k) => [k, num(r.base_effect?.[k], d.baseEffect[k])]),
    ) as EffectReceiver["baseEffect"],
    limits: Object.fromEntries(
      KINDS.map((k) => [
        k,
        {
          low: num(r[`${k}_limits`]?.low, d.limits[k].low),
          high: num(r[`${k}_limits`]?.high, d.limits[k].high),
        },
      ]),
    ) as EffectReceiver["limits"],
    usesModuleEffects: r.uses_module_effects !== false,
    usesBeaconEffects: r.uses_beacon_effects !== false,
  };
  return JSON.stringify(rx);
}
