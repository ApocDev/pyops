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

vi.mock("./factory-solve.server.ts", () => ({ factoryWhatIf: vi.fn() }));

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
const factorySolve = await import("./factory-solve.server.ts");
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
  blocks: Parameters<typeof factorySolve.factoryWhatIf>[0],
  scales: Record<number, number>,
  status: Awaited<ReturnType<typeof factorySolve.factoryWhatIf>>["status"] = "Optimal",
): Awaited<ReturnType<typeof factorySolve.factoryWhatIf>> => ({
  status,
  blocks: blocks.map((block) => {
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
  }),
  demands: [],
  raws: [],
  overproduced: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(blockCompute.persistBlock).mockResolvedValue(1);
});

describe("applyFactoryRebalanceFn solve reuse", () => {
  it("uses persisted flows for pass one and solves only docs changed between passes", async () => {
    const firstFlows = persistedFlows("first");
    const secondFlows = persistedFlows("second");
    vi.mocked(q.blocksWithFlows).mockReturnValue([
      { id: 1, name: "Block 1", rate: 1, flows: firstFlows },
      { id: 2, name: "Block 2", rate: 1, flows: secondFlows },
    ]);
    vi.mocked(q.getBlock).mockImplementation((id) =>
      id === 1 ? blockRow(1, "first") : blockRow(2, "second"),
    );

    const solved = { broken: false, exports: [], imports: [] };
    vi.mocked(blockCompute.computeBlock).mockResolvedValue(solved as never);
    vi.mocked(factorySolve.factoryWhatIf)
      .mockImplementationOnce(async (blocks) => {
        expect(blocks.map((block) => block.flows)).toEqual([firstFlows, secondFlows]);
        return factoryResult(blocks, { 1: 2, 2: 1 });
      })
      .mockImplementationOnce(async (blocks) => {
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

  it("retains a broken changed-doc result without retrying it during persistence", async () => {
    vi.mocked(q.blocksWithFlows).mockReturnValue([
      { id: 1, name: "Block 1", rate: 1, flows: persistedFlows("first") },
    ]);
    vi.mocked(q.getBlock).mockReturnValue(blockRow(1, "first"));
    vi.mocked(blockCompute.computeBlock).mockResolvedValue({
      broken: true,
      exports: [],
      imports: [],
    } as never);
    vi.mocked(factorySolve.factoryWhatIf)
      .mockImplementationOnce(async (blocks) => factoryResult(blocks, { 1: 2 }))
      .mockImplementationOnce(async (blocks) => factoryResult(blocks, { 1: 1 }));

    const result = await applyFactoryRebalanceFn({ data: {} });

    expect(blockCompute.computeBlock).toHaveBeenCalledTimes(1);
    expect(blockCompute.persistBlock).not.toHaveBeenCalled();
    expect(result.applied).toEqual([]);
    expect(result.broken).toEqual([{ id: 1, name: "Block 1" }]);
  });

  it("does no block solving when the persisted projection is already settled", async () => {
    vi.mocked(q.blocksWithFlows).mockReturnValue([
      { id: 1, name: "Block 1", rate: 1, flows: persistedFlows("first") },
    ]);
    vi.mocked(q.getBlock).mockReturnValue(blockRow(1, "first"));
    vi.mocked(factorySolve.factoryWhatIf).mockImplementationOnce(async (blocks) =>
      factoryResult(blocks, { 1: 1 }),
    );

    const result = await applyFactoryRebalanceFn({ data: {} });

    expect(blockCompute.computeBlock).not.toHaveBeenCalled();
    expect(blockCompute.persistBlock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "Optimal", passes: 0, residual: 0 });
  });
});
