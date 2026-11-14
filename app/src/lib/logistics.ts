/**
 * Logistics throughput: how many belts carry an item and how many inserters (or
 * loaders) move it in/out of a building at a planned rate (#21).
 *
 * Pure module — no db, no Factorio API — so it's unit-testable. Prototype rows
 * come from the belts/loaders/inserters tables; the current stack bonuses are
 * derived from the research horizon by the query layer and passed in here.
 *
 * Inserter throughput is a reduced port of `inserter-throughput-lib` 2.1.0's
 * `estimate_inserter_speed`, checked against Factorio 2.1 measurements (#282).
 * A row's input inserters take from a belt and drop into the building; its
 * output inserters take from the building and drop onto a belt.
 *
 * - Swing: each half swing is the library's `ceil(...)` minus one tick. That fits
 *   every chest-to-chest measurement in 2.1.
 * - Belt → building: fitted to Factorio 2.1 measurements (#294), since the
 *   library's chasing estimate is 17–65% slow in 2.1 and it has no belt stacks.
 *   The hand takes one belt stack per grab, so the cost depends on grabs
 *   (hand ÷ belt stack), belt speed and arm shape, not on stack size itself.
 *   The fit never over-estimates a measured case by more than 3% and is about
 *   7% low on average for fast arms (see `extraPickupTicks`). Chasing makes a
 *   hand that needs a single grab up to 11% faster than this model.
 * - Building → belt: the library's drop path, counted in the stacks the inserter
 *   places (belt-stacking inserters drop `min(max_belt_stack_size, belt stack)`
 *   per drop and carry only whole stacks of that size).
 */

import type { RobotBonuses, RobotProto, RoboportProto } from "./robots";

export type BeltProto = { name: string; display: string | null; speed: number };
export type LoaderProto = BeltProto;
export type InserterProto = {
  name: string;
  display: string | null;
  rotationSpeed: number; // RealOrientation per tick (0.25 = 90°)
  extensionSpeed: number; // tiles per tick
  pickupX: number;
  pickupY: number;
  dropX: number;
  dropY: number;
  bulk: boolean; // bulk inserter → bulk-inserter-capacity bonus (else inserter-stack bonus)
  baseStackBonus: number; // prototype stack_size_bonus
  maxBeltStackSize: number; // per-inserter belt-stacking cap (when dropping onto a belt)
  /** Stack bonuses of the tiers the game swaps this inserter for as capacity
   * research completes (pycranes' `crane-mk3` → `crane-mk3u1`…), base tier first.
   * Absent for ordinary inserters. */
  upgradeStackBonuses?: number[];
};

/** Stack bonuses summed from the in-effect tech set (see queries.stackBonuses). */
export type StackBonuses = { belt: number; inserter: number; bulkInserter: number };

/** Hard cap on belt-placed stack size (utility-constants.default.max_belt_stack_size). */
export const MAX_BELT_STACK = 8;

/** Items/second a full belt (both lanes) carries for one item type, at the given
 * placed-stack size. speed is tiles/tick: items sit 0.25 tiles apart, 60 ticks/s,
 * 2 lanes → speed × 480 per stack level. Yellow (0.03125) = 15/s at stack 1. */
export function beltItemsPerSecond(speed: number, placedStack = 1): number {
  return speed * 480 * placedStack;
}

/** Belt placed-stack size given the researched belt-stack bonus, clamped to the
 * global cap. No belt research → 1 (no stacking). */
export function placedBeltStack(beltBonus: number, stacking: boolean): number {
  if (!stacking) return 1;
  return Math.min(MAX_BELT_STACK, Math.max(1, 1 + beltBonus));
}

/** Belts needed to carry `rate` items/s of a single item (fractional). */
export function beltsForRate(rate: number, belt: BeltProto, placedStack: number): number {
  const per = beltItemsPerSecond(belt.speed, placedStack);
  return per > 0 ? rate / per : Infinity;
}

/** Loaders needed for `rate` — a loader saturates a belt of its speed, so this is
 * the belt calc (loaders are modelled as belt-speed "super inserters"). */
