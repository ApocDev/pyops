import { describe, expect, it } from "vite-plus/test";
import { factoryBalanceStep } from "./factory-balance-step.server.ts";
import type { BlockWithFlows } from "./factory-solve.server.ts";

const block = (
  id: number,
  name: string,
  goal: { name: string; rate: number },
  flows: BlockWithFlows["flows"],
): BlockWithFlows => ({ id, name, rate: goal.rate, goals: [goal], flows });

describe("factoryBalanceStep", () => {
  it("keeps a terminal goal pinned and adjusts its upstream producer", () => {
    const plates = block(1, "Plates", { name: "plate", rate: 1 }, [
      { item: "plate", kind: "item", role: "primary", rate: 1 },
      { item: "ore", kind: "item", role: "import", rate: 2 },
    ]);
    const gears = block(2, "Gears", { name: "gear", rate: 2 }, [
      { item: "gear", kind: "item", role: "primary", rate: 2 },
      { item: "plate", kind: "item", role: "import", rate: 4 },
    ]);

    const result = factoryBalanceStep([plates, gears]);

    expect(result.demands).toContainEqual(
      expect.objectContaining({ good: "gear", current: 2, target: 2 }),
    );
    expect(result.goalChanges).toEqual([
      expect.objectContaining({ good: "plate", currentRate: 1, requiredRate: 4 }),
    ]);
  });

  it("starts an idle configured producer from downstream demand", () => {
    const coke = block(1, "Coke", { name: "coke", rate: 0 }, [
      { item: "coke", kind: "item", role: "primary", rate: 1 },
      { item: "coal", kind: "item", role: "import", rate: 2 },
    ]);
    coke.currentFlows = [{ item: "coke", kind: "item", role: "primary", rate: 0 }];
    coke.currentScale = 0;
    coke.probe = { goal: "coke", rate: 1 };
    const consumer = block(2, "Steel", { name: "steel", rate: 1 }, [
      { item: "steel", kind: "item", role: "primary", rate: 1 },
      { item: "coke", kind: "item", role: "import", rate: 5 },
    ]);

    const result = factoryBalanceStep([coke, consumer]);

    expect(result.status).toBe("Optimal");
    expect(result.goalChanges).toContainEqual(
      expect.objectContaining({
        good: "coke",
        currentRate: 0,
        requiredRate: 5,
        activation: true,
      }),
    );
  });

  it("does not activate a zero goal whose normalized probe failed", () => {
    const unavailable = block(1, "Unavailable", { name: "coke", rate: 0 }, [
      { item: "coke", kind: "item", role: "primary", rate: 0 },
    ]);
    const consumer = block(2, "Steel", { name: "steel", rate: 1 }, [
      { item: "steel", kind: "item", role: "primary", rate: 1 },
      { item: "coke", kind: "item", role: "import", rate: 5 },
    ]);

    const result = factoryBalanceStep([unavailable, consumer]);

    expect(result.goalChanges).toEqual([]);
    expect(result.raws).toContainEqual(
      expect.objectContaining({ good: "coke", current: 5, projected: 5 }),
    );
  });

  it("adjusts a negative goal to absorb byproduct surplus", () => {
    const source = block(1, "Source", { name: "science", rate: 1 }, [
      { item: "science", kind: "item", role: "primary", rate: 1 },
      { item: "waste", kind: "fluid", role: "byproduct", rate: 10 },
    ]);
    const sink = block(2, "Sink", { name: "waste", rate: -2 }, [
      { item: "waste", kind: "fluid", role: "import", rate: 2 },
    ]);

    const result = factoryBalanceStep([source, sink]);

    expect(result.goalChanges).toContainEqual(
      expect.objectContaining({ good: "waste", currentRate: -2, requiredRate: -10 }),
    );
  });

  it("leaves a good with no configured producer as a raw import", () => {
    const gears = block(1, "Gears", { name: "gear", rate: 1 }, [
      { item: "gear", kind: "item", role: "primary", rate: 1 },
      { item: "plate", kind: "item", role: "import", rate: 2 },
    ]);

    const result = factoryBalanceStep([gears]);

    expect(result.goalChanges).toEqual([]);
    expect(result.raws).toContainEqual(
      expect.objectContaining({ good: "plate", current: 2, projected: 2 }),
    );
  });

  it("assigns demand to the highest-priority configured producer", () => {
    const preferred = block(1, "Preferred", { name: "plate", rate: 1 }, [
      { item: "plate", kind: "item", role: "primary", rate: 1, priority: 100 },
    ]);
    preferred.priority = 100;
    const fallback = block(2, "Fallback", { name: "plate", rate: 1 }, [
      { item: "plate", kind: "item", role: "primary", rate: 1, priority: -100 },
    ]);
    fallback.priority = -100;
    const consumer = block(3, "Gears", { name: "gear", rate: 1 }, [
      { item: "gear", kind: "item", role: "primary", rate: 1 },
      { item: "plate", kind: "item", role: "import", rate: 2 },
    ]);

    const result = factoryBalanceStep([preferred, fallback, consumer]);

    expect(result.goalChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: preferred.id, good: "plate", requiredRate: 2 }),
        expect.objectContaining({ id: fallback.id, good: "plate", requiredRate: 0 }),
      ]),
    );
    expect(result.supplyAllocations).toContainEqual(
      expect.objectContaining({ blockId: preferred.id, good: "plate", rate: 2, priority: 100 }),
    );
  });

  it("does not rewrite separate terminal goals without an override", () => {
    const preferred = block(1, "Preferred", { name: "science", rate: 2 }, [
      { item: "science", kind: "item", role: "primary", rate: 2, priority: 100 },
    ]);
    preferred.priority = 100;
    const fallback = block(2, "Fallback", { name: "science", rate: 1 }, [
      { item: "science", kind: "item", role: "primary", rate: 1, priority: -100 },
    ]);
    fallback.priority = -100;

    const result = factoryBalanceStep([preferred, fallback]);

    expect(result.demands).toContainEqual(
      expect.objectContaining({ good: "science", current: 3, target: 3 }),
    );
    expect(result.goalChanges).toEqual([]);
  });
});
