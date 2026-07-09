/**
 * Logistics throughput: how many belts carry an item and how many inserters (or
 * loaders) move it in/out of a building at a planned rate (#21).
 *
 * Pure module — no db, no Factorio API — so it's unit-testable. Prototype rows
 * come from the belts/loaders/inserters tables; the current stack bonuses are
 * derived from the research horizon by the query layer and passed in here.
 *
 * Inserter throughput is the swing model from `inserter-throughput-lib`
 * (the in-game-validated community reference), reduced to the inventory→inventory
 * case — i.e. an inserter feeding a machine/chest. That branch is the library's
 * *accurate* (non-estimate) path: `extra_drop_ticks` and `extra_pickup_ticks` are
 * both 0, so throughput is linear in hand stack size and constant per prototype.
 * Belt-item chasing (which only makes inserters faster) is omitted, so the number
 * is a slight, safe under-estimate for belt-fed machines.
 */

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
  baseStackBonus: number; // prototype inserter_stack_size_bonus
  maxBeltStackSize: number; // per-inserter belt-stacking cap (when dropping onto a belt)
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

/** Ticks for one pickup→drop swing (one direction). The cycle to deliver a hand of
 * items is two of these. From inserter-throughput-lib's non-chasing path:
 * max(extension ticks, rotation ticks, 1). */
export function inserterSwingTicks(p: InserterProto): number {
  const fromLen = vlen(p.pickupX, p.pickupY);
  const toLen = vlen(p.dropX, p.dropY);
  const extTicks = Math.ceil(Math.abs(fromLen - toLen) / p.extensionSpeed);
  let diff = Math.abs(orientation(p.pickupX, p.pickupY) - orientation(p.dropX, p.dropY));
  if (diff > 0.5) diff = 1 - diff; // rotate the short way
  const rotTicks = Math.ceil(diff / p.rotationSpeed);
  return Math.max(extTicks, rotTicks, 1);
}

/** Hand stack size (items carried per swing): base + the applicable researched
 * bonus (bulk inserters use the bulk-capacity bonus, others the inserter-stack one). */
export function inserterHandStack(p: InserterProto, b: StackBonuses): number {
  const bonus = p.bulk ? b.bulkInserter : b.inserter;
  return Math.max(1, 1 + p.baseStackBonus + bonus);
}

/** Items/second an inserter moves into a machine/chest at the given hand stack. */
export function inserterThroughput(p: InserterProto, handStack: number): number {
  const cycleTicks = inserterSwingTicks(p) * 2;
  return cycleTicks > 0 ? (60 / cycleTicks) * handStack : 0;
}

/** Inserters needed to move `rate` items/s in or out of one building (fractional). */
export function insertersForRate(rate: number, p: InserterProto, handStack: number): number {
  const per = inserterThroughput(p, handStack);
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
};

export type LogisticsOptions = {
  belts: BeltProto[];
  loaders: LoaderProto[];
  inserters: InserterProto[];
};

export type LogisticsContext = {
  prefs: LogisticsPrefs;
  bonuses: StackBonuses;
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
 * or loaders) to move it in/out of ONE building (rate ÷ building count). */
export function rowLogistics(
  r: ResolvedLogistics,
  rate: number,
  machineCount: number,
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
    devices: insertersForRate(perBuilding, r.inserter, r.handStack),
    deviceKind: "inserter",
  };
}
