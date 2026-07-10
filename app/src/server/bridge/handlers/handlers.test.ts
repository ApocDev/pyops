import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { PROTOCOL_VERSION, type BridgeRequest } from "../protocol.ts";
import { dispatch } from "../handlers.ts";
import { handleBuilt } from "./built.ts";
import { handleResearch } from "./research.ts";
import { handleStats } from "./stats.ts";
import { handleTaskCapture, handleTaskList } from "./tasks.ts";
import { handleTurd } from "./turd.ts";

// Handlers are thin validators over the query/db layer; mock those so we can
// assert exactly what each one parses out of an (untrusted) mod payload, and how
// it handles malformed input.
vi.mock("../../../db/queries.server.ts", () => ({
  setResearchHorizon: vi.fn(),
  setBuiltMachines: vi.fn(() => ({ applied: 0, total: 0, changed: false })),
  setTurdSelectionsBulk: vi.fn(() => ({
    applied: 0,
    unknown: [],
    changed: false,
    mismatch: false,
  })),
  setProductionStats: vi.fn(() => ({ applied: 0 })),
  metaSet: vi.fn(),
}));
vi.mock("../../block-compute.server.ts", () => ({ resolveAllBlocks: vi.fn() }));
// pass-through: the undo wrapper's own behavior is covered by undo.test.ts
vi.mock("../../undo-action.server.ts", () => ({
  withUndoAction: vi.fn((_name: string, fn: () => unknown) => Promise.resolve(fn())),
}));
vi.mock("../../../db/tasks.server.ts", () => ({
  captureTask: vi.fn(() => ({ id: 7, title: "Build smelters" })),
  listTasks: vi.fn(() => []),
  getTask: vi.fn(() => null),
}));

const q = await import("../../../db/queries.server.ts");
const factorio = await import("../../block-compute.server.ts");
const tasks = await import("../../../db/tasks.server.ts");

const req = (payload: unknown, extra: Partial<BridgeRequest> = {}): BridgeRequest => ({
  protocol_version: 4,
  type: "state",
  payload,
  ...extra,
});

beforeEach(() => vi.clearAllMocks());

describe("handleResearch", () => {
  it("stores the researched set and stamps sync meta", async () => {
    expect(
      await handleResearch(
        req({
          researched: ["automation", "logistics"],
          mining_productivity_bonus: 1.7,
          recipe_productivity_bonuses: { "fawogae-spore": 0.35, broken: "x", zero: 0 },
        }),
      ),
    ).toBeNull();
    expect(q.setResearchHorizon).toHaveBeenCalledWith({
      researched: ["automation", "logistics"],
      miningProductivityBonus: 1.7,
      recipeProductivityBonuses: { "fawogae-spore": 0.35 },
    });
    expect(q.metaSet).toHaveBeenCalledWith("research_synced_count", "2");
  });

  it("filters non-string techs and treats a missing list as empty", async () => {
    await handleResearch(req({ researched: ["a", 1, null, "b"] }));
    expect(q.setResearchHorizon).toHaveBeenCalledWith({ researched: ["a", "b"] });
    await handleResearch(req({}));
    expect(q.setResearchHorizon).toHaveBeenLastCalledWith({ researched: [] });
  });

  it("clears the exact mining bonus only when a malformed bonus is explicitly sent", async () => {
    await handleResearch(
      req({ researched: ["a"], mining_productivity_bonus: "bad", recipe_productivity_bonuses: [] }),
    );
    expect(q.setResearchHorizon).toHaveBeenCalledWith({
      researched: ["a"],
      miningProductivityBonus: null,
      recipeProductivityBonuses: null,
    });
  });

  it("re-solves blocks only when the canonical research context changed", async () => {
    vi.mocked(q.setResearchHorizon).mockReturnValueOnce(true);
    await handleResearch(req({ researched: ["automation"] }));
    expect(factorio.resolveAllBlocks).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    vi.mocked(q.setResearchHorizon).mockReturnValueOnce(false);
    await handleResearch(req({ researched: ["automation"] }));
    expect(factorio.resolveAllBlocks).not.toHaveBeenCalled();
  });
});

describe("handleBuilt", () => {
  it("forwards well-formed entries and stamps the total", async () => {
    vi.mocked(q.setBuiltMachines).mockReturnValueOnce({ applied: 2, total: 12, changed: true });
    await handleBuilt(
      req({
        machines: [
          { machine: "furnace", recipe: "smelt", count: 10 },
          { machine: "drill", recipe: "", count: 2 },
        ],
      }),
    );
    expect(q.setBuiltMachines).toHaveBeenCalledWith([
      { machine: "furnace", recipe: "smelt", count: 10 },
      { machine: "drill", recipe: "", count: 2 },
    ]);
    expect(q.metaSet).toHaveBeenCalledWith("built_synced_count", "12");
  });

  it("drops bad machine/count entries and defaults recipe to ''", async () => {
    await handleBuilt(
      req({
        machines: [
          { machine: "furnace", count: 5 },
          { machine: 42, count: 5 },
          { machine: "drill", count: "x" },
          { machine: "lab", count: Number.NaN },
          "garbage",
        ],
      }),
    );
    expect(q.setBuiltMachines).toHaveBeenCalledWith([{ machine: "furnace", recipe: "", count: 5 }]);
  });
});

