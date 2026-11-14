import { describe, expect, it } from "vite-plus/test";
import {
  type BeltProto,
  type InserterBelt,
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
  planSushi,
  rocketCapacity,
  rowLogistics,
  type ResolvedLogistics,
  type SushiFlow,
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
const bulk: InserterProto = { ...fast, name: "bulk-inserter", bulk: true };
const stack: InserterProto = {
  ...base,
  name: "py-stack-inserter",
  rotationSpeed: 0.0238,
  extensionSpeed: 0.1,
  pickupY: -1.5,
  dropY: 1.69921875,
  bulk: true,
  baseStackBonus: 12,
  maxBeltStackSize: 8,
};
// pycranes cranes with their auto-upgrade tiers' stack_size_bonus values.
const craneMk2: InserterProto = {
  ...fast,
  name: "crane-mk2",
  pickupX: 0.5,
  pickupY: -1,
  dropX: -0.30078125,
  dropY: 1.19921875,
  baseStackBonus: 5,
  upgradeStackBonuses: [5, 10, 15],
};
const craneShortMk2: InserterProto = {
  ...fast,
  name: "crane-short-mk2",
  baseStackBonus: 2,
  upgradeStackBonuses: [2, 4, 6],
};
const craneMk3: InserterProto = {
  ...craneMk2,
  name: "crane-mk3",
  bulk: true,
  upgradeStackBonuses: [5, 10, 15, 20, 25, 30, 40, 50, 60],
};
const craneMk4: InserterProto = {
  ...stack,
  name: "crane-mk4",
  pickupX: 0.5,
  dropX: -0.5,
  baseStackBonus: 77,
  upgradeStackBonuses: [77, 82, 87, 92, 97, 102, 112, 122, 132],
};
/** Research in the measurement save: inserter stack +1, bulk +3, belt stack +2. */
const RESEARCH = { belt: 2, inserter: 1, bulkInserter: 3 };

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

describe("sushi planner", () => {
  const resolved: ResolvedLogistics = {
    belt: YELLOW,
    placedStack: 1,
    moverKind: "inserter",
    inserter: base,
    handStack: 1,
  };
  const flow = (name: string, rate: number, role: "in" | "out" = "in"): SushiFlow => ({
    name,
    rate,
    role,
  });

  it("computes utilization, lap time, and slots from the loop geometry", () => {
    // 6 + 4 + 2 = 12/s on a 15/s yellow belt; 100 tiles at 1.875 tiles/s
    const p = planSushi(resolved, [flow("a", 6), flow("b", 4, "out"), flow("c", 2)], 100);
    expect(p?.utilization).toBeCloseTo(0.8, 6);
    expect(p?.lapSeconds).toBeCloseTo(100 / 1.875, 4);
    expect(p?.slots).toBe(800);
  });

  it("set-points are rate × lap (Little's law), floored for trace items", () => {
    const p = planSushi(resolved, [flow("a", 6), flow("b", 0.01)], 100);
    const lap = 100 / 1.875;
    const a = p?.rows.find((r) => r.name === "a");
    const b = p?.rows.find((r) => r.name === "b");
    expect(a?.onBelt).toBe(Math.ceil(6 * lap)); // 320
    expect(b?.onBelt).toBe(2); // floored — 0.01 × 53s rounds to 1
    // floored trace item dwells far longer than a lap
    expect(b?.dwellSeconds).toBeCloseTo(2 / 0.01, 6);
    expect(a?.dominant).toBe(true); // > half the flow
  });

  it("verdict bands follow utilization", () => {
    const at = (total: number) =>
      planSushi(resolved, [flow("a", total / 2), flow("b", total / 2)], 1000)?.verdict;
    expect(at(6)).toBe("comfortable"); // 40%
    expect(at(12)).toBe("tight"); // 80%
    expect(at(14)).toBe("fragile"); // 93%
    expect(at(20)).toBe("over-capacity"); // 133%
  });

  it("flags a loop whose slots can't hold the set-points", () => {
    // 1 tile = 8 slots, but 5 trace items × floor-of-2 = 10 items must ride it
    const p = planSushi(
      resolved,
      ["a", "b", "c", "d", "e"].map((n) => flow(n, 0.01)),
      1,
    );
    expect(p?.onBeltTotal).toBe(10);
    expect(p?.slots).toBe(8);
    expect(p?.verdict).toBe("loop-too-small");
    expect(p?.ok).toBe(false);
  });

  it("flags spoilables that dwell too long on the loop", () => {
    // trace spoilable: floored to 2 on belt → dwell 200 s ≫ ¼ of its 60 s spoil time
    const p = planSushi(resolved, [flow("a", 6), { ...flow("rot", 0.01), spoilSeconds: 60 }], 100);
    expect(p?.rows.find((r) => r.name === "rot")?.spoilRisk).toBe(true);
    expect(p?.rows.find((r) => r.name === "a")?.spoilRisk).toBe(false);
  });

  it("needs a belt, two flows, a positive total, and a real loop", () => {
    expect(
      planSushi({ ...resolved, belt: undefined }, [flow("a", 6), flow("b", 4)], 100),
    ).toBeNull();
    expect(planSushi(resolved, [flow("a", 12)], 100)).toBeNull();
    expect(planSushi(resolved, [flow("a", 0), flow("b", 0)], 100)).toBeNull();
    expect(planSushi(resolved, [flow("a", 6), flow("b", 4)], 0)).toBeNull();
  });

  it("stacking raises both throughput and slots", () => {
    const p = planSushi({ ...resolved, placedStack: 4 }, [flow("a", 30), flow("b", 30)], 100);
    expect(p?.utilization).toBeCloseTo(1, 6); // 60/s on a 60/s stacked yellow
    expect(p?.slots).toBe(3200);
  });
});

describe("inserter swing model", () => {
  it("half swing is one tick under inserter-throughput-lib's ceil (2.1 measurements)", () => {
    expect(inserterSwingTicks(base)).toBe(24); // 48-tick cycle
    expect(inserterSwingTicks(fast)).toBe(12);
    expect(inserterSwingTicks(stack)).toBe(21);
    expect(inserterSwingTicks(craneMk2)).toBe(11);
  });
  it("chest to chest scales linearly with hand stack size", () => {
    expect(inserterThroughput(base, 1)).toBeCloseTo(1.25, 4);
    expect(inserterThroughput(base, 3)).toBeCloseTo(3.75, 4);
  });
});

describe("hand stack size from research", () => {
  const none = { belt: 0, inserter: 0, bulkInserter: 0 };
  it("non-bulk inserter uses the inserter-stack bonus", () => {
    expect(inserterHandStack(base, none)).toBe(1);
    expect(inserterHandStack(base, { belt: 0, inserter: 2, bulkInserter: 11 })).toBe(3);
  });
  it("bulk inserter adds its built-in bonus and the bulk-capacity bonus", () => {
    expect(inserterHandStack(stack, none)).toBe(13);
    expect(inserterHandStack(stack, { belt: 0, inserter: 2, bulkInserter: 3 })).toBe(16);
  });
  it("cranes use the upgrade tier research has reached (in-game target pickup counts)", () => {
    expect(inserterHandStack(craneMk2, none)).toBe(6);
    expect(inserterHandStack(craneMk2, RESEARCH)).toBe(12); // crane-mk2u1
    expect(inserterHandStack(craneShortMk2, RESEARCH)).toBe(6); // crane-short-mk2u1
    expect(inserterHandStack(craneMk3, RESEARCH)).toBe(24); // crane-mk3u3
    expect(inserterHandStack(craneMk4, RESEARCH)).toBe(96); // crane-mk4u3
    // past the last tier, research still adds on top of it
    expect(inserterHandStack(craneMk2, { belt: 0, inserter: 5, bulkInserter: 0 })).toBe(21);
  });
});

/** Fails unless `model` is within `tolerance` (a fraction) of the in-game `measured`. */
const expectNear = (model: number, measured: number, tolerance = 0.05) =>
  expect(Math.abs(model / measured - 1)).toBeLessThan(tolerance);

describe("inserter throughput vs in-game measurements (iron plate, Factorio 2.1)", () => {
  const hand = (p: InserterProto, b = RESEARCH) => inserterHandStack(p, b);
  const fromBelt: InserterBelt = { end: "pickup", speed: YELLOW.speed, placedStack: 3 };
  const toBelt: InserterBelt = { end: "drop", speed: YELLOW.speed, placedStack: 3 };

  it("chest to chest, no research (#281)", () => {
    const none = { belt: 0, inserter: 0, bulkInserter: 0 };
    expectNear(inserterThroughput(stack, hand(stack, none)), 18.6, 0.02);
    expectNear(inserterThroughput(craneMk2, hand(craneMk2, none)), 16.38, 0.02);
    expectNear(inserterThroughput(craneShortMk2, hand(craneShortMk2, none)), 7.49, 0.02);
  });

  it("chest to chest, with research (#281, #282)", () => {
    expectNear(inserterThroughput(base, hand(base)), 2.48, 0.02);
    expectNear(inserterThroughput(fast, hand(fast)), 4.95, 0.02);
    expectNear(inserterThroughput(bulk, hand(bulk)), 9.9, 0.02);
    expectNear(inserterThroughput(stack, hand(stack)), 22.6, 0.02);
    expectNear(inserterThroughput(craneMk3, hand(craneMk3)), 65.74, 0.02);
  });

  it("belt to chest, a row's input inserters (#282)", () => {
    expectNear(inserterThroughput(base, hand(base), fromBelt), 2.5);
    expectNear(inserterThroughput(bulk, hand(bulk), fromBelt), 9.99);
    expectNear(inserterThroughput(stack, hand(stack), fromBelt), 19.05);
    expectNear(inserterThroughput(craneMk3, hand(craneMk3), fromBelt), 36.0, 0.06);
    // unstacked belts: 4 quick grabs, then one item per 4 ticks (yellow, both
    // lanes) or about one per 3 ticks (fast and express, hand-limited)
    expectNear(inserterThroughput(stack, 16, { ...fromBelt, placedStack: 1 }), 10.67, 0.02);
    const unstacked = (speed: number): InserterBelt => ({ end: "pickup", speed, placedStack: 1 });
    expectNear(inserterThroughput(stack, 16, unstacked(0.0625)), 11.73, 0.06);
    expectNear(inserterThroughput(stack, 16, unstacked(0.09375)), 11.73, 0.06);
    // The fast inserter chases belt items and measures 5.64/s. The model leaves
    // chasing out, so it stays at the chest-to-chest 5.0/s (11% low, safe side).
    expect(inserterThroughput(fast, hand(fast), fromBelt)).toBeCloseTo(5, 4);
  });

  it("chest to belt, a row's output inserters (#282)", () => {
    expectNear(inserterThroughput(base, hand(base), toBelt), 2.45, 0.02);
    expectNear(inserterThroughput(fast, hand(fast), toBelt), 4.81, 0.02);
    expectNear(inserterThroughput(bulk, hand(bulk), toBelt), 6.0, 0.02);
    // drops 3-item belt stacks, so it carries 15 of its 16
    expectNear(inserterThroughput(stack, hand(stack), toBelt), 13.63, 0.02);
    expectNear(inserterThroughput(craneMk4, hand(craneMk4), toBelt), 20.7, 0.02);
  });

  it("never takes more than the belt brings or drops more than one lane holds", () => {
    const huge = { ...stack, rotationSpeed: 0.5, extensionSpeed: 1 };
    expect(inserterThroughput(huge, 64, { ...fromBelt, placedStack: 1 })).toBe(15);
    expect(inserterThroughput(huge, 64, { ...toBelt, placedStack: 1 })).toBe(7.5);
  });
});

describe("insertersForRate", () => {
  it("counts inserters to feed a building at a rate", () => {
    // base inserter at hand stack 1 = 1.25/s chest to chest; 5/s needs 4.
    expect(insertersForRate(5, base, 1)).toBeCloseTo(4, 4);
  });
});

describe("rowLogistics", () => {
  const resolved: ResolvedLogistics = {
    belt: YELLOW,
    placedStack: 3,
    moverKind: "inserter",
    inserter: bulk,
    handStack: 4,
  };
  it("sizes inputs off the belt and outputs onto it", () => {
    const input = rowLogistics(resolved, 20, 1, "input");
    const output = rowLogistics(resolved, 20, 1, "output");
    expect(input?.devices).toBeCloseTo(20 / 9.6, 4);
    expect(output?.devices).toBeCloseTo(20 / 6, 4);
    expect(input?.belts).toBe(output?.belts);
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
