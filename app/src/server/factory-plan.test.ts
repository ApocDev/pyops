import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const meta = new Map<string, string>();
const persistBlock = vi.fn(async (..._args: unknown[]) => 1);
const traceEvents: { type: string; data: unknown }[] = [];
let piecewiseIron = false;
let ironImportOffset = 0;
let fixedBiocrud = 0;
let nonlinearElectricity = false;
let solveVersion = 0;
const blocks = [
  {
    id: 1,
    name: "Science",
    rate: 1,
    goals: [{ name: "science", rate: 1 }],
    flows: [
      { item: "science", kind: "item", role: "primary", rate: 1 },
      { item: "iron", kind: "item", role: "import", rate: 4 },
    ],
  },
  {
    id: 2,
    name: "Iron",
    rate: 0,
    goals: [{ name: "iron", rate: 0 }],
    flows: [{ item: "iron", kind: "item", role: "primary", rate: 0 }],
  },
  {
    id: 3,
    name: "Tar",
    rate: -2,
    goals: [{ name: "tar", rate: -2 }],
    flows: [
      { item: "tar", kind: "fluid", role: "import", rate: 10 },
      { item: "ash", kind: "item", role: "byproduct", rate: 10 },
    ],
  },
  {
    id: 4,
    name: "Ash",
    rate: -5,
    goals: [{ name: "ash", rate: -5 }],
    flows: [
      { item: "ash", kind: "item", role: "import", rate: 5 },
      { item: "iron", kind: "item", role: "byproduct", rate: 5 },
    ],
  },
];
const docs = new Map(
  blocks.map((block) => [
    block.id,
    {
      id: block.id,
      name: block.name,
      updatedAt: new Date(0),
      data: { goals: block.goals, recipes: [`recipe-${block.id}`] },
    },
  ]),
);

vi.mock("../db/queries.server.ts", () => ({
  metaAll: vi.fn(() => Object.fromEntries(meta)),
  metaSet: vi.fn((key: string, value: string) => meta.set(key, value)),
  blocksWithFlows: vi.fn(() => blocks),
  getBlock: vi.fn((id: number) => docs.get(id) ?? null),
}));

vi.mock("./factory-debug.server.ts", () => ({
  startFactorySolverTrace: vi.fn(() => ({
    event: (type: string, data: unknown) => traceEvents.push({ type, data }),
    finish: vi.fn(),
    fail: vi.fn(),
  })),
}));
vi.mock("./undo-action.server.ts", () => ({
  withUndoAction: vi.fn(async (_name: string, action: () => unknown) => action()),
}));

