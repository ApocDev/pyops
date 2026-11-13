/**
 * Module/beacon effect aggregation (pure — shared by computeBlock and tests).
 *
 * Productivity scales a recipe's products (a real balance change, applied
 * before the solve); speed scales the machine count; consumption scales
 * power/fuel.
 *
 * Each machine's EffectReceiver prototype (Factorio 2.1) shapes the sum:
 * `base_effect` adds into it like one more module, `uses_module_effects` /
 * `uses_beacon_effects` drop modules or beacons (the TURD hidden beacon counts
 * as a beacon), and each total clamps to the receiver's `*_limits` (default
 * low -0.8, so the 0.2× floor on speed/consumption/pollution). Py's farms and
 * creature buildings use `base_effect.speed = -1` with `speed_limits.low =
 * -0.9999`: unmoduled they barely run, and each +1 speed module adds 1× (10
 * fawogae modules = 10×, not 11×). Base productivity applies even on a
 * recipe that disallows productivity (only module, beacon and TURD productivity
 * are blocked there). Productivity clamps to its limits before
 * research is added, then to [0, recipe maximum_productivity] (+300% by
 * default; Py raises it to 1e6 on nearly every recipe).
 *
 * Research-driven productivity (#92) rides along: change-recipe-productivity
 * techs add base recipe productivity that applies even when productivity
 * MODULES are not allowed (Py's microfilters-mk02 grants bhoddos-spore +100%
 * although the recipe has no allow_productivity), and mining-productivity
 * research adds an uncapped bonus on mining recipes (resources are not
 * recipes, so no maximum_productivity cap applies — in-game mining
 * productivity routinely exceeds +300%).
 */

export type EffectKind = "speed" | "productivity" | "consumption" | "pollution";

/** A machine's EffectReceiver, with the engine defaults filled in. Quality and
 * surface effects aren't modelled (Py has neither), so their parts are left out. */
export type EffectReceiver = {
  baseEffect: Record<EffectKind, number>;
  limits: Record<EffectKind, { low: number; high: number }>;
  usesModuleEffects: boolean;
  usesBeaconEffects: boolean;
};

/** EffectReceiver prototype defaults (prototype-api: EffectReceiver). Machines
 * without an `effect_receiver` in the dump store null and use these. */
export const DEFAULT_EFFECT_RECEIVER: EffectReceiver = {
  baseEffect: { speed: 0, productivity: 0, consumption: 0, pollution: 0 },
  limits: {
    speed: { low: -0.8, high: 1000 },
    productivity: { low: -0.8, high: 1000 },
    consumption: { low: -0.8, high: 1000 },
    pollution: { low: -0.8, high: 1000 },
  },
  usesModuleEffects: true,
  usesBeaconEffects: true,
};

export type BeaconConfig = {
  beacon: string;
  modules: string[];
  /** beacons affecting each machine */
  count: number;
  /** machines each beacon building serves (absent/1 = one beacon per machine) */
  shared?: number;
};

export type Effects = {
  speedBonus: number;
  prodBonus: number;
  consBonus: number;
  speedMult: number;
  prodMult: number;
  consMult: number;
  /** pollution effect multiplier (#23) — clamps like consumption */
  pollutionMult: number;
  beaconPowerPerMachineW: number;
};

export type ModuleEff = {
  effSpeed: number;
  effProductivity: number;
  effConsumption: number;
  effPollution?: number;
};
export type BeaconEff = {
  distributionEffectivity: number | null;
  moduleSlots: number;
  energyUsageW: number | null;
  profile: number[] | null;
};

/** Research-driven productivity for one recipe row (#92). */
export type ResearchProductivity = {
  /** change-recipe-productivity sum — applies regardless of allowProductivity */
  recipeProd: number;
  /** mining-productivity research sum — mining recipes only, exempt from the cap */
  miningProd: number;
  /** recipe maximum_productivity (null = engine default +300%) */
  maxProductivity: number | null;
};

