import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const readAppConfig = vi.fn(() => ({ factorySolverDebug: true }));
vi.mock("./app-config.server.ts", () => ({ readAppConfig }));

const debug = await import("./factory-debug.server.ts");

beforeEach(() => {
  readAppConfig.mockReturnValue({ factorySolverDebug: true });
  debug.clearLatestFactorySolverTrace();
});

describe("factory solver diagnostics", () => {
  it("does nothing while diagnostics are disabled", () => {
    readAppConfig.mockReturnValue({ factorySolverDebug: false });

    expect(debug.startFactorySolverTrace("scenario-preview")).toBeNull();
    expect(debug.getLatestFactorySolverTrace()).toBeNull();
  });

  it("keeps a bounded structured trace for the latest solve", () => {
    const trace = debug.startFactorySolverTrace("scenario-preview")!;
    for (let i = 0; i < 105; i++) trace.event("pass", { i });
    trace.finish({ status: "Optimal" });

    const latest = debug.getLatestFactorySolverTrace()!;
    expect(latest).toMatchObject({
      version: 1,
      source: "scenario-preview",
      status: "complete",
      truncated: true,
    });
    expect(latest.events).toHaveLength(100);
    expect(latest.events[0]).toMatchObject({ type: "pass", data: { i: 0 } });
  });

  it("records failures without exposing an error stack", () => {
    const trace = debug.startFactorySolverTrace("balance-apply")!;
    trace.fail(new Error("infeasible block"));

    expect(debug.getLatestFactorySolverTrace()).toMatchObject({
      status: "failed",
      events: [expect.objectContaining({ data: { message: "infeasible block" } })],
    });
  });
});
