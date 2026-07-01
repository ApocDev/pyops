import { expect, test } from "vite-plus/test";
import { formatQty, formatRate, getCompactNumbers, setCompactNumbers } from "./format.ts";

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

test("hundreds/thousands: whole numbers, separators from 1000", () => {
  expect(formatQty(124)).toBe("124");
  expect(formatQty(3740.4)).toBe("3,740");
});

test("large numbers compact by default, full form when toggled off", () => {
  expect(getCompactNumbers()).toBe(true);
  expect(formatQty(200_000)).toBe("200K");
  expect(formatQty(12_500)).toBe("12.5K");
  expect(formatQty(1_500_000)).toBe("1.5M");
  expect(formatQty(2_340_000_000)).toBe("2.34G");
  setCompactNumbers(false);
  try {
    expect(formatQty(200_000)).toBe("200,000");
    expect(formatQty(12_500)).toBe("12,500");
  } finally {
    setCompactNumbers(true);
  }
});

test("formatRate appends /s", () => {
  expect(formatRate(0.001)).toBe("0.001/s");
  expect(formatRate(0)).toBe("0/s");
});
