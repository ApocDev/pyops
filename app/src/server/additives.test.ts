import { describe, expect, it } from "vite-plus/test";
import { ADDITIVE_CONSUMER_THRESHOLD, ADDITIVE_OVERRIDES, classifyAdditive } from "./additives.ts";

describe("classifyAdditive", () => {
  it("treats a ubiquitous good (≥ threshold consumers) as an import commodity", () => {
    const v = classifyAdditive("water", 607);
    expect(v.additive).toBe(true);
    expect(v.reason).toContain("607");
  });

  it("treats a narrow good (few consumers) as a buildable chain intermediate", () => {
    const v = classifyAdditive("iron-pulp-04", 1);
    expect(v.additive).toBe(false);
    expect(v.reason).toContain("narrow");
  });

  it("classifies exactly at the threshold as a commodity (inclusive)", () => {
    const v = classifyAdditive("some-gas", ADDITIVE_CONSUMER_THRESHOLD);
    expect(v.additive).toBe(true);
  });

  it("classifies one below the threshold as an intermediate", () => {
    const v = classifyAdditive("some-good", ADDITIVE_CONSUMER_THRESHOLD - 1);
    expect(v.additive).toBe(false);
  });

  it("forces curated low-ubiquity commodities to import via the override list", () => {
    for (const name of ADDITIVE_OVERRIDES) {
      const v = classifyAdditive(name, 1); // only 1 consumer, would otherwise be 'build'
      expect(v.additive).toBe(true);
      expect(v.reason).toBe("curated commodity");
    }
  });

  it("override wins over a sub-threshold consumer count", () => {
    expect(classifyAdditive("diesel", 2).additive).toBe(true);
  });
});
