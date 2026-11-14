/**
 * Science-bank maths (pure — shared by the block compute path and its tests).
 *
 * A lab bank is ONE pool of machines: the labs consuming automation science are
 * the same labs consuming py science 1. The pool therefore follows the TOTAL pack
 * rate, never the sum of per-pack pool sizes.
 *
 * Pack rates are entered directly, so a hand-tuned or mixed-research plan needs
 * nothing else. What they cannot supply is the pool size — 10/5/1 might be one
 * technology's ratio or three mixed — so the bank also carries lab-seconds per
 * pack, which a technology picker can compute.
 *
 * Productivity divides both sides: each lab earns more research per second, so
 * fewer labs reach the target rate and fewer packs are consumed getting there.
 *
 * The force's research speed bonus (LuaForce.laboratory_speed_modifier) is a
 * separate factor: lab speed = researching_speed × (1 + bonus) × module speed.
 * Its research productivity bonus (LuaForce.laboratory_productivity_bonus) adds
 * to module productivity, the way LuaEntity.productivity_bonus sums force and
 * module bonuses into one figure.
 *
 * An entered pack rate is research THROUGHPUT, in normal packs' worth of
 * research per second (what `ratesForTech` writes: a technology's cost per
 * second). Lab count and power follow throughput only. `packDemand` is what the
 * factory must supply to deliver it, so productivity and pack quality lower it
 * and nothing else.
 *
 * Quality (#266) therefore changes only the packs consumed. A rare pack carries
 * `tool_durability_multiplier` (1 + level by default) times the research, and a
 * lab drains every pack at the same speed, so the same research takes the same
 * labs and a third of the rare packs. YAFC-CE counts one quality pack as
 * level + 1 normal ones the same way (ProductionTable.ScienceDecomposition.cs:8-25).
 * A lab that opts in drains packs at its quality's `science_pack_drain_multiplier`.
 * Lab speed and slots arrive already scaled by the lab's quality.
 */
import { computeEffects, type BeaconConfig, type BeaconEff, type ModuleEff } from "./effects.ts";
import { wholeMachines } from "../lib/machine-count.ts";
import { interferingBeacons } from "../lib/beacon-interference.ts";

export type LabProto = {
  name: string;
  /** research speed multiplier (LabPrototype.researching_speed) */
  researchingSpeed: number;
  moduleSlots: number;
  energyUsageW: number | null;
  /** constant electric drain per lab in W (null = none) */
  drainW: number | null;
  allowedEffects: string[] | null;
  allowedModuleCategories: string[] | null;
  inputs: string[] | null;
  /** LabPrototype quality flags (#265) */
  qualityAffectsModuleSlots?: boolean;
  usesQualityDrainModifier?: boolean;
};

export type ScienceBankInput = {
  lab: LabProto;
  /** pack → research throughput in normal packs' worth per second (the
   * block's goals); see the module comment */
  packs: Record<string, number>;
  /** seconds of lab time per single pack at speed 1 */
  labSecondsPerPack: number;
  /** the force's research speed bonus from technologies (0 = none) */
  labSpeedBonus: number;
  /** the force's research productivity bonus from technologies (0 = none) */
  labProductivityBonus: number;
  /** module keys for the effects (quality keys for non-normal modules) */
  modules: string[];
  beacons: BeaconConfig[];
  /** `beacons` with beacon and module names at their quality keys, for the
   * effects only; buildings, upkeep and interference read `beacons`.
   * Absent = `beacons`. */
  effectBeacons?: BeaconConfig[];
  moduleDb: Map<string, ModuleEff>;
  beaconDb: Map<string, BeaconEff>;
  /** beacon+module → what one beacon building consumes to keep running */
  upkeepDb?: Map<string, { item: string; kind: string; perSec: number }>;
  upkeepKey?: (beacon: string, module: string) => string;
  /** A pack key → the base pack prototype and the share of a normal pack's
   * consumption it costs (drain ÷ durability). Absent = every pack is normal. */
  packQuality?: (pack: string) => { name: string; demand: number };
};

export type ScienceBankResult = {
  /** Fractional labs. ONE pool: the same labs consume every pack. */
  labs: number;
  /** Total packs per second across every type, as entered. */
  totalPerSec: number;
  /** Productivity multiplier: modules, beacons, and the research bonus. */
  productivityMult: number;
  /** Speed multiplier from modules and beacons only. */
  speedMult: number;
  /** The force's research speed bonus the labs were sized with. */
  labSpeedBonus: number;
  /** The force's research productivity bonus, already in productivityMult. */
  labProductivityBonus: number;
  /** Pack → what the factory must supply per second. */
  packDemand: Record<string, number>;
  /** Beacon buildings needed, whole (a fraction cannot be placed). */
  beaconBuildings: { beacon: string; count: number }[];
  /** Beacons that interfere, so Py disables the labs (lib/beacon-interference). */
  beaconInterference: string[];
  /** Item → per-second drain from beacon upkeep. */
  upkeep: Record<string, { kind: string; perSec: number }>;
  totalPowerW: number;
  /** Packs requested that this lab does not accept. */
  unsupported: string[];
  /** The bank asked for a lab, module or beacon quality the research horizon
   * hasn't unlocked; it was planned at the best unlocked one (#266). */
  qualityCapped?: boolean;
};

