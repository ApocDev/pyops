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
  planSushi,
  rocketCapacity,
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
