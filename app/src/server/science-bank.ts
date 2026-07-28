/**
 * Science-bank maths (pure — shared by the block compute path and its tests).
 *
 * A lab bank is one pool of machines with several independent input rates. The
 * labs consuming automation science are the SAME labs consuming py science 1, so
 * the pool is sized by whichever pack demands the most lab time, never by summing
 * per-pack machine counts.
 *
 * Rates are entered POST-effects — the research you want to achieve. Lab
 * productivity stretches each pack, so the pack demand the factory must actually
 * supply is the entered rate divided by the productivity multiplier. That is the
 * whole point of the block: you name the outcome, it derives the supply.
 */
import { computeEffects, type BeaconConfig, type BeaconEff, type ModuleEff } from "./effects.ts";

export type LabProto = {
  name: string;
  /** research speed multiplier (LabPrototype.researching_speed) */
  researchingSpeed: number;
  moduleSlots: number;
  energyUsageW: number | null;
  allowedEffects: string[] | null;
  allowedModuleCategories: string[] | null;
  inputs: string[] | null;
};

export type ScienceBankInput = {
  lab: LabProto;
  /** pack → post-effects rate per second */
  packs: Record<string, number>;
  secondsPerPack: number;
  modules: string[];
  beacons: BeaconConfig[];
  moduleDb: Map<string, ModuleEff>;
  beaconDb: Map<string, BeaconEff>;
  /** beacon+module → what one beacon building consumes to keep running */
  upkeepDb?: Map<string, { item: string; kind: string; perSec: number }>;
  upkeepKey?: (beacon: string, module: string) => string;
};

export type ScienceBankResult = {
  /** Fractional labs — the pool, sized by the binding pack. */
  labs: number;
  /** Productivity multiplier applied by modules and beacons. */
  productivityMult: number;
  speedMult: number;
  /** Pack → what the factory must supply per second (pre-effects). */
  packDemand: Record<string, number>;
  /** The pack that sizes the pool; null when nothing is requested. */
  bindingPack: string | null;
  /** Beacon buildings needed, whole (a fraction cannot be placed). */
  beaconBuildings: { beacon: string; count: number }[];
  /** Item → per-second drain from beacon upkeep. */
  upkeep: Record<string, { kind: string; perSec: number }>;
  totalPowerW: number;
  /** Packs requested that this lab does not accept. */
  unsupported: string[];
};

export function computeScienceBank(input: ScienceBankInput): ScienceBankResult {
  const { lab, secondsPerPack, moduleDb, beaconDb } = input;
  const fx = computeEffects(true, input.modules, input.beacons, moduleDb, beaconDb);

  const accepted = lab.inputs?.length ? new Set(lab.inputs) : null;
  const unsupported = Object.keys(input.packs)
    .filter((p) => (input.packs[p] ?? 0) > 0 && accepted && !accepted.has(p))
    .sort();

  // Productivity stretches each pack, so supplying LESS achieves the same
  // research. Speed changes how fast one lab works, so it sizes the pool.
  const packDemand: Record<string, number> = {};
  let labs = 0;
  let bindingPack: string | null = null;
  const perLabPerSec = (lab.researchingSpeed * fx.speedMult) / Math.max(1e-9, secondsPerPack);
  for (const [pack, rate] of Object.entries(input.packs)) {
    if (!(rate > 0)) continue;
    const demand = rate / fx.prodMult;
    packDemand[pack] = demand;
    // Labs needed if this pack alone had to be consumed at that rate. The pool
    // is the max, not the sum: one lab eats every pack at once.
    const needed = demand / perLabPerSec;
    if (needed > labs) {
      labs = needed;
      bindingPack = pack;
    }
  }

  const beaconBuildings = input.beacons.map((cfg) => ({
    beacon: cfg.beacon,
    count: Math.ceil((cfg.count * labs) / Math.max(1, cfg.shared ?? 1) - 1e-9),
  }));

  // Upkeep is charged per beacon BUILDING, on the fractional count so the demand
  // stays proportional; the whole count above is what to build.
  const upkeep: Record<string, { kind: string; perSec: number }> = {};
  if (input.upkeepDb && input.upkeepKey) {
    for (const cfg of input.beacons) {
      const buildings = (cfg.count * labs) / Math.max(1, cfg.shared ?? 1);
      if (!(buildings > 0)) continue;
      for (const mod of cfg.modules) {
        const up = input.upkeepDb.get(input.upkeepKey(cfg.beacon, mod));
        if (!up) continue;
        const cur = (upkeep[up.item] ??= { kind: up.kind, perSec: 0 });
        cur.perSec += up.perSec * buildings;
      }
    }
  }

  const labPowerW = (lab.energyUsageW ?? 0) * labs * fx.consMult;
  const beaconPowerW = fx.beaconPowerPerMachineW * labs;
  return {
    labs,
    productivityMult: fx.prodMult,
    speedMult: fx.speedMult,
    packDemand,
    bindingPack,
    beaconBuildings,
    upkeep,
    totalPowerW: labPowerW + beaconPowerW,
    unsupported,
  };
}