export function loadersForRate(rate: number, loader: LoaderProto, placedStack: number): number {
  return beltsForRate(rate, loader, placedStack);
}

// ---------------------------------------------------------------------------
// Sushi-belt planning: one mixed loop carrying a block's ins and outs.
//
// The model: a loop of `loopTiles` belt tiles holds `8 × tiles × stack` item
// slots and moves at `speed × 60` tiles/s, so the flow past any point tops out
// at the plain belt throughput regardless of item mix. In steady state each
// item's share of the moving flow equals its share of the total rate, and the
// stock riding the loop is `rate × lap-time` (Little's law with one lap of
// dwell) — which is exactly the per-item "keep N on the belt" set-point a
// circuit-controlled sushi inserter bank needs. Everything here is the
// capacity/composition side; the control side (filtered or circuit-limited
// insertion so one item can't flood the loop) is up to the build.

/** An item flow to ride the loop. `in` = imported (pulled off by consumers),
 * `out` = exported (dropped on, removed at the exit), `int` = internal — made
 * by one row and eaten by another, riding the loop in between. The belt rate
 * for a good is max(production, consumption) across the block's rows: that
 * single identity covers all three roles. */
export type SushiFlow = {
  name: string;
  rate: number;
  role: "in" | "out" | "int";
  /** spoil time in seconds, when the item rots */
  spoilSeconds?: number;
};

export type SushiRow = {
  name: string;
  role: "in" | "out" | "int";
  rate: number;
  /** fraction of the moving flow (= fraction of total rate) */
  share: number;
  /** recommended items riding the loop — the circuit set-point (floored) */
  onBelt: number;
  /** average gap between two instances of this item passing a fixed point */
  seenEverySeconds: number;
  /** average time one instance rides the loop (stock ÷ rate, Little's law) */
  dwellSeconds: number;
  /** share > 1/2 — a dedicated belt or lane likely serves it better */
  dominant: boolean;
  /** passes a consumer rarely even after the floor — raise its floor or
   * shorten the loop */
  sparse: boolean;
  /** spends a meaningful fraction of its spoil time riding the loop */
  spoilRisk: boolean;
};

export type SushiVerdict = "comfortable" | "tight" | "fragile" | "over-capacity" | "loop-too-small";

export type SushiPlan = {
  verdict: SushiVerdict;
  /** capacity verdicts (`comfortable`/`tight`) are buildable; the rest need changes */
  ok: boolean;
  /** Σ rates ÷ one belt's throughput */
  utilization: number;
  totalRate: number;
  lapSeconds: number;
  /** item slots the loop physically holds (8 × tiles × stack) */
  slots: number;
  /** Σ per-item set-points */
  onBeltTotal: number;
  rows: SushiRow[];
};

/** Keep at least this many of every item on the loop, so trace ingredients
 * still cycle past their consumers. */
const SUSHI_MIN_ON_BELT = 2;
/** An item passing a point less often than this is flagged sparse. */
const SUSHI_SPARSE_GAP_S = 10;
/** Flag spoilables that spend more than this fraction of their life on the loop. */
const SUSHI_SPOIL_DWELL_FRACTION = 0.25;
/** Utilization verdict bands: below = comfortable, between = tight, above = fragile. */
const SUSHI_COMFORT_U = 0.6;
const SUSHI_TIGHT_U = 0.85;

/** Plan one sushi loop for the given flows. Null when there's no belt, fewer
 * than two flows, or nothing actually moving — sushi is meaningless there. */