vi.mock("./block-compute.server.ts", () => ({
  computeBlock: vi.fn(async (doc: { goals: { name: string; rate: number }[] }) => {
    const unitFlows: Record<
      string,
      {
        imports: { name: string; kind: string; rate: number }[];
        exports: { name: string; kind: string; rate: number }[];
      }
    > = {
      science: {
        imports: [{ name: "iron", kind: "item", rate: 4 }],
        exports: [],
      },
      iron: {
        imports: [{ name: "ore", kind: "item", rate: 2 }],
        exports: [],
      },
      tar: {
        imports: [{ name: "tar", kind: "fluid", rate: 1 }],
        exports: [{ name: "ash", kind: "item", rate: 1 }],
      },
      ash: {
        imports: [{ name: "ash", kind: "item", rate: 1 }],
        exports: [{ name: "iron", kind: "item", rate: 1 }],
      },
      coal: {
        imports: [{ name: "ore", kind: "item", rate: 3 }],
        exports: [{ name: "tar", kind: "fluid", rate: 10 }],
      },
    };
    const imports: { name: string; kind: string; rate: number }[] = [];
    const exports: { name: string; kind: string; rate: number }[] = [];
    for (const goal of doc.goals) {
      const magnitude = Math.abs(goal.rate);
      if (magnitude <= 1e-9) continue;
      const unit = unitFlows[goal.name];
      if (!unit) continue;
      const basisScale = piecewiseIron && goal.name === "iron" && magnitude > 2 ? 1.5 : 1;
      imports.push(
        ...unit.imports.map((flow) => ({
          ...flow,
          rate:
            flow.rate * magnitude * basisScale +
            (goal.name === "iron" && flow.name === "ore" ? ironImportOffset : 0),
        })),
      );
      exports.push(...unit.exports.map((flow) => ({ ...flow, rate: flow.rate * magnitude })));
      if (nonlinearElectricity && goal.name === "iron")
        imports.push({ name: "pyops-electricity", kind: "fluid", rate: magnitude ** 2 });
    }
    if (fixedBiocrud > 0 && doc.goals.some((goal) => goal.name === "science"))
      exports.push({ name: "biocrud", kind: "fluid", rate: fixedBiocrud });
    return {
      broken: false,
      status: "solved",
      unmade: [],
      imports,
      exports,
    };
  }),
  persistBlock,
  goalFlows: vi.fn((doc: { goals: { name: string; rate: number }[] }) =>
    doc.goals
      .filter((goal) => Math.abs(goal.rate) > 1e-9)
      .map((goal) => ({ ...goal, kind: goal.name === "tar" ? "fluid" : "item" })),
  ),
  boundaryFlows: vi.fn(
    (
      goals: { name: string; kind: string; rate: number }[],
      result: {
        imports: { name: string; kind: string; rate: number }[];
        exports: { name: string; kind: string; rate: number }[];
      },
    ) => [
      ...goals.map((goal) => ({
        item: goal.name,
        kind: goal.kind,
        role: goal.rate < 0 ? "import" : "primary",
        rate: Math.abs(goal.rate),
      })),
      ...result.imports
        .filter((flow) => !goals.some((goal) => goal.name === flow.name))
        .map((flow) => ({ ...flow, item: flow.name, role: "import" })),
      ...result.exports.map((flow) => ({ ...flow, item: flow.name, role: "byproduct" })),
    ],
  ),
}));

const plan = await import("./factory-plan.server.ts");

beforeEach(() => {
  meta.clear();
  persistBlock.mockClear();
  traceEvents.length = 0;
  piecewiseIron = false;
  ironImportOffset = 0;
  fixedBiocrud = 0;
  nonlinearElectricity = false;
  for (const doc of docs.values()) doc.updatedAt = new Date(++solveVersion * 1000);
  blocks.splice(4);
  docs.delete(5);
});

