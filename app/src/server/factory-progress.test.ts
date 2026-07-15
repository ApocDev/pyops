import { describe, expect, it } from "vite-plus/test";

import { getFactorySolveProgress, startFactorySolveProgress } from "./factory-progress.server.ts";

describe("factory solve progress", () => {
  it("publishes live phases and retains the terminal state", () => {
    const requestId = `progress-${Date.now()}`;
    const reporter = startFactorySolveProgress(requestId, "scenario-preview")!;

    expect(getFactorySolveProgress(requestId)).toMatchObject({
      source: "scenario-preview",
      phase: "preparing",
      message: "Checking saved block projections",
    });

    reporter.update({
      phase: "validating",
      message: "Validating blocks · pass 2/8 · 12/64",
      pass: 2,
      maxPasses: 8,
      current: 12,
      total: 64,
    });
    expect(getFactorySolveProgress(requestId)).toMatchObject({
      phase: "validating",
      pass: 2,
      maxPasses: 8,
      current: 12,
      total: 64,
    });

    reporter.complete();
    expect(getFactorySolveProgress(requestId)).toMatchObject({
      phase: "complete",
      message: "Scenario is up to date",
    });
  });

  it("records a failed terminal state", () => {
    const requestId = `failure-${Date.now()}`;
    const reporter = startFactorySolveProgress(requestId, "balance-apply")!;
    reporter.fail(new Error("solver stopped"));

    expect(getFactorySolveProgress(requestId)).toMatchObject({
      source: "balance-apply",
      phase: "failed",
      message: "solver stopped",
    });
  });
});
