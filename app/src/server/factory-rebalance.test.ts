import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// Expose server-function handlers as ordinary callables so this test can cover
// the rebalance orchestration without starting TanStack Start.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: vi.fn(() => {
    const chain = {
      validator: vi.fn(() => chain),
      handler: vi.fn((handler: unknown) => handler),
    };
    return chain;
  }),
}));

vi.mock("../db/queries.server.ts", () => ({
  blocksWithFlows: vi.fn(),
  getBlock: vi.fn(),
  getFluid: vi.fn(() => null),
}));

vi.mock("./factory-balance-step.server.ts", () => ({ factoryBalanceStep: vi.fn() }));

vi.mock("./undo-action.server.ts", () => ({
  withUndoAction: vi.fn((_name: string, fn: () => unknown) => Promise.resolve(fn())),
}));

vi.mock("./block-compute.server.ts", () => ({
  blockSaveConflict: vi.fn(),
  blockUpdatedAt: vi.fn(),
  boundaryFlows: vi.fn(
    (
      goals: { name: string; kind: string; rate: number }[],
      result: {
        exports: { name: string; kind: string; rate: number }[];
        imports: { name: string; kind: string; rate: number }[];
      },
    ) => [
      ...goals.map((goal) => ({
        item: goal.name,
        kind: goal.kind,
        role: "primary",
        rate: goal.rate,
      })),
      ...result.exports.map((flow) => ({ ...flow, item: flow.name, role: "byproduct" })),
      ...result.imports.map((flow) => ({ ...flow, item: flow.name, role: "import" })),
    ],
  ),
  computeBlock: vi.fn(),
  defaultFuel: vi.fn(),
  goalFlows: vi.fn((doc: { goals: { name: string; rate: number }[] }) =>
    doc.goals.map((goal) => ({ ...goal, kind: "item" })),
  ),
  persistBlock: vi.fn(),
  pickDefaultMachine: vi.fn(),
  resolveAllBlocks: vi.fn(),
  showBlockInGame: vi.fn(),
}));

const q = await import("../db/queries.server.ts");
const blockCompute = await import("./block-compute.server.ts");
const factoryBalance = await import("./factory-balance-step.server.ts");
const undo = await import("./undo-action.server.ts");
const { applyFactoryRebalanceFn } = await import("./factorio.ts");

const persistedFlows = (
  good: string,
  rate = 1,
): ReturnType<typeof q.blocksWithFlows>[number]["flows"] => [
  { item: good, kind: "item", role: "primary", rate },
];

const blockRow = (id: number, good: string, rate = 1) =>
  ({
    id,
    name: `Block ${id}`,
    iconKind: "item",
    iconName: good,
    data: { goals: [{ name: good, rate }], recipes: [] },
  }) as unknown as NonNullable<ReturnType<typeof q.getBlock>>;

const factoryResult = (
  blocks: Parameters<typeof factoryBalance.factoryBalanceStep>[0],
  scales: Record<number, number>,
  status: ReturnType<typeof factoryBalance.factoryBalanceStep>["status"] = "Optimal",
): ReturnType<typeof factoryBalance.factoryBalanceStep> => {
  const report = blocks.map((block) => {
    const scale = scales[block.id] ?? 1;
    return {
      id: block.id,
      name: block.name,
      good: null,
      currentRate: block.rate,
      requiredRate: block.rate * scale,
      scale,
      delta: block.rate * scale - block.rate,
    };
  });
  return {
    status,
    blocks: report,
    demands: [],
    raws: [],
    overproduced: [],
    goalChanges: blocks.flatMap((block) => {
      const scale = scales[block.id] ?? 1;
      return (block.goals ?? []).flatMap((goal) =>
        Math.abs(scale - 1) <= 1e-9
          ? []
          : [
              {
                id: block.id,
                name: block.name,
                good: goal.name,
                kind: "item",
                currentRate: goal.rate,
                requiredRate: goal.rate * scale,
                scale,
                delta: goal.rate * scale - goal.rate,
                goal: true as const,
              },
            ],
      );
    }),
    supplyAllocations: [],
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(blockCompute.persistBlock).mockResolvedValue(1);
});