describe("pinned factory solve", () => {
  it("only activates goal columns reachable from explicit demand", async () => {
    const result = await plan.solvePinnedFactory();

    expect(
      result.status,
      JSON.stringify(traceEvents.filter((event) => event.type === "linearization-validation")),
    ).toBe("Optimal");
    expect(result.goalChanges).toContainEqual(
      expect.objectContaining({ id: 2, good: "iron", currentRate: 0, requiredRate: 4 }),
    );
    expect(result.goalChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 3, good: "tar", requiredRate: 0 }),
        expect.objectContaining({ id: 4, good: "ash", requiredRate: 0 }),
      ]),
    );
    expect(result.raws).toContainEqual(expect.objectContaining({ good: "ore", projected: 8 }));
    expect(result.overproduced.some((flow) => flow.good === "ash")).toBe(false);
  });

  it("persists explicit pins while stock pins remain derived", () => {
    plan.saveFactoryPins([{ good: "science", kind: "item", rate: 2 }]);

    expect(plan.getFactoryPins()).toContainEqual(
      expect.objectContaining({ good: "science", rate: 2, source: "explicit" }),
    );
  });

  it("uses a configured consumer for reached byproduct without scaling its source", async () => {
    blocks.push({
      id: 5,
      name: "Coal",
      rate: 0,
      goals: [{ name: "coal", rate: 0 }],
      flows: [{ item: "coal", kind: "item", role: "primary", rate: 0 }],
    });
    docs.set(5, {
      id: 5,
      name: "Coal",
      updatedAt: new Date(0),
      data: { goals: [{ name: "coal", rate: 0 }], recipes: ["recipe-5"] },
    });
    plan.saveFactoryPins([{ good: "coal", kind: "item", rate: 1 }]);

    const result = await plan.solvePinnedFactory();

    expect(
      result.status,
      JSON.stringify(traceEvents.filter((event) => event.type === "linearization-validation")),
    ).toBe("Optimal");
    expect(result.goalChanges).toContainEqual(
      expect.objectContaining({ id: 5, good: "coal", requiredRate: 1 }),
    );
    expect(result.goalChanges).toContainEqual(
      expect.objectContaining({ id: 3, good: "tar", requiredRate: -10 }),
    );
    expect(result.overproduced).toContainEqual(
      expect.objectContaining({ good: "iron", projected: 10 }),
    );
    expect(result.overproduced.some((flow) => flow.good === "coal")).toBe(false);
  });

  it("re-solves the combined docs before applying them", async () => {
    const result = await plan.applyPinnedFactory();

    expect(result.status).toBe("Optimal");
    expect(result.residual).toBe(0);
    expect(persistBlock).toHaveBeenCalledTimes(3);
    const tarDoc = persistBlock.mock.calls.find(
      ([meta]) => (meta as { id?: number } | undefined)?.id === 3,
    )?.[1] as { goals: { name: string; rate: number; direction?: string }[] } | undefined;
    expect(tarDoc?.goals).toContainEqual({ name: "tar", rate: 0, direction: "consume" });
  });

  it("re-linearizes when proposed goals cross a block solve basis", async () => {
    piecewiseIron = true;

    const result = await plan.solvePinnedFactory();

    expect(
      result.status,
      JSON.stringify(traceEvents.filter((event) => event.type === "linearization-validation")),
    ).toBe("Optimal");
    expect(result.passes).toBe(2);
    expect(result.residual).toBe(0);
    expect(result.raws).toContainEqual(expect.objectContaining({ good: "ore", projected: 12 }));
  });

  it("measures validation residue against gross throughput", async () => {
    ironImportOffset = 0.02;

    const result = await plan.solvePinnedFactory();

    expect(result.status).toBe("Optimal");
    expect(result.passes).toBe(2);
    expect(result.residual).toBeGreaterThan(0);
    expect(result.residual).toBeLessThan(0.005);
  });

  it("balances fixed incidental outputs as factory surplus", async () => {
    fixedBiocrud = 0.01;

    const result = await plan.solvePinnedFactory();

    expect(result.status).toBe("Optimal");
    expect(result.residual).toBe(0);
    expect(result.overproduced).toContainEqual(
      expect.objectContaining({ good: "biocrud", projected: 0.01 }),
    );
    expect(result.projection).toContainEqual(
      expect.objectContaining({ good: "biocrud", net: 0.01 }),
    );
  });

  it("does not fail material validation on a free energy boundary", async () => {
    nonlinearElectricity = true;

    const preview = await plan.solvePinnedFactory();
    const apply = await plan.applyPinnedFactory({}, false);

    expect(preview.status).toBe("Optimal");
    expect(preview.residual).toBe(0);
    expect(apply).toEqual(expect.objectContaining({ status: "Optimal", validated: true }));
  });

  it("retains an existing power goal and reports only real external demand", async () => {
    nonlinearElectricity = true;
    blocks.push({
      id: 5,
      name: "Power",
      rate: 10,
      goals: [{ name: "pyops-electricity", rate: 10 }],
      flows: [{ item: "pyops-electricity", kind: "fluid", role: "primary", rate: 10 }],
    });
    docs.set(5, {
      id: 5,
      name: "Power",
      updatedAt: new Date(++solveVersion * 1000),
      data: { goals: [{ name: "pyops-electricity", rate: 10 }], recipes: ["recipe-5"] },
    });
    plan.saveFactoryPins([{ good: "science", kind: "item", rate: 1 }]);

    const result = await plan.solvePinnedFactory();

    expect(result.status).toBe("Optimal");
    expect(result.goalChanges).not.toContainEqual(
      expect.objectContaining({ id: 5, good: "pyops-electricity" }),
    );
    expect(result.raws).toContainEqual(
      expect.objectContaining({ good: "pyops-electricity", projected: 6 }),
    );
  });
});
