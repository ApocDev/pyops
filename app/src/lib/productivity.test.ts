import { describe, expect, it } from "vite-plus/test";
import { prodScaledAmount } from "./productivity.ts";

/* Real values from the Factorio 2.0 data-raw-dump (see #93):
 * - kovarex-enrichment-process: u-235 amount 41 / ignored 40, u-238 amount 2 / ignored 2
 * - coal-liquefaction: heavy-oil amount 90 / ignored 25; light-oil 20 and
 *   petroleum-gas 10 with no ignored amount
 * - petroleum-gas2 (Py): bacteria-2 amount_min 40 / amount_max 70 (avg 55) / ignored 50 */
describe("prodScaledAmount", () => {
  it("scales only the non-ignored part (Kovarex: 41 out, 40 ignored)", () => {
    // +20% productivity boosts only the 1 net u-235: 40 + 1×1.2 = 41.2
    expect(prodScaledAmount(41, 1.2, 40)).toBeCloseTo(41.2);
  });

  it("handles a partially ignored fluid (coal liquefaction heavy-oil 90/25)", () => {
    // 25 catalytic + 65 net × 1.2 = 103 — NOT 90 (all-ignored) or 108 (none)
    expect(prodScaledAmount(90, 1.2, 25)).toBeCloseTo(103);
  });

  it("leaves a fully ignored product unscaled (Kovarex u-238 2/2)", () => {
    expect(prodScaledAmount(2, 1.5, 2)).toBe(2);
  });

  it("scales the whole amount when nothing is ignored", () => {
    expect(prodScaledAmount(20, 1.2, 0)).toBeCloseTo(24);
    expect(prodScaledAmount(20, 1.2, null)).toBeCloseTo(24);
    expect(prodScaledAmount(20, 1.2, undefined)).toBeCloseTo(24);
  });

  it("applies to the average of a min/max roll (bacteria-2 avg 55, ignored 50)", () => {
    // 50 + 5 × 1.2 = 56
    expect(prodScaledAmount(55, 1.2, 50)).toBeCloseTo(56);
  });

  it("clamps: ignored above the (average) amount never yields a negative bonus", () => {
    // avg 40 with ignored 50 — the ignored part can't exceed what's produced
    expect(prodScaledAmount(40, 1.2, 50)).toBe(40);
  });

  it("is the identity at 1× productivity", () => {
    expect(prodScaledAmount(90, 1, 25)).toBe(90);
  });
});
