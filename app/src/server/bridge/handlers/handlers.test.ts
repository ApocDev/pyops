import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { BridgeRequest } from "../protocol.ts";
import { handleBuilt } from "./built.ts";
import { handleResearch } from "./research.ts";

// The handlers are thin validators that forward into the query layer; mock it so
// we can assert exactly what each handler parses out of an (untrusted) payload.
vi.mock("../../../db/queries.ts", () => ({
  setResearchHorizon: vi.fn(),
  setBuiltMachines: vi.fn(() => ({ applied: 0, total: 0, changed: false })),
  metaSet: vi.fn(),
}));
const q = await import("../../../db/queries.ts");
const setResearchHorizon = vi.mocked(q.setResearchHorizon);
const setBuiltMachines = vi.mocked(q.setBuiltMachines);
const metaSet = vi.mocked(q.metaSet);

const req = (payload: unknown): BridgeRequest => ({ protocol_version: 4, type: "state", payload });

beforeEach(() => {
  setResearchHorizon.mockReset();
  setBuiltMachines.mockClear();
  metaSet.mockReset();
});

describe("handleResearch", () => {
  it("stores the researched tech set and stamps sync meta", async () => {
    const res = await handleResearch(req({ researched: ["automation", "logistics"] }));
    expect(res).toBeNull(); // fire-and-forget
    expect(setResearchHorizon).toHaveBeenCalledWith({ researched: ["automation", "logistics"] });
    expect(metaSet).toHaveBeenCalledWith("research_synced_count", "2");
    expect(metaSet).toHaveBeenCalledWith("research_synced_at", expect.any(String));
  });

  it("filters non-string entries out of the researched list", async () => {
    await handleResearch(req({ researched: ["a", 1, null, "b", { x: 1 }] }));
    expect(setResearchHorizon).toHaveBeenCalledWith({ researched: ["a", "b"] });
  });

  it("treats a missing/!array payload as an empty set", async () => {
    await handleResearch(req({}));
    expect(setResearchHorizon).toHaveBeenCalledWith({ researched: [] });
    expect(metaSet).toHaveBeenCalledWith("research_synced_count", "0");
  });
});

describe("handleBuilt", () => {
  it("forwards well-formed machine entries and stamps the total", async () => {
    setBuiltMachines.mockReturnValueOnce({ applied: 2, total: 12, changed: true });
    const res = await handleBuilt(
      req({
        machines: [
          { machine: "furnace", recipe: "smelt", count: 10 },
          { machine: "drill", recipe: "", count: 2 },
        ],
      }),
    );
    expect(res).toBeNull();
    expect(setBuiltMachines).toHaveBeenCalledWith([
      { machine: "furnace", recipe: "smelt", count: 10 },
      { machine: "drill", recipe: "", count: 2 },
    ]);
    expect(metaSet).toHaveBeenCalledWith("built_synced_count", "12");
  });

  it("drops entries with a non-string machine or non-finite count, defaulting recipe to ''", async () => {
    await handleBuilt(
      req({
        machines: [
          { machine: "furnace", count: 5 }, // no recipe → ""
          { machine: 42, count: 5 }, // bad machine → dropped
          { machine: "drill", count: "x" }, // bad count → dropped
          { machine: "lab", count: Number.NaN }, // non-finite → dropped
          "garbage", // not an object → dropped
        ],
      }),
    );
    expect(setBuiltMachines).toHaveBeenCalledWith([{ machine: "furnace", recipe: "", count: 5 }]);
  });

  it("handles a missing machines array as no entries", async () => {
    await handleBuilt(req({}));
    expect(setBuiltMachines).toHaveBeenCalledWith([]);
  });
});
