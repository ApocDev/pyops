import { describe, expect, it } from "vite-plus/test";
import { contextGaugeTitle, type TokenStatus } from "./context-gauge.ts";

const status = (over: Partial<TokenStatus>): TokenStatus => ({
  usedTokens: 1200,
  contextWindow: 100_000,
  ratio: 0.012,
  estimated: false,
  turnCompleted: true,
  modelId: "m",
  costUsd: 0.0042,
  resolvedModel: "m",
  messageCount: 2,
  ...over,
});

describe("contextGaugeTitle", () => {
  it("shows the measured cost of the last turn", () => {
    expect(contextGaugeTitle(status({}))).toContain("last turn cost: $0.0042");
  });

  it("says unknown for a completed turn whose provider reported no usage or cost", () => {
    const title = contextGaugeTitle(status({ estimated: true, costUsd: null }));
    expect(title).toContain("last turn cost: unknown");
    expect(title).toContain("no measured usage for the last turn");
    expect(title).not.toContain("no completed turn yet");
  });

  it("omits cost before any turn has completed", () => {
    const title = contextGaugeTitle(
      status({ estimated: true, turnCompleted: false, costUsd: null }),
    );
    expect(title).toContain("no completed turn yet");
    expect(title).not.toContain("cost");
  });
});
