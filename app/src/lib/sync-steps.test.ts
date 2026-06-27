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
