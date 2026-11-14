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

/** The dump's `effect_receiver` (EffectReceiver prototype), every field optional. */
type RawReceiver = {
  base_effect?: Partial<Record<ReceiverEffectKind, unknown>>;
  uses_module_effects?: unknown;
  uses_beacon_effects?: unknown;
} & Partial<Record<`${ReceiverEffectKind}_limits`, { low?: unknown; high?: unknown }>>;

/** A crafting machine's or mining drill's raw `effect_receiver` → the JSON
 * stored in `crafting_machines.effect_receiver`, with unset fields at their
 * prototype defaults. Null when the prototype has none (all defaults).
 * `qualityScale` brings a 2.0 dump's quality values (the base effect and both
 * limit bounds) to the 2.1 scale (see `resolveQualityScale`). The defaults are
 * already on that scale, so only values the dump sets are scaled. */
export function parseEffectReceiver(raw: unknown, qualityScale = 1): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawReceiver;
  const d = DEFAULT_EFFECT_RECEIVER;
  const value = (v: unknown, fallback: number, k: ReceiverEffectKind) =>
    typeof v === "number" ? v * (k === "quality" ? qualityScale : 1) : fallback;
  const rx: EffectReceiver = {
    baseEffect: Object.fromEntries(
      KINDS.map((k) => [k, value(r.base_effect?.[k], d.baseEffect[k], k)]),
    ) as EffectReceiver["baseEffect"],
    limits: Object.fromEntries(
      KINDS.map((k) => [
        k,
        {
          low: value(r[`${k}_limits`]?.low, d.limits[k].low, k),
          high: value(r[`${k}_limits`]?.high, d.limits[k].high, k),
        },
      ]),
    ) as EffectReceiver["limits"],
    usesModuleEffects: r.uses_module_effects !== false,
    usesBeaconEffects: r.uses_beacon_effects !== false,
  };
  return JSON.stringify(rx);
}