describe("applyFactoryRebalanceFn solve reuse", () => {
  it("uses persisted flows for pass one and solves only docs changed between passes", async () => {
    const firstFlows = persistedFlows("first");
    const secondFlows = persistedFlows("second");
    vi.mocked(q.blocksWithFlows).mockReturnValue([
      { id: 1, name: "Block 1", rate: 1, goals: [{ name: "first", rate: 1 }], flows: firstFlows },
      {
        id: 2,
        name: "Block 2",
        rate: 1,
        goals: [{ name: "second", rate: 1 }],
        flows: secondFlows,
      },
    ]);
    vi.mocked(q.getBlock).mockImplementation((id) =>
      id === 1 ? blockRow(1, "first") : blockRow(2, "second"),
    );

    const solved = { broken: false, status: "solved", exports: [], imports: [] };
    vi.mocked(blockCompute.computeBlock).mockResolvedValue(solved as never);
    vi.mocked(factoryBalance.factoryBalanceStep)
      .mockImplementationOnce((blocks) => {
        expect(blocks.map((block) => block.flows)).toEqual([firstFlows, secondFlows]);
        return factoryResult(blocks, { 1: 2, 2: 1 });
      })
      .mockImplementationOnce((blocks) => {
        expect(blocks.map((block) => block.rate)).toEqual([2, 1]);
        return factoryResult(blocks, { 1: 1, 2: 1 });
      });

    const result = await applyFactoryRebalanceFn({ data: { demands: { first: 2 } } });

    // Block 1 changed once, block 2 never changed, and persistence reuses the
    // converged solve instead of solving block 1 a second time.
    expect(blockCompute.computeBlock).toHaveBeenCalledTimes(1);
    expect(blockCompute.computeBlock).toHaveBeenCalledWith(
      expect.objectContaining({ goals: [{ name: "first", rate: 2 }] }),
    );
    expect(blockCompute.persistBlock).toHaveBeenCalledTimes(1);
    expect(blockCompute.persistBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ goals: [{ name: "first", rate: 2 }] }),
      solved,
    );
    expect(undo.withUndoAction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "Optimal",
      passes: 1,
      residual: 0,
      applied: [{ id: 1, name: "Block 1", from: 1, to: 2 }],
      broken: [],
    });
  });

  it("aborts atomically when a changed block cannot re-solve", async () => {
    vi.mocked(q.blocksWithFlows).mockReturnValue([
      {
        id: 1,
        name: "Block 1",
        rate: 1,
        goals: [{ name: "first", rate: 1 }],
        flows: persistedFlows("first"),
      },
    ]);
    vi.mocked(q.getBlock).mockReturnValue(blockRow(1, "first"));
    vi.mocked(blockCompute.computeBlock).mockResolvedValue({
      broken: true,
      exports: [],
      imports: [],
    } as never);
    vi.mocked(factoryBalance.factoryBalanceStep).mockImplementationOnce((blocks) =>
      factoryResult(blocks, { 1: 2 }),
    );

    const result = await applyFactoryRebalanceFn({ data: {} });

    expect(blockCompute.computeBlock).toHaveBeenCalledTimes(1);
    expect(blockCompute.persistBlock).not.toHaveBeenCalled();
    expect(result.status).toBe("Infeasible");
    expect(result.applied).toEqual([]);
    expect(result.broken).toEqual([{ id: 1, name: "Block 1" }]);
  });

  it("does no block solving when the persisted projection is already settled", async () => {
    vi.mocked(q.blocksWithFlows).mockReturnValue([
      {
        id: 1,
        name: "Block 1",
        rate: 1,
        goals: [{ name: "first", rate: 1 }],
        flows: persistedFlows("first"),
      },
    ]);
    vi.mocked(q.getBlock).mockReturnValue(blockRow(1, "first"));
    vi.mocked(factoryBalance.factoryBalanceStep).mockImplementationOnce((blocks) =>
      factoryResult(blocks, { 1: 1 }),
    );

    const result = await applyFactoryRebalanceFn({ data: {} });

    expect(blockCompute.computeBlock).not.toHaveBeenCalled();
    expect(blockCompute.persistBlock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "Optimal", passes: 0, residual: 0 });
  });

  it("probes and activates a valid zero-rate producer", async () => {
    const zeroFlows = persistedFlows("coke", 0);
    vi.mocked(q.blocksWithFlows).mockReturnValue([
      {
        id: 1,
        name: "Coke",
        rate: 0,
        goals: [{ name: "coke", rate: 0 }],
        flows: zeroFlows,
      },
    ]);
    vi.mocked(q.getBlock).mockReturnValue({
      ...blockRow(1, "coke", 0),
      name: "Coke",
      data: { goals: [{ name: "coke", rate: 0 }], recipes: ["make-coke"] },
    } as never);

    const probe = {
      broken: false,
      status: "solved",
      unmade: [],
      exports: [],
      imports: [{ name: "coal", kind: "item", rate: 2 }],
    };
    const activated = {
      broken: false,
      status: "solved",
      unmade: [],
      exports: [],
      imports: [{ name: "coal", kind: "item", rate: 4 }],
    };
    vi.mocked(blockCompute.computeBlock)
      .mockResolvedValueOnce(probe as never)
      .mockResolvedValueOnce(activated as never);
    vi.mocked(factoryBalance.factoryBalanceStep)
      .mockImplementationOnce((blocks) => {
        expect(blocks[0]).toMatchObject({
          rate: 0,
          currentScale: 0,
          probe: { goal: "coke", rate: 1 },
          currentFlows: zeroFlows,
        });
        expect(blocks[0]!.flows).toEqual([
          { item: "coke", kind: "item", role: "primary", rate: 1, priority: 0 },
          { name: "coal", item: "coal", kind: "item", role: "import", rate: 2, priority: 0 },
        ]);
        return {
          ...factoryResult(blocks, { 1: 2 }),
          goalChanges: [
            {
              id: 1,
              name: "Coke",
              good: "coke",
              kind: "item",
              currentRate: 0,
              requiredRate: 2,
              scale: 2,
              delta: 2,
              goal: true,
              activation: true,
            },
          ],
        };
      })
      .mockImplementationOnce((blocks) => {
        expect(blocks[0]).not.toHaveProperty("probe");
        expect(blocks[0]!.rate).toBe(2);
        return factoryResult(blocks, { 1: 1 });
      });

    const result = await applyFactoryRebalanceFn({ data: { demands: { coke: 2 } } });

    expect(blockCompute.computeBlock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ goals: [{ name: "coke", rate: 1 }] }),
    );
    expect(blockCompute.computeBlock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ goals: [{ name: "coke", rate: 2 }] }),
    );
    expect(blockCompute.persistBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ goals: [{ name: "coke", rate: 2 }] }),
      activated,
    );
    expect(result).toMatchObject({
      status: "Optimal",
      applied: [{ id: 1, name: "Coke", from: 0, to: 2 }],
      broken: [],
    });
  });

  it("applies and persists a secondary consume-goal change", async () => {
    const flows = [
      { item: "tar", kind: "fluid", role: "import", rate: 9.575 },
      { item: "scrude", kind: "fluid", role: "import", rate: 20 },
    ];
    vi.mocked(q.blocksWithFlows).mockReturnValue([
      {
        id: 1,
        name: "Tar",
        rate: -9.575,
        goals: [
          { name: "tar", rate: -9.575 },
          { name: "scrude", rate: -20 },
        ],
        flows,
      },
    ]);
    vi.mocked(q.getBlock).mockReturnValue({
      ...blockRow(1, "tar", -9.575),
      name: "Tar",
      data: {
        goals: [
          { name: "tar", rate: -9.575 },
          { name: "scrude", rate: -20 },
        ],
        recipes: ["scrude-refining"],
      },
    } as never);

    const solved = {
      broken: false,
      status: "solved",
      exports: [],
      imports: [
        { name: "tar", kind: "fluid", rate: 9.575 },
        { name: "scrude", kind: "fluid", rate: 61.88 },
      ],
    };
    vi.mocked(blockCompute.computeBlock).mockResolvedValue(solved as never);
    vi.mocked(factoryBalance.factoryBalanceStep)
      .mockImplementationOnce((blocks, _overrides, sinkBaselines) => {
        expect(sinkBaselines).toEqual(
          new Map([
            [`1\u0000tar`, -9.575],
            [`1\u0000scrude`, -20],
          ]),
        );
        return {
          ...factoryResult(blocks, { 1: 1 }),
          goalChanges: [
            {
              id: 1,
              name: "Tar",
              good: "scrude",
              kind: "fluid",
              currentRate: -20,
              requiredRate: -61.88,
              scale: 3.094,
              delta: -41.88,
              goal: true,
            },
          ],
        };
      })
      .mockImplementationOnce((blocks, _overrides, sinkBaselines) => {
        expect(sinkBaselines?.get(`1\u0000scrude`)).toBe(-20);
        return factoryResult(blocks, { 1: 1 });
      });

    const result = await applyFactoryRebalanceFn({ data: {} });

    expect(blockCompute.computeBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        goals: [
          { name: "tar", rate: -9.575 },
          { name: "scrude", rate: -61.88 },
        ],
      }),
    );
    expect(blockCompute.persistBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        goals: [
          { name: "tar", rate: -9.575 },
          { name: "scrude", rate: -61.88 },
        ],
      }),
      solved,
    );
    expect(result.applied).toEqual([{ id: 1, name: "Tar", from: -9.575, to: -9.575 }]);
  });
});
