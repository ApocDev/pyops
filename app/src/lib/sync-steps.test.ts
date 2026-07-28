import { describe, expect, it } from "vite-plus/test";
import { SYNC_STEPS, stepStatuses, stepsForRun } from "./sync-steps.ts";

describe("stepsForRun", () => {
  it("drops the icon stages unless icons were requested", () => {
    expect(stepsForRun(false).some((s) => s.iconsOnly)).toBe(false);
    expect(stepsForRun(true)).toEqual(SYNC_STEPS);
  });
});

describe("stepStatuses", () => {
  const steps = stepsForRun(false); // helper-mod, dump-data, dump-locale, import, costs, migrations

  it("marks past steps done, the current active, and later pending", () => {
    expect(stepStatuses(steps, "dump-locale", null)).toEqual([
      "done",
      "done",
      "active",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("marks every step done when finished", () => {
    expect(stepStatuses(steps, "done", null)).toEqual(steps.map(() => "done"));
  });

  it("flags the failing step on error and leaves later steps pending", () => {
    expect(stepStatuses(steps, "error", "import")).toEqual([
      "done",
      "done",
      "done",
      "error",
      "pending",
      "pending",
    ]);
  });

  it("treats idle as all-pending", () => {
    expect(stepStatuses(steps, "idle", null)).toEqual(steps.map(() => "pending"));
  });
});

describe("stepsForRun — reusing the dump on disk", () => {
  it("drops every stage that needs the game running", () => {
    const steps = stepsForRun(false, true);
    expect(steps.some((s) => s.dumpOnly)).toBe(false);
    expect(steps.map((s) => s.phase)).toEqual(["import", "costs", "migrations"]);
  });

  it("keeps the atlas rebuild when icons are requested — the sprites are on disk too", () => {
    expect(stepsForRun(true, true).map((s) => s.phase)).toEqual([
      "import",
      "atlas",
      "costs",
      "migrations",
    ]);
  });

  it("is unchanged for a normal run", () => {
    expect(stepsForRun(false, false)).toEqual(stepsForRun(false));
  });
});
