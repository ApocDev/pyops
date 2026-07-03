/**
 * Temperature-fed fluid energy sources (#114) — pure math, shared by the two
 * import passes (`import-factorio.ts` pass 1 and `synthesize.ts`).
 *
 * A FluidEnergySource with `burns_fluid: false` (the engine default) doesn't
 * burn fuel — it drains its filter fluid for its HEAT content:
 *
 *   energy = amount × (temperature − default_temperature) × heat_capacity × effectivity
 *
 * (lua-api.factorio.com, FluidEnergySource.burns_fluid). How much it drains per
 * second comes in three shapes, all present in the Py dump:
 *
 *  - an explicit `fluid_usage_per_tick` (`scale_fluid_usage: false`) is a FIXED
 *    drain — Py's neutron absorbers (0.03334…/tick of boric-acid) and the solar
 *    tower (1/tick of solar-concentration) consume that much whenever running,
 *    wasting any excess energy.
 *  - no `fluid_usage_per_tick`, `scale_fluid_usage: false`, and a non-zero
 *    `maximum_temperature`: the engine derives the fixed per-tick usage from the
 *    cap — "the game will use this value to calculate fluid_usage_per_tick"
 *    (FluidEnergySource.maximum_temperature). Py's uf6/MOX reactors:
 *    nuclear-reactor-mk01 draws 300kW capped at 250° of uf6 (heat_capacity 20J,
 *    default_temperature 0.01°) → 300000 / ((250 − 0.01) × 20) ≈ 60.002 uf6/s.
 *  - `scale_fluid_usage: true` consumes only what the energy draw needs — Py's
 *    compost plants (1MW at effectivity 1000 → 1kW of sweet-syrup heat). The
 *    drain follows the machine's actual consumption (modules included), so it
 *    can't be folded to a constant at import; store the usable J per unit and
 *    let the solve divide the (effectivity-folded) draw by it.
 */

/** FluidPrototype.heat_capacity engine default ("1kJ" per the prototype docs) —
 * Py's sweet-syrup and boric-acid omit it. */
const DEFAULT_HEAT_CAPACITY_J = 1000;
/** Safety fallback only: default_temperature is mandatory on FluidPrototype, so
 * real dumps always carry it. 15° is the vanilla-water convention the other
 * import paths already use. */
const DEFAULT_TEMPERATURE = 15;

export type TempFedFluid = {
  defaultTemperature: number | null;
  maxTemperature: number | null;
  heatCapacityJ: number | null;
};

export type TempFedDrain = {
  /** Fixed drain in units/s per running machine (null = not fixed-rate).
   * Modules don't change it — the engine consumes this much regardless. */
  perSec: number | null;
  /** Usable energy per unit of the filter fluid, in J — WITHOUT effectivity,
   * so dividing the effectivity-folded stored draw (`energy_usage_w`) by it
   * yields units/s directly. Null when no usable temperature is known. */
  energyJPerUnit: number | null;
};

const NONE: TempFedDrain = { perSec: null, energyJPerUnit: null };

/** Drain characteristics of a temperature-fed (`burns_fluid: false`) fluid
 * energy source. `usageW` is the machine's RAW prototype draw (before the
 * effectivity fold). Returns all-null for fuel burners, filterless sources
 * (the feed fluid is unknowable), and sources with no computable drain. */
export function temperatureFedDrain(
  es: {
    burns_fluid?: boolean;
    scale_fluid_usage?: boolean;
    fluid_usage_per_tick?: number;
    maximum_temperature?: number;
    effectivity?: number;
    fluid_box?: { filter?: string };
  },
  usageW: number | null,
  fluid: TempFedFluid | null | undefined,
): TempFedDrain {
  if (es.burns_fluid || !es.fluid_box?.filter) return NONE;

  // usable temperature: the source's cap ("0 means unlimited"), else the
  // fluid's own max_temperature — the hottest it can ever arrive at
  const hc = fluid?.heatCapacityJ ?? DEFAULT_HEAT_CAPACITY_J;
  const dt = fluid?.defaultTemperature ?? DEFAULT_TEMPERATURE;
  const capT =
    (es.maximum_temperature ?? 0) > 0 ? es.maximum_temperature! : (fluid?.maxTemperature ?? null);
  const energyJPerUnit = capT != null && capT > dt ? (capT - dt) * hc : null;

  const fupt = es.fluid_usage_per_tick ?? 0;
  let perSec: number | null = null;
  if (fupt > 0) {
    perSec = fupt * 60;
  } else if (!es.scale_fluid_usage && energyJPerUnit && usageW) {
    // the engine's own derivation of the fixed per-tick usage from the cap
    perSec = usageW / (es.effectivity ?? 1) / energyJPerUnit;
  }
  if (perSec == null && energyJPerUnit == null) return NONE;
  return { perSec, energyJPerUnit };
}
