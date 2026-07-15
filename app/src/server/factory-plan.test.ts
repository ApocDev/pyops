import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const meta = new Map<string, string>();
const persistBlock = vi.fn(async (..._args: unknown[]) => 1);
const traceEvents: { type: string; data: unknown }[] = [];
let piecewiseIron = false;
let ironImportOffset = 0;
let fixedBiocrud = 0;
let fixedAsh = 0;
let ashSinkAdditive = 0;
let infeasibleIronAbove = Number.POSITIVE_INFINITY;
let nonlinearElectricity = false;
let recoveredIronPerCoke = 10;
let ironGoalScalable = true;
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
const docs = new Map<
  number,
  {
    id: number;
    name: string;
    updatedAt: Date;
    data: {
      goals: { name: string; rate: number; temperature?: number }[];
      recipes: string[];
      supplyPriority?: number;
      fluidTemperatures?: Record<string, Record<string, number>>;
    };
  }
>(
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
  computeBlock: vi.fn(
    async (doc: {
      goals: { name: string; rate: number; temperature?: number }[];
      recipes?: string[];
      fluidTemperatures?: Record<string, Record<string, number>>;
    }) => {
      const steamGoal = doc.goals.find((goal) => goal.name === "steam");
      const steamTemperature = doc.recipes?.includes("steam-250")
        ? 250
        : doc.recipes?.includes("steam-2000")
          ? 2000
          : null;
      if (steamGoal && steamTemperature != null)
        return {
          broken: false,
          status: "solved",
          unmade: [],
          imports: [],
          exports: [],
          qualifiedGoals: {
            steam: [
              {
                name: "steam",
                kind: "fluid",
                rate: Math.abs(steamGoal.rate),
                temperatureMode: "exact" as const,
                minTemp: steamTemperature,
                maxTemp: steamTemperature,
              },
            ],
          },
        };
      const cokeGoal = doc.goals.find((goal) => goal.name === "coke");
      if (cokeGoal && steamGoal && doc.recipes?.includes("coke-steam")) {
        const cokeRate = Math.abs(cokeGoal.rate);
        const steamRate = Math.abs(steamGoal.rate);
        const recoveredSteam = cokeRate * 10;
        const totalSteam = Math.max(recoveredSteam, steamRate);
        // highs-js reads its pretty solution output, which exposes selector
        // primals at roughly six significant digits.
        const selectorRate = Number(steamRate.toPrecision(6));
        const surplusSteam = Math.max(0, totalSteam - selectorRate);
        return {
          broken: false,
          status: "solved",
          unmade: [],
          imports: [],
          exports:
            surplusSteam > 1e-9 ? [{ name: "steam", kind: "fluid", rate: surplusSteam }] : [],
          qualifiedExports:
            surplusSteam > 1e-9
              ? [
                  {
                    name: "steam",
                    kind: "fluid",
                    rate: surplusSteam,
                    temperatureMode: "exact" as const,
                    minTemp: 250,
                    maxTemp: 250,
                  },
                ]
              : [],
          qualifiedGoals: {
            steam: [
              {
                name: "steam",
                kind: "fluid",
                rate: selectorRate,
                temperatureMode: "exact" as const,
                minTemp: 250,
                maxTemp: 250,
              },
            ],
          },
        };
      }
      const tinGoal = doc.goals.find((goal) => goal.name === "tin");
      if (tinGoal && doc.recipes?.includes("tin-steam")) {
        const rate = Math.abs(tinGoal.rate);
        const temperature = doc.fluidTemperatures?.["tin-steam"]?.steam ?? 250;
        return {
          broken: false,
          status: "solved",
          unmade: [],
          imports: [{ name: "steam", kind: "fluid", rate: 10 * rate }],
          qualifiedImports: [
            {
              name: "steam",
              kind: "fluid",
              rate: 10 * rate,
              temperatureMode: "range" as const,
              minTemp: temperature,
              maxTemp: temperature,
            },
          ],
          exports: [],
        };
      }
      const ironGoal = doc.goals.find((goal) => goal.name === "iron");
      if (ironGoal && Math.abs(ironGoal.rate) > infeasibleIronAbove)
        return {
          broken: false,
          status: "infeasible",
          message: "No rates satisfy the proposed iron goal.",
          unmade: [],
          imports: [],
          exports: [],
        };
      const recoveredIronGoal = doc.goals.find((goal) => goal.name === "iron");
      if (cokeGoal && recoveredIronGoal) {
        const cokeRate = Math.abs(cokeGoal.rate);
        const ironRate = Math.abs(recoveredIronGoal.rate);
        const recoveredIron = cokeRate * recoveredIronPerCoke;
        const dedicatedIron = ironGoalScalable ? Math.max(0, ironRate - recoveredIron) : 0;
        return {
          broken: false,
          status: "solved",
          unmade: !ironGoalScalable && ironRate > recoveredIron ? ["iron"] : [],
          imports: [{ name: "ore", kind: "item", rate: cokeRate * 3 + dedicatedIron * 2 }],
          exports:
            recoveredIron > ironRate
              ? [{ name: "iron", kind: "item", rate: recoveredIron - ironRate }]
              : [],
        };
      }
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
          imports: [
            { name: "ash", kind: "item", rate: 1 },
            ...(ashSinkAdditive > 0
              ? [{ name: "additive", kind: "item", rate: ashSinkAdditive }]
              : []),
          ],
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
      if (fixedAsh > 0 && doc.goals.some((goal) => goal.name === "science"))
        exports.push({ name: "ash", kind: "item", rate: fixedAsh });
      return {
        broken: false,
        status: "solved",
        unmade: [],
        imports,
        exports,
      };
    },
  ),
  persistBlock,
  goalFlows: vi.fn((doc: { goals: { name: string; rate: number }[] }) =>
    doc.goals
      .filter((goal) => Math.abs(goal.rate) > 1e-9)
      .map((goal) => ({
        ...goal,
        kind: goal.name === "tar" || goal.name === "steam" ? "fluid" : "item",
      })),
  ),
  boundaryFlows: vi.fn(
    (
      goals: { name: string; kind: string; rate: number }[],
      result: {
        imports: { name: string; kind: string; rate: number }[];
        exports: { name: string; kind: string; rate: number }[];
        qualifiedImports?: Array<{
          name: string;
          kind: string;
          rate: number;
          temperatureMode: "exact" | "range";
          minTemp: number | null;
          maxTemp: number | null;
        }>;
        qualifiedExports?: Array<{
          name: string;
          kind: string;
          rate: number;
          temperatureMode: "exact" | "range";
          minTemp: number | null;
          maxTemp: number | null;
        }>;
        qualifiedGoals?: Record<
          string,
          Array<{
            name: string;
            kind: string;
            rate: number;
            temperatureMode: "exact" | "range";
            minTemp: number | null;
            maxTemp: number | null;
          }>
        >;
      },
    ) => [
      ...goals.flatMap((goal) => {
        const qualified = result.qualifiedGoals?.[goal.name];
        if (qualified?.length) {
          const total = qualified.reduce((sum, flow) => sum + flow.rate, 0);
          let assigned = 0;
          return qualified.map(({ name: _name, ...flow }, index) => {
            const rate =
              index === qualified.length - 1
                ? Math.max(0, Math.abs(goal.rate) - assigned)
                : total > 0
                  ? (Math.abs(goal.rate) * flow.rate) / total
                  : 0;
            assigned += rate;
            return {
              ...flow,
              item: goal.name,
              role: goal.rate < 0 ? "import" : "primary",
              rate,
            };
          });
        }
        return [
          {
            item: goal.name,
            kind: goal.kind,
            role: goal.rate < 0 ? "import" : "primary",
            rate: Math.abs(goal.rate),
          },
        ];
      }),
      ...(result.qualifiedImports ?? result.imports)
        .filter((flow) => !goals.some((goal) => goal.name === flow.name))
        .map(({ name, ...flow }) => ({ ...flow, item: name, role: "import" })),
      ...(result.qualifiedExports ?? result.exports).map(({ name, ...flow }) => ({
        ...flow,
        item: name,
        role: "byproduct",
      })),
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
  fixedAsh = 0;
  ashSinkAdditive = 0;
  infeasibleIronAbove = Number.POSITIVE_INFINITY;
  nonlinearElectricity = false;
  recoveredIronPerCoke = 10;
  ironGoalScalable = true;
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

  it("retains demand covered by a coproduct as the block goal", async () => {
    blocks.push({
      id: 5,
      name: "Coke and iron",
      rate: 0,
      goals: [
        { name: "coke", rate: 0 },
        { name: "iron", rate: 0 },
      ],
      flows: [],
    });
    docs.set(5, {
      id: 5,
      name: "Coke and iron",
      updatedAt: new Date(++solveVersion * 1000),
      data: {
        goals: [
          { name: "coke", rate: 0 },
          { name: "iron", rate: 0 },
        ],
        recipes: ["recipe-5"],
      },
    });
    plan.saveFactoryPins([
      { good: "science", kind: "item", rate: 1 },
      { good: "coke", kind: "item", rate: 1 },
    ]);

    const result = await plan.solvePinnedFactory();

    expect(result.status).toBe("Optimal");
    const iron = result.goalChanges.find((change) => change.id === 5 && change.good === "iron");
    expect(iron).toEqual(
      expect.objectContaining({
        dedicatedRate: 0,
        factoryNeed: 4,
        projectedOutput: 10,
        factorySurplus: 6,
        recoveredRate: 4,
      }),
    );
    expect(iron?.requiredRate).toBeCloseTo(4);
    expect(result.supplyAllocations).toContainEqual(
      expect.objectContaining({ blockId: 5, good: "iron", incidental: true, rate: 4 }),
    );

    const applied = await plan.applyPinnedFactory();
    expect(applied.status).toBe("Optimal");
    const saved = persistBlock.mock.calls.find(
      ([meta]) => (meta as { id?: number } | undefined)?.id === 5,
    )?.[1] as { goals: { name: string; rate: number }[] } | undefined;
    expect(saved?.goals.find((goal) => goal.name === "iron")?.rate).toBeCloseTo(4);
  });

  it("scales a goal past supply recovered from a sibling goal", async () => {
    recoveredIronPerCoke = 2;
    blocks.push({
      id: 5,
      name: "Coke and iron",
      rate: 0,
      goals: [
        { name: "coke", rate: 0 },
        { name: "iron", rate: 0 },
      ],
      flows: [],
    });
    docs.set(5, {
      id: 5,
      name: "Coke and iron",
      updatedAt: new Date(++solveVersion * 1000),
      data: {
        goals: [
          { name: "coke", rate: 0 },
          { name: "iron", rate: 0 },
        ],
        recipes: ["recipe-5"],
        supplyPriority: 1,
      },
    });
    plan.saveFactoryPins([
      { good: "science", kind: "item", rate: 1 },
      { good: "coke", kind: "item", rate: 1 },
    ]);

    const result = await plan.solvePinnedFactory();

    expect(result.status).toBe("Optimal");
    expect(result.validation).toBeNull();
    expect(result.goalChanges).toContainEqual(
      expect.objectContaining({
        id: 5,
        good: "iron",
        requiredRate: 4,
        projectedOutput: 4,
      }),
    );
  });

  it("reports a configured goal whose output is genuinely not scalable", async () => {
    recoveredIronPerCoke = 2;
    ironGoalScalable = false;
    blocks.push({
      id: 5,
      name: "Coke and iron",
      rate: 0,
      goals: [
        { name: "coke", rate: 0 },
        { name: "iron", rate: 0 },
      ],
      flows: [],
    });
    docs.set(5, {
      id: 5,
      name: "Coke and iron",
      updatedAt: new Date(++solveVersion * 1000),
      data: {
        goals: [
          { name: "coke", rate: 0 },
          { name: "iron", rate: 0 },
        ],
        recipes: ["recipe-5"],
        supplyPriority: 1,
      },
    });
    plan.saveFactoryPins([
      { good: "science", kind: "item", rate: 1 },
      { good: "coke", kind: "item", rate: 1 },
    ]);

    const result = await plan.solvePinnedFactory();

    expect(result.status).toBe("Infeasible");
    expect(result.validation?.materialConflicts).toContainEqual(
      expect.objectContaining({
        good: "iron",
        direction: "shortage",
        amount: 2,
        required: 4,
        available: 2,
        blocks: expect.arrayContaining([
          expect.objectContaining({ id: 1, consumed: 4 }),
          expect.objectContaining({
            id: 5,
            supplied: 2,
            configuredProducer: true,
            scalableProducer: false,
          }),
        ]),
      }),
    );
  });

  it("routes a pinned fluid ingredient only from a compatible temperature source", async () => {
    blocks.push(
      {
        id: 5,
        name: "250C steam",
        rate: 0,
        goals: [{ name: "steam", rate: 0 }],
        flows: [],
      },
      {
        id: 6,
        name: "2000C steam",
        rate: 0,
        goals: [{ name: "steam", rate: 0 }],
        flows: [],
      },
      {
        id: 7,
        name: "Tin",
        rate: 0,
        goals: [{ name: "tin", rate: 0 }],
        flows: [],
      },
    );
    docs.set(5, {
      id: 5,
      name: "250C steam",
      updatedAt: new Date(++solveVersion * 1000),
      data: { goals: [{ name: "steam", rate: 0 }], recipes: ["steam-250"] },
    });
    docs.set(6, {
      id: 6,
      name: "2000C steam",
      updatedAt: new Date(++solveVersion * 1000),
      data: {
        goals: [{ name: "steam", rate: 0 }],
        recipes: ["steam-2000"],
        supplyPriority: 100,
      },
    });
    docs.set(7, {
      id: 7,
      name: "Tin",
      updatedAt: new Date(++solveVersion * 1000),
      data: {
        goals: [{ name: "tin", rate: 0 }],
        recipes: ["tin-steam"],
        fluidTemperatures: { "tin-steam": { steam: 250 } },
      },
    });
    plan.saveFactoryPins([{ good: "tin", kind: "item", rate: 1 }]);

    const result = await plan.solvePinnedFactory();

    expect(result.status).toBe("Optimal");
    expect(result.goalChanges).toContainEqual(
      expect.objectContaining({ id: 5, good: "steam", requiredRate: 10 }),
    );
    expect(result.goalChanges).not.toContainEqual(
      expect.objectContaining({ id: 6, good: "steam", requiredRate: expect.any(Number) }),
    );
  });

  it("recovers a temperature-qualified fluid goal from a limited-precision coproduct plateau", async () => {
    blocks.push(
      {
        id: 5,
        name: "Coke and 250C steam",
        rate: 1,
        goals: [
          { name: "coke", rate: 1 },
          { name: "steam", rate: 1.666665 },
        ],
        flows: [],
      },
      {
        id: 6,
        name: "2000C steam",
        rate: 0,
        goals: [{ name: "steam", rate: 0 }],
        flows: [],
      },
      {
        id: 7,
        name: "Tin",
        rate: 0,
        goals: [{ name: "tin", rate: 0 }],
        flows: [],
      },
    );
    docs.set(5, {
      id: 5,
      name: "Coke and 250C steam",
      updatedAt: new Date(++solveVersion * 1000),
      data: {
        goals: [
          { name: "coke", rate: 1 },
          { name: "steam", rate: 1.666665, temperature: 250 },
        ],
        recipes: ["coke-steam"],
      },
    });
    docs.set(6, {
      id: 6,
      name: "2000C steam",
      updatedAt: new Date(++solveVersion * 1000),
      data: {
        goals: [{ name: "steam", rate: 0 }],
        recipes: ["steam-2000"],
        supplyPriority: 100,
      },
    });
    docs.set(7, {
      id: 7,
      name: "Tin",
      updatedAt: new Date(++solveVersion * 1000),
      data: {
        goals: [{ name: "tin", rate: 0 }],
        recipes: ["tin-steam"],
        fluidTemperatures: { "tin-steam": { steam: 250 } },
      },
    });
    plan.saveFactoryPins([
      { good: "coke", kind: "item", rate: 1 },
      { good: "tin", kind: "item", rate: 0.5 },
    ]);

    const result = await plan.solvePinnedFactory();

    expect(
      result.status,
      JSON.stringify({
        result,
        trace: traceEvents.filter((event) => event.type.includes("linear")),
      }),
    ).toBe("Optimal");
    expect(result.goalChanges).toContainEqual(
      expect.objectContaining({ id: 5, good: "steam", requiredRate: 5, temperature: 250 }),
    );
    expect(result.goalChanges).not.toContainEqual(
      expect.objectContaining({ id: 6, good: "steam", requiredRate: expect.any(Number) }),
    );
    const model = traceEvents.find((event) => event.type === "pinned-model")?.data as
      | { columns?: Array<{ blockId: number; good: string; activeAtReference: boolean }> }
      | undefined;
    expect(model?.columns).toContainEqual(
      expect.objectContaining({ blockId: 5, good: "steam", activeAtReference: false }),
    );
  });

  it("sends fixed and scalable byproducts through the configured consumer", async () => {
    fixedAsh = 5;
    ashSinkAdditive = 0.1;
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

    expect(result.status).toBe("Optimal");
    expect(result.goalChanges).toContainEqual(
      expect.objectContaining({ id: 4, good: "ash", requiredRate: -15 }),
    );
    expect(result.raws).toContainEqual(
      expect.objectContaining({ good: "additive", projected: 1.5 }),
    );
    expect(result.overproduced.some((flow) => flow.good === "ash")).toBe(false);
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

  it("returns the block and proposed goals when full validation fails", async () => {
    infeasibleIronAbove = 2;

    const result = await plan.solvePinnedFactory();

    expect(result.status).toBe("ValidationFailed");
    expect(result.validation?.blocks).toContainEqual(
      expect.objectContaining({
        id: 2,
        name: "Iron",
        status: "infeasible",
        message: "No rates satisfy the proposed iron goal.",
        goals: [expect.objectContaining({ good: "iron", rate: 4 })],
      }),
    );
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

  it("captures a fixed response offset after re-linearizing", async () => {
    ironImportOffset = 0.02;

    const result = await plan.solvePinnedFactory();

    expect(result.status).toBe("Optimal");
    expect(result.passes).toBe(2);
    expect(result.residual).toBe(0);
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

  it("keeps electricity external when the factory has no configured supplier", async () => {
    nonlinearElectricity = true;

    const preview = await plan.solvePinnedFactory();
    const apply = await plan.applyPinnedFactory({}, false);

    expect(preview.status).toBe("Optimal");
    expect(preview.residual).toBe(0);
    expect(preview.raws).toContainEqual(
      expect.objectContaining({ good: "pyops-electricity", projected: 16 }),
    );
    expect(apply).toEqual(expect.objectContaining({ status: "Optimal", validated: true }));
  });

  it("scales a configured power goal to cover coupled electricity demand", async () => {
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
    expect(result.goalChanges).toContainEqual(
      expect.objectContaining({
        id: 5,
        good: "pyops-electricity",
        currentRate: 10,
        requiredRate: 16,
      }),
    );
    expect(result.raws).not.toContainEqual(expect.objectContaining({ good: "pyops-electricity" }));
  });
});
