import { expect, test } from "vite-plus/test";
import {
  formatPower,
  formatQty,
  formatRate,
  getCompactNumbers,
  rateLabel,
  setCompactNumbers,
  snapResidue,
  timeAgo,
} from "./format.ts";

test("true zero reads as 0", () => {
  expect(formatQty(0)).toBe("0");
});

test("small nonzero values never collapse to 0 (the 0.001/s block)", () => {
  expect(formatQty(0.001)).toBe("0.001");
  expect(formatQty(0.0012345)).toBe("0.0012");
  expect(formatQty(0.00012)).toBe("0.00012");
  expect(formatQty(0.56)).toBe("0.56");
  expect(formatQty(-0.001)).toBe("-0.001");
});

test("extremely small values fall back to exponent form", () => {
  expect(formatQty(1e-9)).toBe("1e-9");
  expect(formatQty(1.23e-9)).toBe("1.2e-9");
});

test("mid-range: up to 2 decimals, trailing zeros trimmed", () => {
  expect(formatQty(3.74)).toBe("3.74");
  expect(formatQty(1.5)).toBe("1.5");
  expect(formatQty(2)).toBe("2");
  expect(formatQty(93.57)).toBe("93.57");
});

test("hundreds: whole numbers", () => {
  expect(formatQty(124)).toBe("124");
  expect(formatQty(999.4)).toBe("999");
});

test("compact applies from 1000 up, so one row never mixes forms", () => {
  expect(getCompactNumbers()).toBe(true);
  expect(formatQty(8729)).toBe("8.73K");
  expect(formatQty(10_234)).toBe("10.2K");
  expect(formatQty(999_999)).toBe("1M"); // rounds into the next unit, not "1000K"
  expect(formatQty(200_000)).toBe("200K");
  expect(formatQty(12_500)).toBe("12.5K");
  expect(formatQty(1_500_000)).toBe("1.5M");
  expect(formatQty(2_340_000_000)).toBe("2.34G");
  setCompactNumbers(false);
  try {
    expect(formatQty(200_000)).toBe("200,000");
    expect(formatQty(12_500)).toBe("12,500");
    expect(formatQty(3740.4)).toBe("3,740");
  } finally {
    setCompactNumbers(true);
  }
});

test("formatRate appends /s", () => {
  expect(formatRate(0.001)).toBe("0.001/s");
  expect(formatRate(0)).toBe("0/s");
});

test("formatPower: largest unit, same precision as quantities", () => {
  expect(formatPower(357.3451e6)).toBe("357 MW");
  expect(formatPower(88.5046e6)).toBe("88.5 MW");
  expect(formatPower(2.5e6)).toBe("2.5 MW");
  expect(formatPower(1500)).toBe("1.5 kW");
  expect(formatPower(5e9)).toBe("5 GW");
  expect(formatPower(5e12)).toBe("5 TW");
  expect(formatPower(0.5)).toBe("0.5 W");
  expect(formatPower(999.96e6)).toBe("1 GW");
  expect(formatPower(0)).toBe("0 W");
  expect(formatPower(-301.8712e6)).toBe("-302 MW");
});

test("rateLabel: energy goods render power and never take /s", () => {
  expect(rateLabel("pyops-fluid-fuel", 301.009, { perSec: true, sign: true })).toBe("+301 MW");
  expect(rateLabel("iron-plate", 44.2523, { perSec: true })).toBe("44.25/s");
});

test("snapResidue: solver float noise reads 0, real imbalances stay", () => {
  expect(snapResidue(-1.4e-14, 0)).toBe(0);
  expect(snapResidue(2e-8, 0.0056)).toBe(0);
  expect(snapResidue(1e-7, 0.039)).toBe(0);
  expect(snapResidue(-0.00019, 156)).toBe(0);
  expect(snapResidue(0.0000018, 11_700)).toBe(0);
  expect(snapResidue(0.001, 0.5)).toBe(0.001);
  expect(snapResidue(-0.5, 10)).toBe(-0.5);
});

test("timeAgo switches from hours to days after a day", () => {
  const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();
  expect(timeAgo(ago(5 * 3600))).toBe("5h ago");
  expect(timeAgo(ago(30 * 3600))).toBe("1 day ago");
  expect(timeAgo(ago(2579 * 3600))).toBe("107 days ago");
});