export function computeScienceBank(input: ScienceBankInput): ScienceBankResult {
  const { lab, moduleDb, beaconDb } = input;
  // the lab's allowed effects and categories gate every module: Py's lab takes
  // only vatbrains (productivity, consumption, pollution) and ignores speed
  const fx = computeEffects(
    true,
    input.modules,
    input.effectBeacons ?? input.beacons,
    moduleDb,
    beaconDb,
    [],
    undefined,
    null,
    lab,
  );
  const prodMult = fx.prodMult + input.labProductivityBonus;

  const packOf = input.packQuality ?? ((pack: string) => ({ name: pack, demand: 1 }));
  const accepted = lab.inputs?.length ? new Set(lab.inputs) : null;
  const unsupported = Object.keys(input.packs)
    .filter((p) => (input.packs[p] ?? 0) > 0 && accepted && !accepted.has(packOf(p).name))
    .sort();

  // ONE pool. Every pack is eaten by the same labs, so the pool follows the
  // TOTAL pack rate, never the sum of per-pack pool sizes — that was the error
  // that made 40/min plus 20/min read as 60 labs instead of 40.
  //
  // Productivity divides both sides: each lab earns more research per second, so
  // fewer labs reach the target and fewer packs are consumed getting there.
  const packDemand: Record<string, number> = {};
  let totalPerSec = 0;
  for (const [pack, rate] of Object.entries(input.packs)) {
    if (!(rate > 0)) continue;
    packDemand[pack] = (rate * packOf(pack).demand) / prodMult;
    totalPerSec += rate;
  }
  const labs =
    (totalPerSec * input.labSecondsPerPack) /
    Math.max(1e-9, lab.researchingSpeed * (1 + input.labSpeedBonus) * fx.speedMult * prodMult);

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

  // drain is per placed lab, idle or not, and modules don't scale it
  const labPowerW =
    (lab.energyUsageW ?? 0) * labs * fx.consMult +
    (lab.drainW ?? 0) * (labs > 0 ? wholeMachines(labs) : 0);
  const beaconPowerW = fx.beaconPowerPerMachineW * labs;
  return {
    labs,
    totalPerSec,
    productivityMult: prodMult,
    speedMult: fx.speedMult,
    labSpeedBonus: input.labSpeedBonus,
    labProductivityBonus: input.labProductivityBonus,
    packDemand,
    beaconBuildings,
    beaconInterference: interferingBeacons(input.beacons, (n) => beaconDb.get(n)?.interference),
    upkeep,
    totalPowerW: labPowerW + beaconPowerW,
    unsupported,
  };
}

/** One technology's research cost, as the picker needs it. */
export type TechCost = {
  /** pack → units per research unit */
  ratio: Record<string, number>;
  /** seconds of lab time per research unit at speed 1 */
  unitTime: number;
  /** research units in the whole technology */
  unitCount: number;
};

/** Turn "research THIS technology in THIS long" into the rates to type into the
 * bank, plus the lab-seconds-per-pack that sizes the pool.
 *
 * The helper only computes: its output is written into the bank as ordinary
 * numbers and no technology is stored, so a plan never rots when one is renamed
 * or researched. Effects are deliberately excluded — the bank applies
 * productivity itself, and folding it in here would apply it twice.
 */
export function ratesForTech(
  tech: TechCost,
  seconds: number,
): { packs: Record<string, number>; labSecondsPerPack: number; totalPerSec: number } {
  const perUnit = Object.values(tech.ratio).reduce((sum, n) => sum + Math.max(0, n), 0);
  const unitsPerSec = seconds > 0 ? tech.unitCount / seconds : 0;
  const packs: Record<string, number> = {};
  let totalPerSec = 0;
  for (const [pack, amount] of Object.entries(tech.ratio)) {
    if (!(amount > 0)) continue;
    packs[pack] = unitsPerSec * amount;
    totalPerSec += packs[pack]!;
  }
  return {
    packs,
    // unit time spread over the packs one unit consumes
    labSecondsPerPack: perUnit > 0 ? tech.unitTime / perUnit : tech.unitTime,
    totalPerSec,
  };
}
