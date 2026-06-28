import { describe, expect, it } from "vite-plus/test";
import {
  type BeltProto,
  type InserterProto,
  beltItemsPerSecond,
  beltsForRate,
  inserterHandStack,
  inserterSwingTicks,
  inserterThroughput,
  insertersForRate,
  launchesForRate,
  loadersForRate,
  placedBeltStack,
  rocketCapacity,
} from "./logistics";

// Reference prototypes straight from Py's data-raw-dump.json.
const YELLOW: BeltProto = { name: "transport-belt", display: "Transport belt", speed: 0.03125 };

const base: InserterProto = {
  name: "inserter",
  display: "Inserter",
  rotationSpeed: 0.02,
  extensionSpeed: 0.035,
  pickupX: 0,
  pickupY: -1,
  dropX: 0,
  dropY: 1.19921875,
  bulk: false,
  baseStackBonus: 0,
  maxBeltStackSize: 1,
};
const fast: InserterProto = {
  ...base,
  name: "fast-inserter",
  rotationSpeed: 0.04,
  extensionSpeed: 0.1,
};
const stack: InserterProto = {
  ...base,
  name: "py-stack-inserter",
  rotationSpeed: 0.0238,
  extensionSpeed: 0.1,
  pickupY: -1.5,
  dropY: 1.69921875,
  bulk: true,
  maxBeltStackSize: 8,
};

describe("belts", () => {
  it("yellow belt is 15/s per lane-pair at stack 1", () => {
    expect(beltItemsPerSecond(YELLOW.speed)).toBeCloseTo(15, 6);
  });
  it("belt stacking multiplies throughput up to the cap", () => {
    expect(beltItemsPerSecond(YELLOW.speed, 8)).toBeCloseTo(120, 6);
  });
  it("placed stack follows the belt bonus, clamped to 8, and off when stacking disabled", () => {
    expect(placedBeltStack(0, true)).toBe(1);
    expect(placedBeltStack(3, true)).toBe(4);
    expect(placedBeltStack(7, true)).toBe(8);
    expect(placedBeltStack(20, true)).toBe(8); // hard cap
    expect(placedBeltStack(7, false)).toBe(1); // stacking off
  });
  it("belts-for-rate divides by throughput", () => {
    expect(beltsForRate(30, YELLOW, 1)).toBeCloseTo(2, 6); // 30/s on a 15/s belt
    expect(beltsForRate(30, YELLOW, 8)).toBeCloseTo(0.25, 6); // stacked
  });
  it("loaders are belt-equivalent movers", () => {
    expect(loadersForRate(30, YELLOW, 1)).toBeCloseTo(2, 6);
  });
});

describe("inserter swing model (matches inserter-throughput-lib, inventory case)", () => {
  it("base inserter: 25-tick swing, 1.2 items/s at hand stack 1", () => {
    expect(inserterSwingTicks(base)).toBe(25);
    expect(inserterThroughput(base, 1)).toBeCloseTo(1.2, 4);
  });
  it("fast inserter: faster rotation → 13-tick swing", () => {
    expect(inserterSwingTicks(fast)).toBe(13);
    expect(inserterThroughput(fast, 1)).toBeCloseTo(60 / 26, 4);
  });
  it("throughput scales linearly with hand stack size", () => {
    expect(inserterThroughput(base, 3)).toBeCloseTo(3.6, 4);
  });
});

describe("hand stack size from research", () => {
  const none = { belt: 0, inserter: 0, bulkInserter: 0 };
  it("non-bulk inserter uses the inserter-stack bonus", () => {
    expect(inserterHandStack(base, none)).toBe(1);
    expect(inserterHandStack(base, { belt: 0, inserter: 2, bulkInserter: 11 })).toBe(3);
  });
  it("bulk inserter uses the bulk-capacity bonus", () => {
    expect(inserterHandStack(stack, { belt: 0, inserter: 2, bulkInserter: 11 })).toBe(12);
  });
});

describe("insertersForRate", () => {
  it("counts inserters to feed a building at a rate", () => {
    // base inserter at hand stack 1 = 1.2/s; feeding 6/s needs 5 inserters.
    expect(insertersForRate(6, base, 1)).toBeCloseTo(5, 4);
  });
});

describe("rocket launches", () => {
  const LIFT = 1_000_000;
  it("capacity is floor(lift / weight), min 1", () => {
    expect(rocketCapacity(2000, LIFT)).toBe(500); // iron ore
    expect(rocketCapacity(200_000, LIFT)).toBe(5); // satellite
    expect(rocketCapacity(3_000_000, LIFT)).toBe(1); // over-heavy → one per rocket
  });
  it("launches/min = rate*60 / capacity", () => {
    // 50 ore/s → 3000/min, 500 per rocket → 6 launches/min
    expect(launchesForRate(50, 2000, LIFT)).toBeCloseTo(6, 4);
  });
});
