import {
  DEFAULT_EFFECT_RECEIVER,
  type EffectReceiver,
  type ReceiverEffectKind,
} from "../server/effects.ts";

const KINDS: ReceiverEffectKind[] = [
  "speed",
  "productivity",
  "consumption",
  "pollution",
  "quality",
];
const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);

/** The dump's `effect_receiver` (EffectReceiver prototype), every field optional. */
type RawReceiver = {
  base_effect?: Partial<Record<ReceiverEffectKind, unknown>>;
  uses_module_effects?: unknown;
  uses_beacon_effects?: unknown;
} & Partial<Record<`${ReceiverEffectKind}_limits`, { low?: unknown; high?: unknown }>>;

/** A crafting machine's or mining drill's raw `effect_receiver` → the JSON
 * stored in `crafting_machines.effect_receiver`, with unset fields at their
 * prototype defaults. Null when the prototype has none (all defaults).
 * `qualityScale` brings a 2.0 dump's base quality effect to the 2.1 scale
 * (see `qualityEffectScale`). */
export function parseEffectReceiver(raw: unknown, qualityScale = 1): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawReceiver;
  const d = DEFAULT_EFFECT_RECEIVER;
  const baseEffect = Object.fromEntries(
    KINDS.map((k) => [k, num(r.base_effect?.[k], d.baseEffect[k])]),
  ) as EffectReceiver["baseEffect"];
  baseEffect.quality *= qualityScale;
  const rx: EffectReceiver = {
    baseEffect,
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
