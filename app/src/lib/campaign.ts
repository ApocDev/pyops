import type { Goal, TemporaryCampaign } from "../db/schema.ts";

export const CAMPAIGN_DURATION_DEFAULT = 3600;

export const CAMPAIGN_CONFIDENCES = ["expected", "90", "95"] as const;

export function isCampaignConfidence(value: unknown): value is TemporaryCampaign["confidence"] {
  return CAMPAIGN_CONFIDENCES.includes(value as TemporaryCampaign["confidence"]);
}

const normalCdf = (z: number) => {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
};

/** Probability that a Poisson process with mean `mean` produces at least
 * `target` successes. Campaign confidence is deliberately an operational
 * reserve over the existing expected-value recipe solve: recipes still carry
 * their real expected yields, while this asks how much expected output to plan
 * for so a small finite target is not treated as certain. */
export function poissonAtLeast(target: number, mean: number): number {
  const needed = Math.max(1, Math.ceil(target));
  if (!(mean > 0)) return 0;
  if (needed > 160 || mean > 700) {
    const z = (needed - 0.5 - mean) / Math.sqrt(mean);
    return 1 - normalCdf(z);
  }
  let term = Math.exp(-mean);
  let below = term;
  for (let successes = 1; successes < needed; successes += 1) {
    term *= mean / successes;
    below += term;
  }
  return Math.max(0, Math.min(1, 1 - below));
}

export function campaignPlannedQuantity(
  quantity: number,
  confidence: TemporaryCampaign["confidence"],
): number {
  const requested = Math.max(0, quantity);
  if (!(requested > 0) || confidence === "expected") return requested;
  const probability = confidence === "90" ? 0.9 : 0.95;
  let low = requested;
  let high = Math.max(1, requested);
  while (poissonAtLeast(requested, high) < probability) high *= 2;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const mid = (low + high) / 2;
    if (poissonAtLeast(requested, mid) >= probability) high = mid;
    else low = mid;
  }
  return high;
}

export function campaignGoalQuantity(campaign: TemporaryCampaign, goal: Goal): number {
  const stored = campaign.quantities[goal.name];
  return stored != null && Number.isFinite(stored) && stored > 0
    ? stored
    : Math.max(1, Math.abs(goal.rate) * campaign.duration);
}

export function campaignGoalRate(campaign: TemporaryCampaign, goal: Goal): number {
  const quantity = campaignGoalQuantity(campaign, goal);
  const planned = campaignPlannedQuantity(quantity, campaign.confidence);
  const direction = goal.direction ?? (goal.rate < 0 ? "consume" : "produce");
  return (direction === "consume" ? -1 : 1) * (planned / campaign.duration);
}

export function normalizeCampaign(
  value: TemporaryCampaign | null | undefined,
  goals: readonly Goal[],
): TemporaryCampaign | null {
  if (!value || !Number.isFinite(value.duration) || value.duration <= 0) return null;
  const duration = value.duration;
  const confidence = isCampaignConfidence(value.confidence) ? value.confidence : "expected";
  const quantities = Object.fromEntries(
    goals.map((goal) => {
      const raw = value.quantities?.[goal.name];
      const quantity =
        raw != null && Number.isFinite(raw) && raw > 0
          ? raw
          : Math.max(1, Math.abs(goal.rate) * duration);
      return [goal.name, quantity];
    }),
  );
  return {
    duration,
    confidence,
    quantities,
    ...(typeof value.completedAt === "string" && value.completedAt
      ? { completedAt: value.completedAt }
      : {}),
  };
}

export const campaignConfidenceLabel = (confidence: TemporaryCampaign["confidence"]) =>
  confidence === "expected" ? "Expected" : `${confidence}% confidence`;