export function planSushi(
  r: ResolvedLogistics,
  flows: SushiFlow[],
  loopTiles: number,
): SushiPlan | null {
  if (!r.belt || flows.length < 2 || !(loopTiles > 0)) return null;
  const total = flows.reduce((s, f) => s + Math.max(0, f.rate), 0);
  if (!(total > 1e-9)) return null;

  const throughput = beltItemsPerSecond(r.belt.speed, r.placedStack);
  const utilization = throughput > 0 ? total / throughput : Infinity;
  const lapSeconds = loopTiles / (r.belt.speed * 60);
  const slots = 8 * loopTiles * r.placedStack;

  const rows: SushiRow[] = flows
    .filter((f) => f.rate > 1e-9)
    .map((f) => {
      const share = f.rate / total;
      const onBelt = Math.max(SUSHI_MIN_ON_BELT, Math.ceil(f.rate * lapSeconds));
      const seenEverySeconds = lapSeconds / onBelt;
      const dwellSeconds = onBelt / f.rate;
      return {
        name: f.name,
        role: f.role,
        rate: f.rate,
        share,
        onBelt,
        seenEverySeconds,
        dwellSeconds,
        dominant: share > 0.5,
        sparse: seenEverySeconds > SUSHI_SPARSE_GAP_S,
        spoilRisk:
          f.spoilSeconds != null && dwellSeconds > SUSHI_SPOIL_DWELL_FRACTION * f.spoilSeconds,
      };
    })
    .sort((a, b) => b.rate - a.rate);

  const onBeltTotal = rows.reduce((s, x) => s + x.onBelt, 0);
  // over-capacity is the more fundamental failure — no loop length fixes it
  const verdict: SushiVerdict =
    utilization > 1
      ? "over-capacity"
      : onBeltTotal > slots
        ? "loop-too-small"
        : utilization > SUSHI_TIGHT_U
          ? "fragile"
          : utilization > SUSHI_COMFORT_U
            ? "tight"
            : "comfortable";

  return {
    verdict,
    ok: verdict === "comfortable" || verdict === "tight",
    utilization,
    totalRate: total,
    lapSeconds,
    slots,
    onBeltTotal,
    rows,
  };
}

const vlen = (x: number, y: number) => Math.hypot(x, y);

/** Factorio RealOrientation of a vector: 0 = north, 0.25 = east, 0.5 = south,
 * 0.75 = west. +y points south (down). */
function orientation(x: number, y: number): number {
  const o = Math.atan2(x, -y) / (2 * Math.PI);
  return ((o % 1) + 1) % 1;
}

/** Ticks for one half swing (pickup → drop, or back). The full cycle is two of
 * these plus any belt pickup/drop ticks. inserter-throughput-lib uses
 * max(ceil(extension ticks), ceil(rotation ticks), 1); Factorio 2.1 is one tick
 * faster per half (a basic inserter cycles in 48 ticks, not 50). */
export function inserterSwingTicks(p: InserterProto): number {
  const fromLen = vlen(p.pickupX, p.pickupY);
  const toLen = vlen(p.dropX, p.dropY);
  const extTicks = Math.ceil(Math.abs(fromLen - toLen) / p.extensionSpeed);
  let diff = Math.abs(orientation(p.pickupX, p.pickupY) - orientation(p.dropX, p.dropY));
  if (diff > 0.5) diff = 1 - diff; // rotate the short way
  const rotTicks = Math.ceil(diff / p.rotationSpeed);
  return Math.max(1, Math.max(extTicks, rotTicks) - 1);
}

/** The stack bonus in effect at the given research bonus. An inserter with
 * auto-upgrade tiers uses the highest tier research has reached: in pycranes each
 * tier's bonus is the base plus a whole number of steps, and the step count equals
 * the research bonus that selects it (crane-mk3 is 5, 10, 15, 20… at bulk
 * capacity +0, +1, +2, +3…). */
function stackBonusAt(p: InserterProto, research: number): number {
  const tiers = p.upgradeStackBonuses;
  if (!tiers || tiers.length < 2) return p.baseStackBonus;
  const step = tiers[1] - tiers[0];
  if (!(step > 0)) return p.baseStackBonus;
  let bonus = tiers[0];
  for (const t of tiers) if ((t - tiers[0]) / step <= research + 1e-9) bonus = t;
  return bonus;
}

/** Hand stack size (items carried per swing): 1 + the prototype bonus + the
 * applicable researched bonus (bulk inserters use the bulk-capacity bonus, others
 * the inserter-stack one). */
