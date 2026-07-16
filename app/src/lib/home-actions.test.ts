import { describe, expect, it } from "vite-plus/test";
import {
  activeHomeActionKeys,
  chooseHomeAction,
  factoryDeficits,
  homeActionKey,
  liveDrains,
  type HomeBuildStatus,
  type HomeDeficit,
} from "./home-actions.ts";

const build = (
  phase: HomeBuildStatus["phase"],
  overrides: Partial<HomeBuildStatus> = {},
): HomeBuildStatus => ({
  blockId: 1,
  block: "Moss",
  phase,
  requiredSteps: 4,
  coveredSteps: phase === "unbuilt" ? 0 : phase === "partial" ? 2 : 4,
  requiredMachines: 600,
  missingMachines: phase === "scaled" ? 0 : 598,
  ...overrides,
});

const deficit = (state: HomeDeficit["state"]): HomeDeficit => ({
  item: "fish",
  display: "Fish",
  kind: "item",
  produced: 0,
  consumed: 2,
  net: -2,
  pctMet: 0,
  state,
});

describe("factoryDeficits", () => {
  it("keeps actionable, research-waiting, and external deficits distinct", () => {
    const rows = factoryDeficits(
      [
        { item: "fish", display: "Fish", kind: "item", role: "import", rate: 2 },
        { item: "plate", display: "Plate", kind: "item", role: "import", rate: 10 },
        { item: "plate", display: "Plate", kind: "item", role: "primary", rate: 5 },
        { item: "ore", display: "Ore", kind: "item", role: "import", rate: 3 },
      ],
      [
        { item: "fish", state: "waiting" },
        { item: "plate", state: "actionable" },
        { item: "ore", state: "external" },
      ],
    );
    expect(rows.map((row) => [row.item, row.state])).toEqual([
      ["ore", "external"],
      ["fish", "waiting"],
      ["plate", "actionable"],
    ]);
  });

  it("drops sub-percent rounding noise", () => {
    expect(
      factoryDeficits(
        [
          { item: "plate", display: "Plate", kind: "item", role: "import", rate: 100 },
          { item: "plate", display: "Plate", kind: "item", role: "primary", rate: 99.5 },
        ],
        [{ item: "plate", state: "actionable" }],
      ),
    ).toEqual([]);
  });
});

describe("liveDrains", () => {
  const syncedAt = "2026-07-16T12:00:00.000Z";
  const now = new Date(syncedAt).getTime() + 10_000;

  it("ranks fresh actual consumption shortfalls ahead of healthier flows", () => {
    const rows = liveDrains(
      [
        {
          item: "plate",
          display: "Plate",
          plannedProduced: 10,
          plannedConsumed: 10,
          actualProduced: 9,
          actualConsumed: 10,
        },
        {
          item: "fish",
          display: "Fish",
          plannedProduced: 1,
          plannedConsumed: 1,
          actualProduced: 0,
          actualConsumed: 0.2,
        },
      ],
      syncedAt,
      now,
    );
    expect(rows.map((row) => row.item)).toEqual(["fish", "plate"]);
  });

  it("does not call stale, unplanned, or completely idle telemetry a drain", () => {
    const base = {
      display: "Plate",
      plannedProduced: 10,
      plannedConsumed: 10,
      actualProduced: 0,
      actualConsumed: 2,
    };
    expect(liveDrains([{ item: "plate", ...base }], syncedAt, now + 60_000)).toEqual([]);
    expect(
      liveDrains(
        [
          { item: "unplanned", ...base, plannedProduced: 0, plannedConsumed: 0 },
          { item: "idle", ...base, actualConsumed: 0 },
        ],
        syncedAt,
        now,
      ),
    ).toEqual([]);
  });
});

describe("chooseHomeAction", () => {
  const inputs = {
    needsRedump: false,
    drains: [{ item: "plate", display: "Plate", produced: 1, consumed: 2, pctMet: 0.5 }],
    builds: [build("unbuilt"), build("partial", { blockId: 2 }), build("scale", { blockId: 3 })],
    deficits: [deficit("actionable")],
    unhealthy: [{ id: 4, name: "Draft", health: "warn" as const }],
  };

  it("uses the agreed progression priority", () => {
    expect(chooseHomeAction({ ...inputs, needsRedump: true }).kind).toBe("resync");
    expect(chooseHomeAction(inputs).kind).toBe("drain");
    expect(chooseHomeAction({ ...inputs, drains: [] }).kind).toBe("unbuilt");
    expect(chooseHomeAction({ ...inputs, drains: [], builds: inputs.builds.slice(1) }).kind).toBe(
      "partial",
    );
    expect(chooseHomeAction({ ...inputs, drains: [], builds: [inputs.builds[2]] }).kind).toBe(
      "plan",
    );
    expect(
      chooseHomeAction({
        ...inputs,
        drains: [],
        builds: [inputs.builds[2]],
        deficits: [deficit("waiting")],
      }).kind,
    ).toBe("scale");
    expect(
      chooseHomeAction({
        ...inputs,
        drains: [],
        builds: [],
        deficits: [deficit("waiting")],
      }).kind,
    ).toBe("unhealthy");
  });

  it("does not promote research-locked or external deficits", () => {
    expect(
      chooseHomeAction({
        needsRedump: false,
        drains: [],
        builds: [],
        deficits: [deficit("waiting"), deficit("external")],
        unhealthy: [],
      }),
    ).toEqual({ kind: "caught-up" });
  });

  it("skips dismissed actions and restores a block when its phase changes", () => {
    const unbuilt = build("unbuilt");
    const unbuiltKey = homeActionKey({ kind: "unbuilt", build: unbuilt })!;
    expect(
      chooseHomeAction({
        needsRedump: false,
        drains: [],
        builds: [unbuilt, build("partial", { blockId: 2 })],
        deficits: [],
        unhealthy: [],
        dismissed: [unbuiltKey],
      }),
    ).toMatchObject({ kind: "partial", build: { blockId: 2 } });

    const progressed = build("partial");
    expect(homeActionKey({ kind: "partial", build: progressed })).not.toBe(unbuiltKey);
    expect(
      chooseHomeAction({
        needsRedump: false,
        drains: [],
        builds: [progressed],
        deficits: [],
        unhealthy: [],
        dismissed: [unbuiltKey],
      }).kind,
    ).toBe("partial");
  });

  it("lists only currently relevant dismissible action keys", () => {
    const keys = activeHomeActionKeys({
      needsRedump: true,
      drains: inputs.drains,
      builds: [build("unbuilt"), build("scaled", { blockId: 2 })],
      deficits: [deficit("actionable"), deficit("waiting")],
      unhealthy: inputs.unhealthy,
    });
    expect(keys).toEqual([
      "drain:plate",
      "unbuilt:1",
      "plan:fish:0.00000:2.00000",
      "unhealthy:4:warn",
    ]);
  });
});
