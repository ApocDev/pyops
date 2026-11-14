import { describe, expect, it } from "vite-plus/test";
import {
  type RobotProto,
  type RoboportProto,
  robotFlows,
  robotPayload,
  robotSpeed,
  robotTrip,
  robotsForRate,
} from "./robots";

// py-logistic-robot-mk01 and py-roboport-mk01 from the Py data dump
const MK01: RobotProto = {
  name: "py-logistic-robot-mk01",
  display: null,
  speed: 0.08,
  maxPayloadSize: 3,
  maxEnergyJ: 1_500_000,
  energyPerMoveJ: 4000,
  energyPerTickJ: 50,
  minToCharge: 0.2,
  maxToCharge: 0.95,
};
const PORT: RoboportProto = {
  name: "py-roboport-mk01",
  display: null,
  chargingEnergyW: 350_000,
  logisticsRadius: 30,
};
const NO_BONUS = { speed: 0, storage: 0 };
const BOTS = { robot: MK01, roboport: PORT, bonuses: NO_BONUS };

describe("robot bonuses", () => {
  it("applies the force speed modifier and cargo bonus", () => {
    expect(robotSpeed(MK01, NO_BONUS)).toBeCloseTo(4.8);
    expect(robotSpeed(MK01, { speed: 0.5, storage: 0 })).toBeCloseTo(7.2);
    expect(robotPayload(MK01, { speed: 0, storage: 2 })).toBe(5);
  });

  it("caps a load at one stack of the item", () => {
    expect(robotPayload(MK01, { speed: 0, storage: 2 }, 1)).toBe(1);
    expect(robotPayload(MK01, NO_BONUS, 200)).toBe(3);
    // a stack-size-1 item needs three times the MK 01 bots of a stackable one
    const stackable = robotsForRate(1, BOTS, 50, 50);
    expect(robotsForRate(1, BOTS, 50, 1)).toBeCloseTo(stackable * 3);
  });
});

describe("robotTrip", () => {
  it("is a plain round trip without a roboport (lower bound)", () => {
    const t = robotTrip(MK01, NO_BONUS, 50);
    expect(t.flightSeconds).toBeCloseTo(100 / 4.8);
    expect(t.chargeSeconds).toBe(0);
    expect(t.itemsPerSecond).toBeCloseTo(3 / (100 / 4.8));
  });

  it("spreads the charging detour and pad time over the trips one charge covers", () => {
    // One trip: 100 tiles × 4 kJ + 1250 ticks × 50 J = 462.5 kJ.
    // One charge: 0.75 × 1.5 MJ = 1.125 MJ, refilled at 350 kW in 3.21 s.
    // Detour: 30 tiles in 6.25 s for 138.75 kJ, so a charge covers 2.13 trips.
    const t = robotTrip(MK01, NO_BONUS, 50, PORT);
    const tripsPerCharge = (1_125_000 - 138_750) / 462_500;
    expect(t.chargeSeconds).toBeCloseTo((6.25 + 1_125_000 / 350_000) / tripsPerCharge);
    expect(t.itemsPerSecond).toBeLessThan(robotTrip(MK01, NO_BONUS, 50).itemsPerSecond);
  });

  it("charges mid-route when one trip outruns the battery", () => {
    const t = robotTrip(MK01, NO_BONUS, 500, PORT);
    // more than one charge per trip
    expect(t.chargeSeconds).toBeGreaterThan(6.25 + 1_125_000 / 350_000);
    expect(t.itemsPerSecond).toBeGreaterThan(0);
  });

  it("moves nothing when the detour alone drains a charge", () => {
    expect(robotTrip(MK01, NO_BONUS, 50, { ...PORT, logisticsRadius: 400 }).itemsPerSecond).toBe(0);
  });

  it("skips charging for a robot that uses no energy", () => {
    const free = { ...MK01, energyPerMoveJ: 0, energyPerTickJ: 0 };
    expect(robotTrip(free, NO_BONUS, 50, PORT).chargeSeconds).toBe(0);
  });
});

describe("robotsForRate", () => {
  it("scales with rate and distance and drops with the bonuses", () => {
    const near = robotsForRate(1, BOTS, 25);
    const far = robotsForRate(1, BOTS, 50);
    expect(far).toBeGreaterThan(near * 1.9);
    expect(robotsForRate(2, BOTS, 50)).toBeCloseTo(far * 2);
    expect(robotsForRate(1, { ...BOTS, bonuses: { speed: 1, storage: 3 } }, 50)).toBeLessThan(
      far / 2,
    );
    expect(robotsForRate(0, BOTS, 50)).toBe(0);
  });
});

describe("robotFlows", () => {
  it("keeps solved item flows and drops fluids and virtual goods", () => {
    const flows = robotFlows({
      imports: [
        { name: "iron-plate", kind: "item", rate: 2 },
        { name: "water", kind: "fluid", rate: 50 },
        { name: "pyops-electricity", kind: "fluid", rate: 3 },
        { name: "pyops-combinator-planner", kind: "item", rate: 1 },
      ],
      displayExports: [{ name: "steel-plate", kind: "item", rate: 1.5 }],
      goalOutputs: [
        { name: "gear", kind: "item", rate: 1 },
        { name: "pyops-heat", kind: "fluid", rate: 4 },
      ],
    });
    expect(flows.map((f) => f.name)).toEqual(["iron-plate", "steel-plate", "gear"]);
  });
});
