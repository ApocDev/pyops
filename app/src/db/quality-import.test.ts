import { describe, expect, it } from "vite-plus/test";
import { resolveQualityScale } from "./quality-import.ts";

describe("resolveQualityScale", () => {
  const modern = { quality: { normal: { level: 0, next_probability: 1, chain_probability: 0.1 } } };
  const noChain = { quality: { normal: { level: 0, next_probability: 1 } } };

  it("decides by the base version when it is known", () => {
    // a 2.1 mod set may omit chain_probability; the version still says 2.1
    expect(resolveQualityScale(noChain, "2.1.24")).toEqual({
      legacy: false,
      basis: "base 2.1.24",
      effectScale: 1,
      effectStep: 0.0001,
    });
    expect(resolveQualityScale(noChain, "2.1.7").legacy).toBe(false);
    expect(resolveQualityScale(modern, "2.0.76")).toMatchObject({
      legacy: true,
      basis: "base 2.0.76",
      effectScale: 0.1,
      effectStep: 0.001,
    });
    // 2.1.0 to 2.1.6 still had the old scale
    expect(resolveQualityScale(modern, "2.1.6").legacy).toBe(true);
    expect(resolveQualityScale(modern, "1.1.110").legacy).toBe(true);
    expect(resolveQualityScale(noChain, "3.0.0").legacy).toBe(false);
  });

  it("falls back to normal.chain_probability without a usable version", () => {
    const basis = "base version unknown; normal.chain_probability check";
    expect(resolveQualityScale(noChain, null)).toMatchObject({ legacy: true, basis });
    expect(resolveQualityScale(modern)).toMatchObject({ legacy: false, basis });
    expect(resolveQualityScale(noChain, "experimental")).toMatchObject({ legacy: true, basis });
    // no normal at all: nothing to rescale
    expect(resolveQualityScale({}, null).legacy).toBe(false);
  });
});
