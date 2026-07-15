import { describe, expect, it } from "vite-plus/test";

import {
  campaignGoalRate,
  campaignPlannedQuantity,
  normalizeCampaign,
  poissonAtLeast,
} from "./campaign.ts";

describe("temporary campaign planning", () => {
  it("keeps expected planning equal to the requested quantity", () => {
    expect(campaignPlannedQuantity(12, "expected")).toBe(12);
  });

  it("adds the correct small-target Poisson reserve", () => {
    expect(campaignPlannedQuantity(1, "90")).toBeCloseTo(Math.log(10), 8);
    expect(campaignPlannedQuantity(1, "95")).toBeCloseTo(Math.log(20), 8);
    expect(poissonAtLeast(1, campaignPlannedQuantity(1, "95"))).toBeCloseTo(0.95, 8);
  });

  it("derives a signed per-second rate from quantity and duration", () => {
    const campaign = { duration: 3600, confidence: "expected" as const, quantities: { x: 18 } };
    expect(campaignGoalRate(campaign, { name: "x", rate: 1 })).toBeCloseTo(0.005, 12);
    expect(campaignGoalRate(campaign, { name: "x", rate: -1 })).toBeCloseTo(-0.005, 12);
  });

  it("normalizes quantities to the current goals and preserves completion", () => {
    expect(
      normalizeCampaign(
        {
          duration: 600,
          confidence: "95",
          quantities: { plate: 20, gone: 99 },
          completedAt: "2026-07-15T12:00:00.000Z",
        },
        [
          { name: "plate", rate: 1 },
          { name: "gear", rate: 0.5 },
        ],
      ),
    ).toEqual({
      duration: 600,
      confidence: "95",
      quantities: { plate: 20, gear: 300 },
      completedAt: "2026-07-15T12:00:00.000Z",
    });
  });
});
