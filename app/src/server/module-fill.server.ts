/**
 * Module auto-fill — the direct algorithm ("use the best modules you have,"
 * no payback economics). Given one row's machine + the modules placeable in it,
 * pick a fill:
 *
 *  - Recipe allows productivity → fill every slot with the best prod module
 *    (Py's deep chains almost always want yield; the resulting slower machine —
 *    hence higher building count — is honest).
 *  - Otherwise → the fewest SPEED modules needed to reach the smallest whole
 *    building count, then fill the remaining slots with EFFICIENCY. Past the
 *    whole-count floor extra speed only shaves fractional buildings you can't
 *    realise, so those slots are better spent cutting power. Zero speed modules
 *    is a real answer: a row already under the floor (0.8 buildings), or one
 *    whose modules are too weak to shave a whole building (1.92 → 1.1 never
 *    reaches 1), fills every slot with efficiency.
 *
 * The building count is beacon-aware: `baseCount`/`baseSpeedMult` come from a
 * solve WITHOUT machine modules but WITH the row's beacons and TURD bonuses, so
 * planting speed beacons makes auto shed now-redundant speed modules on the
 * next solve. computeBlock drives this in two passes (prod needs no count and
 * applies immediately; speed/efficiency re-enter with the solved counts).
 */
export type ModuleCandidate = {
  name: string;
  effSpeed: number;
  effProductivity: number;
  effConsumption: number;
};

export function pickAutoModules(opts: {
  slots: number;
  /** recipe allows productivity (pool is already filtered to placeable modules) */
  allowProductivity: boolean;
  /** placeable + unlocked modules for this (recipe, machine) */
  pool: ModuleCandidate[];
  /** fractional buildings with NO machine modules (beacons/TURD included) */
  baseCount: number;
  /** the speed multiplier that produced baseCount: 1 + beacon/TURD speed bonus */
  baseSpeedMult: number;
}): string[] {
  const { slots, pool, baseCount, baseSpeedMult } = opts;
  if (slots < 1 || !pool.length) return [];

  if (opts.allowProductivity) {
    const prod = pool
      .filter((x) => x.effProductivity > 0)
      .sort((a, b) => b.effProductivity - a.effProductivity)[0];
    if (prod) return Array<string>(slots).fill(prod.name);
  }

  const speed = pool.filter((x) => x.effSpeed > 0).sort((a, b) => b.effSpeed - a.effSpeed)[0];
  const eff = pool
    .filter((x) => x.effConsumption < 0)
    .sort((a, b) => a.effConsumption - b.effConsumption)[0]; // most negative = best
  const allEff = eff ? Array<string>(slots).fill(eff.name) : [];
  // no speed module, or an idle row (count 0 — speed can't help): all efficiency
  if (!speed || baseCount <= 0) return allEff;

  // count(k) for k speed modules: count ∝ 1/speedMult; each module adds effSpeed.
  const countAt = (k: number) => (baseCount * baseSpeedMult) / (baseSpeedMult + k * speed.effSpeed);
  // 1% overload tolerance: a count a hair over a whole number reads as that
  // whole. Users park blocks at round counts/rates; without the band, drifting
  // from 2.000 to 2.001 buildings flips the whole-count floor and with it the
  // suggested speed/efficiency split (#117). One percent of a machine is well
  // inside LP dust and real-world uptime slack.
  const TOL = 0.01;
  const floor = Math.ceil(countAt(slots) * (1 - TOL) - 1e-9); // best achievable whole count
  // fewest speed modules that still reach that whole count — including zero
  let k = slots;
  for (let i = 0; i <= slots; i++) {
    if (countAt(i) <= floor * (1 + TOL) + 1e-9) {
      k = i;
      break;
    }
  }
  const fill = Array<string>(k).fill(speed.name);
  if (slots - k > 0 && eff) fill.push(...Array<string>(slots - k).fill(eff.name));
  return fill;
}
