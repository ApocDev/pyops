import { describe, expect, it } from "vite-plus/test";
import {
  fmtAmt,
  fmtCost,
  fmtCount,
  fmtJ,
  fmtPower,
  fmtRate,
  fmtW,
  parseRateInput,
} from "./format.ts";

describe("fmtRate", () => {
  it("never trims INTEGER trailing zeros on large rates (the 5000 → '5' bug)", () => {
    expect(fmtRate(5000)).toBe("5000");
    expect(fmtRate(1230)).toBe("1230");
    expect(fmtRate(100000)).toBe("100000");
    expect(fmtRate(1000)).toBe("1000");
    expect(fmtRate(-5000)).toBe("-5000");
  });

  it("trims trailing decimal zeros below 1000", () => {
    expect(fmtRate(500)).toBe("500");
    expect(fmtRate(0.5)).toBe("0.5");
    expect(fmtRate(1.0623)).toBe("1.0623");
    expect(fmtRate(999.25)).toBe("999.25");
  });

  it("edge values", () => {
    expect(fmtRate(0)).toBe("0");
    expect(fmtRate(999.99995)).toBe("1000"); // toFixed(4) rounds up, zeros trimmed
    expect(fmtRate(Number.NaN)).toBe("0");
  });
});

describe("compaction helpers", () => {
  it("fmtW picks sensible units", () => {
    expect(fmtW(1500)).toBe("2 kW");
    expect(fmtW(2_500_000)).toBe("2.50 MW");
    expect(fmtW(3_000_000_000)).toBe("3.00 GW");
  });

  it("fmtJ picks sensible units", () => {
    expect(fmtJ(8_000_000)).toBe("8.0 MJ");
    expect(fmtJ(500)).toBe("500 J");
  });

  it("fmtAmt keeps short numbers plain and humanizes long ones", () => {
    expect(fmtAmt(50)).toBe("50");
    expect(fmtAmt(1000)).toBe("1000");
    expect(fmtAmt(1_200_000)).toBe("1.2M");
  });

  it("fmtCount clamps the tiny and rounds the large", () => {
    expect(fmtCount(0.001)).toBe("<0.01");
    expect(fmtCount(3.14159)).toBe("3.1");
    expect(fmtCount(42.4)).toBe("42");
    expect(fmtCount(Infinity)).toBe("∞");
  });

  it("fmtCost spans the cost-analysis range", () => {
    expect(fmtCost(0.5)).toBe("0.50");
    expect(fmtCost(1500)).toBe("1.5k");
    expect(fmtCost(2_000_000)).toBe("2.0M");
  });
});

describe("parseRateInput", () => {
  it("plain numbers pass through (not per-second-flagged)", () => {
    expect(parseRateInput("5000")).toEqual({ value: 5000, perSecond: false });
    expect(parseRateInput("0.5")).toEqual({ value: 0.5, perSecond: false });
    expect(parseRateInput("1e3")).toEqual({ value: 1000, perSecond: false });
  });

  it("magnitude suffixes multiply, case-insensitive, everywhere", () => {
    expect(parseRateInput("5k")).toEqual({ value: 5000, perSecond: false });
    expect(parseRateInput("2.5M")).toEqual({ value: 2_500_000, perSecond: false });
    expect(parseRateInput("1g")).toEqual({ value: 1e9, perSecond: false });
    expect(parseRateInput("3 T")).toEqual({ value: 3e12, perSecond: false });
  });

  it("power units convert to solver units/s for energy goals (1 MW = 1/s)", () => {
    expect(parseRateInput("500MW", true)).toEqual({ value: 500, perSecond: true });
    expect(parseRateInput("5GW", true)).toEqual({ value: 5000, perSecond: true });
    expect(parseRateInput("5tw", true)).toEqual({ value: 5_000_000, perSecond: true });
    expect(parseRateInput("250 kW", true)).toEqual({ value: 0.25, perSecond: true });
    expect(parseRateInput("1w", true)).toEqual({ value: 1e-6, perSecond: true });
  });

  it("power units are rejected on non-energy goods; garbage is rejected", () => {
    expect(parseRateInput("5GW", false)).toBeNull();
    expect(parseRateInput("5xyz", true)).toBeNull();
    // empty input keeps its legacy meaning: commit 0 (matches the old Number("") path)
    expect(parseRateInput("", true)).toEqual({ value: 0, perSecond: false });
    expect(parseRateInput("watts", true)).toBeNull();
  });
});

describe("fmtPower", () => {
  it("picks the largest sensible unit with trimmed decimals", () => {
    expect(fmtPower(5_000_000)).toBe("5 TW");
    expect(fmtPower(5000)).toBe("5 GW");
    expect(fmtPower(500)).toBe("500 MW");
    expect(fmtPower(2.5)).toBe("2.5 MW");
    expect(fmtPower(0.25)).toBe("250 kW");
    expect(fmtPower(0.0000005)).toBe("0.5 W");
  });

  it("handles zero and negatives (SINK goals)", () => {
    expect(fmtPower(0)).toBe("0 W");
    expect(fmtPower(-5000)).toBe("-5 GW");
  });
});

describe("temperature labels", () => {
  it("compacts >=1000 and keeps small values plain", async () => {
    const { fmtTemp, fmtTempRange } = await import("../../lib/format");
    expect(fmtTemp(4000)).toBe("4k°");
    expect(fmtTemp(2500)).toBe("2.5k°");
    expect(fmtTemp(125)).toBe("125°");
    expect(fmtTemp(null)).toBeNull();
    expect(fmtTempRange(4000, 4000)).toBe("4k°");
    expect(fmtTempRange(null, 101)).toBe("≤101°");
    expect(fmtTempRange(500, null)).toBe("≥500°");
    expect(fmtTempRange(125, 999)).toBe("125–999°");
    expect(fmtTempRange(1000, 4000)).toBe("1k–4k°");
    expect(fmtTempRange(null, null)).toBeNull();
  });
});