export function inserterHandStack(p: InserterProto, b: StackBonuses): number {
  const research = p.bulk ? b.bulkInserter : b.inserter;
  return Math.max(1, 1 + stackBonusAt(p, research) + research);
}

/** The belt at one end of an inserter's swing; the other end is a building or
 * chest. `placedStack` is the belt's item stack size (belt-stack research). */
export type InserterBelt = { end: "pickup" | "drop"; speed: number; placedStack: number };

/** Grabs a hand takes almost free of extra time before it waits on the belt. */
const BELT_PICKUP_REACH = 2.5;

/** Past its reach, a fast hand needs at least this many ticks per grab, even when
 * the belt brings stacks faster (hand-limited on fast and express belts). */
const MIN_TICKS_PER_BELT_GRAB = 3.6;

/** Ticks per grab inside the reach: about one for an arm that points straight at
 * the belt, 3.4 for an offset arm (pycranes' pickup sits 0.5 tiles to the side),
 * which has to extend as well as turn to follow items along the belt. */
const STRAIGHT_ARM_GRAB_TICKS = 1;
const OFFSET_ARM_GRAB_TICKS = 3.4;

/** Belt-pickup ticks per swing that slow arms pay even for a single grab (they
 * can't chase items the way fast arms do), phased in as slowness goes from 1 to 2
 * (see `pickupSlowness`). */
const SLOW_ARM_PICKUP_TICKS = 2;

/** How much slower than a fast inserter's (0.1 tiles/tick) this arm extends,
 * raised to 1.25: the basic inserter and crane-mk1 (0.035) scale by 3.7,
 * the long-handed inserter (0.05) by 2.4. The exponent covers crane-mk1, whose
 * offset arm can barely keep up with items on a yellow belt. */
function pickupSlowness(p: InserterProto): number {
  return Math.max(1, 0.1 / p.extensionSpeed) ** 1.25;
}

/**
 * Extra ticks per swing to take `grabs` belt stacks, beyond the chest-to-chest
 * swing. Every inserter chases belt items in 2.1, so the hand's path depends on
 * the arm, the belt speed and where items sit; the game settles into cycles that
 * are whole multiples of the belt's slot period, which makes the true curve
 * lumpy. This is a smooth fit that stays on the safe (slow) side:
 *
 *   slowness × max(grabTicks × (grabs − 1), (grabs − 2.5) × max(slotTicks, 3.6))
 *   + 2 × min(1, slowness − 1)
 *
 * `slotTicks` is how often both lanes of a full belt bring a new stack.
 *
 * Fitted to 213 belt → chest setups (iron plate, Factorio 2.1, Py, 50–72 s of
 * game time each, every belt tile verified full): transport, fast and express
 * belts at belt stack 1, 2 and 3; hands of 1–16 on the Py stack inserter, 2–96
 * on cranes mk1–mk4 in both orientations, plus bulk, fast, basic, long-handed
 * and short cranes. Grabs, not stack size, set the cost: a Py stack inserter
 * holding 16 on a stack-2 belt (8 grabs) cycles exactly like one holding 8 on
 * an unstacked belt. Sample extra ticks per swing (transport / fast / express):
 *
 * | Inserter (grabs)   | Measured        | Model          |
 * | ------------------ | --------------- | -------------- |
 * | Py stack (4)       | 2 / 2 / 2       | 6 / 5.4 / 5.4  |
 * | Py stack (6)       | 8.9 / 14 / 10.1 | 14 / 12.6 / 12.6 |
 * | Py stack (16)      | 48 / 42 / 38    | 54 / 49 / 49   |
 * | Bulk (4)           | 4 / 4 / 2.7     | 6 / 5.4 / 5.4  |
 * | crane-mk3 (8)      | 18 / 19 / 18    | 24 / 24 / 24   |
 * | crane-mk3 (24)     | 81 / 69 / 65    | 86 / 78 / 78   |
 * | crane-mk1 (7)      | 74 / 38 / 26    | 81 / 81 / 81   |
 *
 * A crane whose pickup sits upstream of its pivot (rotated 180°) is 10–30%
 * faster than this; the model assumes the slower, downstream orientation.
 */
