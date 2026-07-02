/**
 * Module/beacon effect aggregation (pure — shared by computeBlock and tests).
 *
 * Productivity scales a recipe's products (a real balance change, applied
 * before the solve); speed scales the machine count; consumption scales
 * power/fuel. Factorio clamps: speed and consumption multipliers bottom out
 * at 0.2, productivity caps at +300%.
 */

export type BeaconConfig = { beacon: string; modules: string[]; count: number };

export type Effects = {
  speedBonus: number;
  prodBonus: number;
  consBonus: number;
  speedMult: number;
  prodMult: number;
  consMult: number;
  /** pollution effect multiplier (#23) — clamps at 0.2 like consumption */
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
): Effects {
  const own = sumEffects(machineModules, moduleDb);
  let { speed, prod, cons, poll } = own;
  for (const m of extraModules) {
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
    const mult = (b.distributionEffectivity ?? 1) * falloff * cfg.count;
    speed += inBeacon.speed * mult;
    prod += inBeacon.prod * mult;
    cons += inBeacon.cons * mult;
    poll += inBeacon.poll * mult;
    beaconPowerPerMachineW += (b.energyUsageW ?? 0) * cfg.count;
  }
  if (!allowProductivity) prod = 0;
  prod = Math.max(0, Math.min(prod, 3));
  return {
    speedBonus: speed,
    prodBonus: prod,
    consBonus: cons,
    speedMult: Math.max(0.2, 1 + speed),
    prodMult: 1 + prod,
    consMult: Math.max(0.2, 1 + cons),
    pollutionMult: Math.max(0.2, 1 + poll),
    beaconPowerPerMachineW,
  };
}