function sumEffects(names: string[], moduleDb: Map<string, ModuleEff>) {
  const s = { speed: 0, prod: 0, cons: 0, poll: 0 };
  for (const n of names) {
    const m = moduleDb.get(n);
    if (!m) continue;
    s.speed += m.effSpeed;
    s.prod += m.effProductivity;
    s.cons += m.effConsumption;
    s.poll += m.effPollution ?? 0;
  }
  return s;
}

export function computeEffects(
  allowProductivity: boolean,
  machineModules: string[],
  beaconCfgs: BeaconConfig[],
  moduleDb: Map<string, ModuleEff>,
  beaconDb: Map<string, BeaconEff>,
  // game-inserted module effects (Py TURD hidden beacon, 1:1, no slot cost)
  extraModules: ModuleEff[] = [],
  research?: ResearchProductivity,
  receiver: EffectReceiver | null = null,
): Effects {
  const rx = receiver ?? DEFAULT_EFFECT_RECEIVER;
  const own = sumEffects(rx.usesModuleEffects ? machineModules : [], moduleDb);
  let { speed, prod, cons, poll } = own;
  speed += rx.baseEffect.speed;
  cons += rx.baseEffect.consumption;
  poll += rx.baseEffect.pollution;
  // the TURD bonus arrives through a hidden beacon
  for (const m of rx.usesBeaconEffects ? extraModules : []) {
    speed += m.effSpeed;
    prod += m.effProductivity;
    cons += m.effConsumption;
    poll += m.effPollution ?? 0;
  }
  let beaconPowerPerMachineW = 0;
  for (const cfg of beaconCfgs) {
    const b = beaconDb.get(cfg.beacon);
    if (!b || cfg.count <= 0) continue;
    const inBeacon = sumEffects(cfg.modules.slice(0, b.moduleSlots), moduleDb);
    // n same-type beacons: n × effectivity × profile[n] × (modules in one beacon)
    const falloff = b.profile?.length ? b.profile[Math.min(cfg.count, b.profile.length) - 1] : 1;
    const mult = rx.usesBeaconEffects ? (b.distributionEffectivity ?? 1) * falloff * cfg.count : 0;
    speed += inBeacon.speed * mult;
    prod += inBeacon.prod * mult;
    cons += inBeacon.cons * mult;
    poll += inBeacon.poll * mult;
    // Effects above are per-machine and unaffected by sharing: every machine in
    // range gets the full bonus however many neighbours also sit in it. Power is
    // a property of the BUILDING, so a shared beacon's draw splits across the
    // machines it serves — charging each one a full copy overstates a shared bank
    // by the sharing factor.
    beaconPowerPerMachineW += ((b.energyUsageW ?? 0) * cfg.count) / Math.max(1, cfg.shared ?? 1);
  }
  // a recipe that disallows productivity blocks module, beacon and TURD
  // productivity, but not the machine's base productivity: measured in game, a
  // compost-plant-mk01-turd (+0.05) on biomass-guar-seeds (productivity not
  // allowed) gained bonus_progress 0.0664 over 1.328 crafts (= 1.328 × 0.05)
  if (!allowProductivity) prod = 0;
  prod += rx.baseEffect.productivity;
  const clamp = (v: number, k: EffectKind) =>
    Math.min(rx.limits[k].high, Math.max(rx.limits[k].low, v));
  // the receiver's limit applies before research; tech-granted recipe
  // productivity applies even when modules can't (a base bonus on the recipe
  // itself), then everything clamps to [0, the recipe's cap]
  prod = clamp(prod, "productivity") + (research?.recipeProd ?? 0);
  prod = Math.max(0, Math.min(prod, research?.maxProductivity ?? 3));
  // mining-productivity research is uncapped (resources have no recipe cap)
  prod += research?.miningProd ?? 0;
  return {
    speedBonus: speed,
    prodBonus: prod,
    consBonus: cons,
    speedMult: 1 + clamp(speed, "speed"),
    prodMult: 1 + prod,
    consMult: 1 + clamp(cons, "consumption"),
    pollutionMult: 1 + clamp(poll, "pollution"),
    beaconPowerPerMachineW,
  };
}