function extraPickupTicks(p: InserterProto, grabs: number, speed: number): number {
  const slotTicks = 0.125 / speed; // items sit 0.25 tiles apart on each of two lanes
  const grabTicks = p.pickupX === 0 ? STRAIGHT_ARM_GRAB_TICKS : OFFSET_ARM_GRAB_TICKS;
  const k = pickupSlowness(p);
  const wait = Math.max(
    grabTicks * (grabs - 1),
    (grabs - BELT_PICKUP_REACH) * Math.max(slotTicks, MIN_TICKS_PER_BELT_GRAB),
  );
  return k * Math.max(0, wait) + SLOW_ARM_PICKUP_TICKS * Math.min(1, k - 1);
}

/** Extra ticks to place `drops` stacks on one belt lane: each needs the previous
 * one to move a slot along (inserter-throughput-lib's `calculate_extra_drop_ticks`). */
function extraDropTicks(drops: number, speed: number): number {
  if (drops <= 1) return 0;
  if (drops === 2) return 1;
  return Math.max(drops - 1, Math.floor((0.25 / speed) * (drops - 2)));
}

/** Items/second one inserter moves at the given hand stack: chest to chest when
 * `belt` is omitted, else from or onto that belt. */
export function inserterThroughput(
  p: InserterProto,
  handStack: number,
  belt?: InserterBelt,
): number {
  const swing = inserterSwingTicks(p) * 2;
  if (!belt) return (60 / swing) * handStack;
  if (!(belt.speed > 0)) return 0;
  const beltStack = Math.max(1, belt.placedStack);
  if (belt.end === "pickup") {
    const ticks = swing + extraPickupTicks(p, Math.ceil(handStack / beltStack), belt.speed);
    // can't take more than the belt brings (both lanes)
    return Math.min((60 / ticks) * handStack, beltItemsPerSecond(belt.speed, beltStack));
  }
  // A belt-stacking inserter drops whole stacks and carries only whole stacks.
  const dropStack = p.maxBeltStackSize > 1 ? Math.min(p.maxBeltStackSize, beltStack) : 1;
  const carried = handStack >= dropStack ? handStack - (handStack % dropStack) : handStack;
  const ticks = swing + extraDropTicks(Math.ceil(carried / dropStack), belt.speed);
  // drops land on one lane
  return Math.min((60 / ticks) * carried, beltItemsPerSecond(belt.speed, dropStack) / 2);
}

/** Inserters needed to move `rate` items/s in or out of one building (fractional). */
export function insertersForRate(
  rate: number,
  p: InserterProto,
  handStack: number,
  belt?: InserterBelt,
): number {
  const per = inserterThroughput(p, handStack, belt);
  return per > 0 ? rate / per : Infinity;
}

/** How many of an item fit in one rocket: floor(lift weight / item weight), min 1
 * (an over-heavy item still ships one-per-rocket rather than reading as infinite). */
export function rocketCapacity(weight: number, liftWeight: number): number {
  return Math.max(1, Math.floor(liftWeight / Math.max(1, weight)));
}

/** Rocket launches per minute to move `rate` items/s of an item. */
export function launchesForRate(rate: number, weight: number, liftWeight: number): number {
  return (rate * 60) / rocketCapacity(weight, liftWeight);
}

/* ── Context resolution (server prefs → per-row numbers) ──────────────────────
 * The block view fetches a LogisticsContext once and computes counts client-side
 * so changing a belt/inserter tier is instant. resolveLogistics() picks the
 * selected prototypes + effective stack sizes; rowLogistics() turns a row's item
 * rate into belt + device counts. */

export type LogisticsPrefs = {
  // independent per-metric toggles; the readout is "on" if any is true
  showBelts: boolean;
  showInserters: boolean;
  showRockets: boolean; // niche — off by default
  belt: string; // selected belt name
  mover: string; // selected inserter OR loader name
  moverKind: "inserter" | "loader";
  stacking: boolean; // apply researched stack bonuses
  overrideStack: number | null; // manual belt placed-stack override (null = auto)
  showRobots: boolean; // bot counts on a block's boundary chips (#255)
  robot: string; // selected logistic robot name
  roboport: string; // selected roboport name (charging)
  robotDistance: number; // factory-wide one-way trip distance, tiles; a block can override it
};

