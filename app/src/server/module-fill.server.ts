/**
 * Opinionated module auto-fill for planned blocks — "use the best modules you
 * have," not YAFC's payback economics. Given a module-less provisional solve
 * (computeBlock rows), it picks modules per recipe:
 *
 *  - Recipe allows productivity → fill every slot with the best unlocked prod
 *    module (Py's deep chains almost always want yield; the resulting slower
 *    machine — hence higher building count — is honest, and speed beacons to
 *    claw it back are a deferred follow-up).
 *  - Otherwise → the fewest SPEED modules needed to reach the smallest whole
 *    building count, then fill the remaining slots with EFFICIENCY. Past the
 *    whole-count floor extra speed only shaves fractional buildings you can't
 *    realise, so those slots are better spent cutting power.
 *
 * Only modules that are unlocked in the current horizon are considered
 * (availableModuleItems). TURD beacons are applied separately by the solver and
 * never count against slots, so they're untouched here.
 */
import * as q from "../db/queries.server.ts";
import type { computeBlock } from "./block-compute.server.ts";

type Rows = Awaited<ReturnType<typeof computeBlock>>["rows"];

export type ModuleFill = {
  modules: Record<string, string[]>;
  machines: Record<string, string>;
};

export async function chooseModuleFill(rows: Rows): Promise<ModuleFill> {
  const modules: Record<string, string[]> = {};
  const machines: Record<string, string> = {};

  for (const row of rows) {
    const m = row.machine;
    if (!m || !m.moduleSlots || m.moduleSlots < 1) continue;
    const slots = m.moduleSlots;
    const picker = q.modulePickerData(row.recipe, m.name);
    if (!picker) continue;
    const avail = q.availableModuleItems(picker.modules.map((x) => x.name));
    const pool = picker.modules.filter((x) => avail.has(x.name));
    if (!pool.length) continue;
    // pin the machine the modules were sized for, so the block stays self-consistent
    machines[row.recipe] = m.name;

    // Productivity path: best prod module in every slot.
    if (picker.allowProductivity) {
      const prod = pool
        .filter((x) => x.effProductivity > 0)
        .sort((a, b) => b.effProductivity - a.effProductivity)[0];
      if (prod) {
        modules[row.recipe] = Array<string>(slots).fill(prod.name);
        continue;
      }
    }

    // Speed → floor → efficiency path.
    const speed = pool.filter((x) => x.effSpeed > 0).sort((a, b) => b.effSpeed - a.effSpeed)[0];
    const eff = pool
      .filter((x) => x.effConsumption < 0)
      .sort((a, b) => a.effConsumption - b.effConsumption)[0]; // most negative = best
    if (!speed) {
      if (eff) modules[row.recipe] = Array<string>(slots).fill(eff.name);
      continue;
    }
    const baseCount = m.count ?? 0;
    if (baseCount <= 0) continue;
    // count(k) for k speed modules: count ∝ 1/speedMult. base mult here is the
    // module-less solve's (TURD speed only); each speed module adds its effSpeed.
    const base = 1 + (row.effects?.speed ?? 0);
    const countAt = (k: number) => (baseCount * base) / (base + k * speed.effSpeed);
    const floor = Math.ceil(countAt(slots) - 1e-9); // best achievable whole count
    // Fewest speed modules that still reach that whole count — INCLUDING zero:
    // when the count is already under the floor (0.8 buildings), or the modules
    // are too weak to shave a whole building (1.92 → 1.1 never reaches 1), any
    // speed module is pure waste and every slot goes to efficiency.
    let k = slots;
    for (let i = 0; i <= slots; i++) {
      if (countAt(i) <= floor + 1e-9) {
        k = i;
        break;
      }
    }
    const fill = Array<string>(k).fill(speed.name);
    if (slots - k > 0 && eff) fill.push(...Array<string>(slots - k).fill(eff.name));
    if (fill.length) modules[row.recipe] = fill;
  }

  return { modules, machines };
}
