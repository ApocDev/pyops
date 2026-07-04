import { describe, expect, it } from "vite-plus/test";

import { fmtMachineCount, isWholeCount, wholeMachines } from "./machine-count";

/** Machine counts arrive in two shapes (#80): fractional from the default solve
 * (7.28 assemblers) and integer from the game's
 * built counts. Both must render sanely. */
describe("machine-count helpers", () => {
  it("renders whole counts plain — no fake decimals", () => {
    expect(fmtMachineCount(8)).toBe("8");
    expect(fmtMachineCount(0)).toBe("0");
    expect(fmtMachineCount(120)).toBe("120");
    // float dust from summing per-block counts still reads as the integer
    expect(fmtMachineCount(7.9999999)).toBe("8");
  });

  it("renders fractional counts at adaptive precision", () => {
    expect(fmtMachineCount(7.28)).toBe("7.28");
    expect(fmtMachineCount(1.5)).toBe("1.5");
    expect(fmtMachineCount(0.25)).toBe("0.25");
    // tiny requirements never collapse to "0"
    expect(fmtMachineCount(0.001)).toBe("0.001");
  });

  it("distinguishes whole from fractional counts", () => {
    expect(isWholeCount(8)).toBe(true);
    expect(isWholeCount(7.9999999)).toBe(true);
    expect(isWholeCount(7.28)).toBe(false);
  });

  it("rounds a fractional requirement up to whole machines to place", () => {
    expect(wholeMachines(7.28)).toBe(8);
    expect(wholeMachines(8)).toBe(8);
    // float dust just above an integer doesn't demand an extra machine
    expect(wholeMachines(8.0000001)).toBe(8);
    expect(wholeMachines(0.001)).toBe(1);
  });
});