export type LogisticsOptions = {
  belts: BeltProto[];
  loaders: LoaderProto[];
  inserters: InserterProto[];
  robots: RobotProto[];
  roboports: RoboportProto[];
};

export type LogisticsContext = {
  prefs: LogisticsPrefs;
  bonuses: StackBonuses;
  robotBonuses: RobotBonuses;
  options: LogisticsOptions;
  rocketLiftWeight: number; // utility-constants.default.rocket_lift_weight
  defaultItemWeight: number; // weight assumed when an item has none set in the data
};

const ZERO_BONUSES: StackBonuses = { belt: 0, inserter: 0, bulkInserter: 0 };

export type ResolvedLogistics = {
  belt: BeltProto | undefined;
  placedStack: number;
  moverKind: "inserter" | "loader";
  inserter?: InserterProto;
  loader?: LoaderProto;
  handStack: number;
};

/** Pick the selected belt + mover and compute the effective belt placed-stack and
 * inserter hand stack from the prefs + research bonuses. */
export function resolveLogistics(ctx: LogisticsContext): ResolvedLogistics {
  const belt = ctx.options.belts.find((b) => b.name === ctx.prefs.belt) ?? ctx.options.belts[0];
  const placedStack =
    ctx.prefs.overrideStack != null
      ? Math.min(MAX_BELT_STACK, Math.max(1, ctx.prefs.overrideStack))
      : placedBeltStack(ctx.bonuses.belt, ctx.prefs.stacking);
  if (ctx.prefs.moverKind === "loader") {
    const loader =
      ctx.options.loaders.find((l) => l.name === ctx.prefs.mover) ?? ctx.options.loaders[0];
    return { belt, placedStack, moverKind: "loader", loader, handStack: 1 };
  }
  const inserter =
    ctx.options.inserters.find((i) => i.name === ctx.prefs.mover) ?? ctx.options.inserters[0];
  const handStack = inserter
    ? inserterHandStack(inserter, ctx.prefs.stacking ? ctx.bonuses : ZERO_BONUSES)
    : 1;
  return { belt, placedStack, moverKind: "inserter", inserter, handStack };
}

export type RowLogistics = { belts: number; devices: number; deviceKind: "inserter" | "loader" };

/** Belts to carry `rate` of one item across the whole row, and devices (inserters
 * or loaders) to move it in/out of ONE building (rate ÷ building count). An
 * `input` is taken off the selected belt into the building; an `output` is
 * dropped from the building onto it. */
export function rowLogistics(
  r: ResolvedLogistics,
  rate: number,
  machineCount: number,
  direction: "input" | "output",
): RowLogistics | null {
  if (!r.belt) return null;
  const belts = beltsForRate(rate, r.belt, r.placedStack);
  // Per BUILT machine (ceil), not per fractional machine: a mall row at 0.05
  // buildings would otherwise size inserters for one machine running at 100%
  // speed (13/s of feed → "19 inserters"), when the machine's input buffer
  // absorbs bursts and the average flow is what the inserters must sustain.
  // Matches the belts figure, which also sizes on average flow.
  const builtMachines = Math.ceil(Math.max(0, machineCount) - 1e-9);
  const perBuilding = builtMachines > 0 ? rate / builtMachines : rate;
  if (r.moverKind === "loader") {
    if (!r.loader) return null;
    return {
      belts,
      devices: loadersForRate(perBuilding, r.loader, r.placedStack),
      deviceKind: "loader",
    };
  }
  if (!r.inserter) return null;
  return {
    belts,
    devices: insertersForRate(perBuilding, r.inserter, r.handStack, {
      end: direction === "input" ? "pickup" : "drop",
      speed: r.belt.speed,
      placedStack: r.placedStack,
    }),
    deviceKind: "inserter",
  };
}
