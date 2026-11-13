import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { BridgeRequest } from "../protocol.ts";

vi.mock("../../../db/queries.server.ts", () => ({
  listBlocks: vi.fn(() => []),
  listGroups: vi.fn(() => []),
  blockBuildTotals: vi.fn(() => new Map()),
  getFluid: vi.fn(() => null),
}));
vi.mock("../../block-compute.server.ts", () => ({ showBlockInGame: vi.fn() }));
vi.mock("../server.ts", () => ({ sendToPeer: vi.fn(() => true) }));

const q = await import("../../../db/queries.server.ts");
const compute = await import("../../block-compute.server.ts");
const server = await import("../server.ts");
const blocks = await import("./blocks.ts");

type Listed = ReturnType<typeof q.listBlocks>[number];
type Group = ReturnType<typeof q.listGroups>[number];

const req = (type: string, payload?: unknown): BridgeRequest => ({
  protocol_version: 10,
  type,
  request_id: "r1",
  payload,
});

// Only the fields the payload builder reads; the rest of listBlocks' row is noise.
const listed = (b: Partial<Listed> & { id: number; name: string }) =>
  ({
    enabled: true,
    groupId: null,
    iconKind: "item",
    iconName: "iron-plate",
    electricityW: 2e6,
    health: "ok",
    goal: { name: "iron-plate", rate: 1.5 },
    ...b,
  }) as Listed;
const group = (id: number, name: string, parentId: number | null = null) =>
  ({ id, name, parentId, sortOrder: null, createdAt: null }) as Group;

beforeEach(() => vi.clearAllMocks());

describe("groupBlocks", () => {
  const wire = (id: number) => ({
    id,
    name: `b${id}`,
    icon: null,
    goal: null,
    powerW: 0,
    health: "ok" as const,
    have: 0,
    need: 0,
  });

  it("orders folders depth-first with path labels, ungrouped last, empty rows dropped", () => {
    const groups = [
      group(1, "Metals"),
      group(2, "Iron", 1),
      group(3, "Empty"),
      group(4, "Science"),
    ];
    const groupOf = new Map<number, number | null>([
      [10, null],
      [11, 2],
      [12, 4],
      [13, 1],
      [14, 99], // a folder that no longer exists falls back to Ungrouped
    ]);
    const out = blocks.groupBlocks([10, 11, 12, 13, 14].map(wire), groupOf, groups);
    expect(out.groups.map((g) => [g.name, g.blocks.map((b) => b.id)])).toEqual([
      ["Metals", [13]],
      ["Metals / Iron", [11]],
      ["Science", [12]],
      ["Ungrouped", [10, 14]],
    ]);
  });
});

describe("block.list", () => {
  it("replies with enabled blocks, their goal and built totals", () => {
    vi.mocked(q.listBlocks).mockReturnValue([
      listed({ id: 1, name: "Iron", goal: { name: "iron-plate", rate: 1.5, unit: "min" } }),
      listed({ id: 2, name: "Off", enabled: false }),
      listed({ id: 3, name: "Water", iconKind: null, iconName: null, goal: null }),
    ]);
    vi.mocked(q.blockBuildTotals).mockReturnValue(new Map([[1, { need: 10, missing: 4 }]]));

    const res = blocks.handleBlockList(req("block.list"));
    expect(res.type).toBe("block.list");
    expect(res.request_id).toBe("r1");
    expect(res.payload).toEqual({
      groups: [
        {
          name: "Ungrouped",
          blocks: [
            {
              id: 1,
              name: "Iron",
              icon: { kind: "item", name: "iron-plate" },
              goal: { name: "iron-plate", kind: "item", rate: 1.5, unit: "min" },
              powerW: 2e6,
              health: "ok",
              have: 6,
              need: 10,
            },
            {
              id: 3,
              name: "Water",
              icon: null,
              goal: null,
              powerW: 2e6,
              health: "ok",
              have: 0,
              need: 0,
            },
          ],
        },
      ],
    });
  });

  it("pushes on the heartbeat only after the mod asked once, and only when it changed", () => {
    vi.mocked(q.listBlocks).mockReturnValue([listed({ id: 1, name: "Iron" })]);
    blocks.handleBlockList(req("block.list"));

    blocks.pushBlockListIfChanged();
    expect(server.sendToPeer).not.toHaveBeenCalled();

    vi.mocked(q.listBlocks).mockReturnValue([listed({ id: 1, name: "Iron (renamed)" })]);
    blocks.pushBlockListIfChanged();
    expect(server.sendToPeer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(server.sendToPeer).mock.calls[0][0]).toMatchObject({ type: "block.list" });

    blocks.pushBlockListIfChanged();
    expect(server.sendToPeer).toHaveBeenCalledTimes(1);
  });
});

describe("block.show / block.open", () => {
  it("pushes the clicked block's build sheet", async () => {
    await blocks.handleBlockShow(req("block.show", { id: 60 }));
    expect(compute.showBlockInGame).toHaveBeenCalledWith(60);
    await blocks.handleBlockShow(req("block.show", { id: "60" }));
    expect(compute.showBlockInGame).toHaveBeenCalledTimes(1);
  });

  it("records the latest open request for the web UI", () => {
    blocks.handleBlockOpen(req("block.open", { id: 1.5 }));
    expect(blocks.lastOpenBlockRequest()).toBeNull();
    blocks.handleBlockOpen(req("block.open", { id: 7 }));
    expect(blocks.lastOpenBlockRequest()).toMatchObject({ id: 7 });
  });
});
