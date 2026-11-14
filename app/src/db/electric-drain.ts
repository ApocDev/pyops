/**
 * Electric drain: the constant draw an electric machine takes on top of its
 * working `energy_usage`, whether it is crafting or idle. Modules and beacons
 * never scale it, so a working machine draws
 * `energy_usage × consumption multiplier + drain`.
 *
 * The dump carries a `drain` key only when the prototype sets one. Without it
 * the engine fills in a per-type default: crafting machines (assembling-machine,
 * furnace, rocket-silo) get `energy_usage / 30`, and every other type (labs,
 * mining drills, agricultural towers) gets none. Py's data confirms it in game
 * (`electric_energy_source_prototype.drain`): 548 crafting machines at
 * energy_usage / 30, the lab and 40 drills at 0, and an idle
 * automated-factory-mk04 (10 MW) drawing exactly 333.33 kW.
 */
const DEFAULT_DRAIN_TYPES = new Set(["assembling-machine", "furnace", "rocket-silo"]);

/** Drain in W for a machine prototype, or null when its energy source is not an
 * electric input (burner, fluid, heat, void, or none). `usageW` is the parsed
 * `energy_usage`. */
export function electricDrainW(
  prototypeType: string,
  energySource: { type?: string; drain?: unknown } | null | undefined,
  usageW: number | null,
  parseSI: (s: unknown) => number | null,
): number | null {
  if (energySource?.type !== "electric") return null;
  const explicit = parseSI(energySource.drain);
  if (explicit != null) return explicit;
  return DEFAULT_DRAIN_TYPES.has(prototypeType) && usageW != null ? usageW / 30 : 0;
}
