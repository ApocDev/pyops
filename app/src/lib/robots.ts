/**
 * Logistic robot math: how many bots move a flow at a planned rate (#255).
 *
 * Pure module, like `logistics.ts`. Prototype rows come from the
 * `logistic_robots` and `roboports` tables; the force bonuses are synced from
 * the game (`LuaForce.worker_robots_speed_modifier` and
 * `worker_robots_storage_bonus`).
 *
 * The trip model: a robot flies `distance` tiles loaded and the same distance
 * back empty, carrying a full payload of one item each trip. Pickup and drop
 * ticks are ignored.
 *
 * The charging model is rough on purpose. A robot leaves to charge when its
 * battery falls to `min_to_charge` and refills to `max_to_charge`, so each
 * charge gives `(max − min) × max_energy` joules. Flying costs
 * `energy_per_move` per tile plus `energy_per_tick` per tick in the air. Each
 * charge costs a detour to the nearest roboport (taken as one logistics radius
 * of extra flight, out and back) plus the time a charging pad needs to refill
 * the battery. Queues at busy roboports are not modelled, so with charging on
 * the count is still a slight lower bound; with no roboport it is the bare
 * flight-time lower bound.
 */

export type RobotProto = {
  name: string;
  display: string | null;
  speed: number; // tiles/tick before the force speed bonus
  maxPayloadSize: number; // items per trip before the cargo bonus
  maxEnergyJ: number;
  energyPerMoveJ: number; // per tile flown
  energyPerTickJ: number; // drain while flying
  minToCharge: number; // battery fraction that sends the robot to charge
  maxToCharge: number; // battery fraction it charges up to
};

export type RoboportProto = {
  name: string;
  display: string | null;
  chargingEnergyW: number; // per charging pad
  logisticsRadius: number;
};

/** Force bonuses, as the game reports them: `speed` is
 * `worker_robots_speed_modifier` (0.5 = +50%), `storage` is
 * `worker_robots_storage_bonus` (extra items per trip). */
export type RobotBonuses = { speed: number; storage: number };

/** Default one-way trip distance (tiles) until the player sets one. */
export const DEFAULT_ROBOT_DISTANCE = 60;

/** The robot and roboport the counts are sized against, plus the force bonuses. */
export type ResolvedRobots = {
  robot: RobotProto;
  roboport: RoboportProto | undefined;
  bonuses: RobotBonuses;
};

/** Pick the selected robot and roboport, falling back to the first of each.
 * Null when the data has no logistic robot. */
export function resolveRobots(
  options: { robots: RobotProto[]; roboports: RoboportProto[] },
  picks: { robot: string; roboport: string },
  bonuses: RobotBonuses,
): ResolvedRobots | null {
  const robot = options.robots.find((r) => r.name === picks.robot) ?? options.robots[0];
  if (!robot) return null;
  const roboport = options.roboports.find((p) => p.name === picks.roboport) ?? options.roboports[0];
  return { robot, roboport, bonuses };
}

/** Flight speed in tiles/second with the force speed bonus. */
export function robotSpeed(r: RobotProto, b: RobotBonuses): number {
  return r.speed * 60 * (1 + Math.max(0, b.speed));
}

/** Items carried per trip with the force cargo bonus. */
export function robotPayload(r: RobotProto, b: RobotBonuses): number {
  return Math.max(1, r.maxPayloadSize + Math.max(0, Math.floor(b.storage)));
}

/** Seconds and joules to fly `tiles` tiles. */
function flight(r: RobotProto, tilesPerSecond: number, tiles: number) {
  const seconds = tiles / tilesPerSecond;
  return { seconds, joules: tiles * r.energyPerMoveJ + seconds * 60 * r.energyPerTickJ };
}

export type RobotTrip = {
  /** items one trip carries */
  payload: number;
  /** flight time for one round trip */
  flightSeconds: number;
  /** charging time (detour + pad) spread over each trip; 0 when not modelled */
  chargeSeconds: number;
  /** items/second one robot moves */
  itemsPerSecond: number;
};

/** One robot's round trip over `distance` tiles each way. Pass a roboport to
 * add the charging detour and pad time; omit it for the flight-only lower
 * bound. A robot that can't reach a roboport on one charge moves nothing. */
export function robotTrip(
  r: RobotProto,
  b: RobotBonuses,
  distance: number,
  roboport?: RoboportProto,
): RobotTrip {
  const payload = robotPayload(r, b);
  const v = robotSpeed(r, b);
  if (!(v > 0)) return { payload, flightSeconds: Infinity, chargeSeconds: 0, itemsPerSecond: 0 };
  const trip = flight(r, v, 2 * Math.max(0, distance));
  let chargeSeconds = 0;
  const perCharge = (r.maxToCharge - r.minToCharge) * r.maxEnergyJ;
  if (roboport && trip.joules > 0 && perCharge > 0) {
    const detour = flight(r, v, roboport.logisticsRadius);
    // trips one charge covers, after paying for the detour to the next charge
    const tripsPerCharge = (perCharge - detour.joules) / trip.joules;
    const padSeconds =
      roboport.chargingEnergyW > 0 ? perCharge / roboport.chargingEnergyW : Infinity;
    chargeSeconds = tripsPerCharge > 0 ? (detour.seconds + padSeconds) / tripsPerCharge : Infinity;
  }
  const cycle = trip.seconds + chargeSeconds;
  return {
    payload,
    flightSeconds: trip.seconds,
    chargeSeconds,
    itemsPerSecond: cycle > 0 ? payload / cycle : Infinity,
  };
}

/** Robots needed to move `rate` items/s over `distance` tiles (fractional). */
export function robotsForRate(
  rate: number,
  r: RobotProto,
  b: RobotBonuses,
  distance: number,
  roboport?: RoboportProto,
): number {
  if (!(rate > 0)) return 0;
  const per = robotTrip(r, b, distance, roboport).itemsPerSecond;
  return per > 0 ? rate / per : Infinity;
}