describe("handleTurd", () => {
  it("keeps only string sub-tech values and stamps applied/unknown meta", async () => {
    const unknown = [{ master: "bogus-master", sub: "sub-x" }];
    vi.mocked(q.setTurdSelectionsBulk).mockReturnValueOnce({
      applied: 1,
      unknown,
      changed: false,
      mismatch: false,
    });
    await handleTurd(req({ selections: { "mt-a": "sub-1", "mt-b": 99, "mt-c": null } }));
    expect(q.setTurdSelectionsBulk).toHaveBeenCalledWith({ "mt-a": "sub-1" });
    expect(q.metaSet).toHaveBeenCalledWith("turd_synced_count", "1");
    expect(q.metaSet).toHaveBeenCalledWith("turd_synced_unknown", JSON.stringify(unknown));
  });

  it("re-solves blocks only when the selections changed", async () => {
    vi.mocked(q.setTurdSelectionsBulk).mockReturnValueOnce({
      applied: 1,
      unknown: [],
      changed: true,
      mismatch: false,
    });
    await handleTurd(req({ selections: { "mt-a": "sub-1" } }));
    expect(factorio.resolveAllBlocks).toHaveBeenCalledTimes(1);
  });

  it("does not re-solve when nothing changed, and tolerates a non-object payload", async () => {
    await handleTurd(req({ selections: "nope" }));
    expect(q.setTurdSelectionsBulk).toHaveBeenCalledWith({});
    expect(factorio.resolveAllBlocks).not.toHaveBeenCalled();
  });
});

describe("handleStats", () => {
  it("coerces non-finite rates to 0 and defaults kind to 'item'", async () => {
    await handleStats(
      req({
        items: [
          { name: "iron-plate", kind: "item", produced: 10, consumed: 4 },
          { name: "water", produced: Number.NaN, consumed: Infinity }, // non-finite → 0, kind→item
          { name: 5, produced: 1 }, // bad name → dropped
          null,
        ],
      }),
    );
    expect(q.setProductionStats).toHaveBeenCalledWith([
      { name: "iron-plate", kind: "item", produced: 10, consumed: 4 },
      { name: "water", kind: "item", produced: 0, consumed: 0 },
    ]);
  });

  it("treats a missing items array as no entries", async () => {
    await handleStats(req({}));
    expect(q.setProductionStats).toHaveBeenCalledWith([]);
  });
});

describe("handleTaskCapture", () => {
  it("creates a task and replies task.captured ok", async () => {
    const res = await handleTaskCapture(
      req(
        { title: "  Build smelters  ", x: 12, y: -3, surface: "nauvis" },
        { request_id: "r1", player: "jim" },
      ),
    );
    expect(tasks.captureTask).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Build smelters",
        title: "Build smelters",
        x: 12,
        y: -3,
        surface: "nauvis",
        player: "jim",
      }),
    );
    expect(res).toEqual({
      type: "task.captured",
      request_id: "r1",
      payload: { ok: true, id: 7, title: "Build smelters" },
    });
  });

  it("rejects an empty task with an error reply and creates nothing", async () => {
    const res = await handleTaskCapture(
      req({ body: "details but no title" }, { request_id: "r2" }),
    );
    expect(res).toEqual({
      type: "task.captured",
      request_id: "r2",
      payload: { ok: false, error: "a task needs a title" },
    });
    expect(tasks.captureTask).not.toHaveBeenCalled();
  });

  it("drops non-finite coordinates to null", async () => {
    await handleTaskCapture(req({ text: "go here", x: Number.NaN, y: "5" }));
    expect(tasks.captureTask).toHaveBeenCalledWith(expect.objectContaining({ x: null, y: null }));
  });
});

describe("handleTaskList", () => {
  it("replies task.list with the project's tasks", async () => {
    vi.mocked(tasks.listTasks).mockReturnValueOnce([
      { id: 1, parentId: null, title: "T", status: "todo", priority: 1, stepTotal: 0, stepDone: 0 },
    ] as unknown as ReturnType<typeof tasks.listTasks>);
    const res = await handleTaskList(req({}, { request_id: "r3" }));
    expect(res?.type).toBe("task.list");
    expect(res?.request_id).toBe("r3");
    expect((res!.payload as { tasks: unknown[] }).tasks).toHaveLength(1);
  });
});

describe("dispatch", () => {
  it("answers a heartbeat with a pong carrying the app's protocol version", async () => {
    const res = await dispatch(req(undefined, { type: "bridge.ping", request_id: "p1" }));
    expect(res).toEqual({
      type: "bridge.pong",
      request_id: "p1",
      protocol_version: PROTOCOL_VERSION,
    });
  });

  it("ignores an unknown message type (returns null, no throw)", async () => {
    expect(await dispatch(req({}, { type: "totally.unknown" }))).toBeNull();
  });

  it("routes a known type to its handler", async () => {
    await dispatch(req({ researched: ["x"] }, { type: "state.research" }));
    expect(q.setResearchHorizon).toHaveBeenCalledWith({ researched: ["x"] });
  });
});
