/**
 * temperatureFedDrain (#114) — every fixture is verbatim from the Py
 * data-raw-dump.json:
 *
 *  - nuclear-reactor-mk01 (assembling-machine): energy_usage 300kW,
 *    energy_source { type fluid, effectivity 1, burns_fluid false,
 *    scale_fluid_usage false, maximum_temperature 250, fluid_box.filter uf6 }.
 *    fluid.uf6: default_temperature 0.01, max_temperature 10000,
 *    heat_capacity "0.02kJ" (20 J).
 *  - nuclear-reactor-mox-mk04: 3MW, maximum_temperature 10000, filter puo2
 *    (default_temperature 0.01, heat_capacity "0.08kJ" = 80 J).
 *  - neutron-absorber-mk01: 1W, fluid_usage_per_tick 0.033343333333333336,
 *    maximum_temperature 10, filter boric-acid (default_temperature 0,
 *    max_temperature 10, no heat_capacity → engine default 1kJ).
 *  - compost-plant-mk01-turd (furnace): 1MW, effectivity 1000,
 *    scale_fluid_usage true, maximum_temperature 10, filter sweet-syrup
 *    (default_temperature 0, max_temperature 100, no heat_capacity).
 *  - solar-tower-building (boiler): energy_consumption 16GW,
 *    fluid_usage_per_tick 1, no maximum_temperature, filter
 *    solar-concentration (default_temperature 0, max_temperature 10000,
 *    heat_capacity "32kJ").
 */
import { describe, expect, it } from "vite-plus/test";
import { temperatureFedDrain } from "./fluid-energy.ts";

const uf6 = { defaultTemperature: 0.01, maxTemperature: 10000, heatCapacityJ: 20 };
const puo2 = { defaultTemperature: 0.01, maxTemperature: 10000, heatCapacityJ: 80 };
const boricAcid = { defaultTemperature: 0, maxTemperature: 10, heatCapacityJ: null };
const sweetSyrup = { defaultTemperature: 0, maxTemperature: 100, heatCapacityJ: null };
const solarConcentration = { defaultTemperature: 0, maxTemperature: 10000, heatCapacityJ: 32000 };

describe("temperatureFedDrain (#114)", () => {
  it("derives the uf6 reactor's fixed drain from maximum_temperature (engine rule)", () => {
    const d = temperatureFedDrain(
      {
        effectivity: 1,
        scale_fluid_usage: false,
        maximum_temperature: 250,
        fluid_box: { filter: "uf6" },
      },
      300_000,
      uf6,
    );
    // 300000 W ÷ ((250 − 0.01)° × 20 J/°) = 300000 / 4999.8 ≈ 60.0024 uf6/s
    expect(d.energyJPerUnit).toBeCloseTo(4999.8);
    expect(d.perSec).toBeCloseTo(60.0024, 4);
  });

  it("the MOX mk04 reactor: 3MW capped at 10000° of puo2", () => {
    const d = temperatureFedDrain(
      {
        effectivity: 1,
        scale_fluid_usage: false,
        maximum_temperature: 10000,
        fluid_box: { filter: "puo2" },
      },
      3_000_000,
      puo2,
    );
    // 3e6 ÷ ((10000 − 0.01) × 80) = 3e6 / 799999.2 ≈ 3.75 puo2/s
    expect(d.perSec).toBeCloseTo(3.75, 4);
  });

  it("an explicit fluid_usage_per_tick wins as a fixed drain (neutron absorber, solar tower)", () => {
    const absorber = temperatureFedDrain(
      {
        effectivity: 1,
        scale_fluid_usage: false,
        fluid_usage_per_tick: 0.033343333333333336,
        maximum_temperature: 10,
        fluid_box: { filter: "boric-acid" },
      },
      1,
      boricAcid,
    );
    expect(absorber.perSec).toBeCloseTo(2.0006, 5); // 0.0333433… × 60/s of boric-acid
    // no heat_capacity on boric-acid → engine default 1kJ: (10 − 0) × 1000
    expect(absorber.energyJPerUnit).toBeCloseTo(10_000);

    const tower = temperatureFedDrain(
      { effectivity: 1, fluid_usage_per_tick: 1, fluid_box: { filter: "solar-concentration" } },
      16_000_000_000,
      solarConcentration,
    );
    // fixed 60/s regardless of the 16GW draw; usable J from the FLUID's own
    // max_temperature (source cap unset = unlimited): (10000 − 0) × 32000
    expect(tower.perSec).toBe(60);
    expect(tower.energyJPerUnit).toBeCloseTo(3.2e8);
  });

  it("scale_fluid_usage sources get no fixed rate — the drain follows the energy draw", () => {
    const d = temperatureFedDrain(
      {
        effectivity: 1000,
        scale_fluid_usage: true,
        maximum_temperature: 10,
        fluid_box: { filter: "sweet-syrup" },
      },
      1_000_000,
      sweetSyrup,
    );
    expect(d.perSec).toBeNull();
    // (10 − 0)° × 1kJ default = 10kJ per unit; the solve divides the folded
    // 1kW draw by it → 0.1 sweet-syrup/s per compost plant
    expect(d.energyJPerUnit).toBeCloseTo(10_000);
  });

  it("effectivity divides the derived fixed drain (energy_usage is pre-fold here)", () => {
    const d = temperatureFedDrain(
      {
        effectivity: 2,
        scale_fluid_usage: false,
        maximum_temperature: 250,
        fluid_box: { filter: "uf6" },
      },
      300_000,
      uf6,
    );
    expect(d.perSec).toBeCloseTo(30.0012, 4);
  });

  it("returns nothing for fuel burners, filterless sources, and unknowable drains", () => {
    // burns_fluid → the #25 fuel path, not temperature
    expect(
      temperatureFedDrain({ burns_fluid: true, fluid_box: { filter: "diesel" } }, 1e6, null),
    ).toEqual({ perSec: null, energyJPerUnit: null });
    // no filter → the feed fluid is unknowable
    expect(temperatureFedDrain({ fluid_box: {} }, 1e6, uf6)).toEqual({
      perSec: null,
      energyJPerUnit: null,
    });
    // scaling source with no usable temperature anywhere → no drain data
    expect(
      temperatureFedDrain({ scale_fluid_usage: true, fluid_box: { filter: "mystery" } }, 1e6, {
        defaultTemperature: 15,
        maxTemperature: null,
        heatCapacityJ: null,
      }),
    ).toEqual({ perSec: null, energyJPerUnit: null });
  });
});
