import { describe, expect, it } from "vite-plus/test";
import {
  fmtReactorLayout,
  reactorHeatMultiplier,
  REACTOR_LAYOUT_DEFAULT,
  REACTOR_LAYOUT_PRESETS,
  sameLayout,
} from "./reactor.ts";

// Py's only reactor prototype (data-raw dump, `reactor.nuclear-reactor`):
// neighbour_bonus = 1 (+100% heat per adjacent working reactor), consumption 2GW.
const PY_BONUS = 1;

describe("reactorHeatMultiplier", () => {
  it("is 1 for a lone reactor (the default layout)", () => {
    expect(reactorHeatMultiplier(PY_BONUS, { x: 1, y: 1 })).toBe(1);
    expect(reactorHeatMultiplier(PY_BONUS, REACTOR_LAYOUT_DEFAULT)).toBe(1);
    expect(reactorHeatMultiplier(PY_BONUS)).toBe(1); // no layout = 1×1
  });

  it("matches the hand-checked grids for Py's neighbour_bonus of 1", () => {
    // 1×2: each reactor has exactly one neighbour → ×2
    expect(reactorHeatMultiplier(PY_BONUS, { x: 1, y: 2 })).toBe(2);
    // 2×2: each reactor has exactly two neighbours → ×3
    expect(reactorHeatMultiplier(PY_BONUS, { x: 2, y: 2 })).toBe(3);
    // 2×3: (2·(2·6−2−3))/6 = 14/6 average neighbours → ×(1+7/3)
    expect(reactorHeatMultiplier(PY_BONUS, { x: 2, y: 3 })).toBeCloseTo(1 + 7 / 3, 12);
    // 2×8: 4 − 1 − 1/4 = 2.75 average neighbours → ×3.75
    expect(reactorHeatMultiplier(PY_BONUS, { x: 2, y: 8 })).toBeCloseTo(3.75, 12);
    // 4×4: 4 − 1/2 − 1/2 = 3 average neighbours → ×4
    expect(reactorHeatMultiplier(PY_BONUS, { x: 4, y: 4 })).toBe(4);
  });

  it("approaches 1 + 3b for a long 2×N row", () => {
    expect(reactorHeatMultiplier(PY_BONUS, { x: 2, y: 1000 })).toBeCloseTo(4, 2);
  });

  it("scales linearly with the prototype's neighbour_bonus", () => {
    expect(reactorHeatMultiplier(0.5, { x: 2, y: 2 })).toBe(2); // 1 + 0.5·2
    expect(reactorHeatMultiplier(0, { x: 2, y: 8 })).toBe(1); // no bonus, no scaling
  });

  it("is orientation-independent (x and y commute)", () => {
    expect(reactorHeatMultiplier(PY_BONUS, { x: 2, y: 3 })).toBe(
      reactorHeatMultiplier(PY_BONUS, { x: 3, y: 2 }),
    );
  });

  it("clamps degenerate dimensions to whole reactors ≥ 1", () => {
    expect(reactorHeatMultiplier(PY_BONUS, { x: 0, y: 0 })).toBe(1);
    expect(reactorHeatMultiplier(PY_BONUS, { x: -3, y: 2.9 })).toBe(
      reactorHeatMultiplier(PY_BONUS, { x: 1, y: 2 }),
    );
    expect(reactorHeatMultiplier(Number.NaN, { x: 2, y: 2 })).toBe(1);
  });

  it("worked example: Py breeder reactor (2GW) in a 2×2 farm yields 6GW each", () => {
    const baseMW = 2000; // reactor.nuclear-reactor consumption = 2GW → 2000 MW of heat
    const mult = reactorHeatMultiplier(PY_BONUS, { x: 2, y: 2 });
    expect(baseMW * mult).toBe(6000);
  });
});

describe("layout helpers", () => {
  it("formats layouts as W×H", () => {
    expect(fmtReactorLayout({ x: 2, y: 4 })).toBe("2×4");
    expect(fmtReactorLayout({ x: 0, y: 1.5 })).toBe("1×1"); // clamped like the math
  });

  it("treats a rectangle the same in both orientations", () => {
    expect(sameLayout({ x: 2, y: 3 }, { x: 3, y: 2 })).toBe(true);
    expect(sameLayout({ x: 2, y: 3 }, { x: 2, y: 3 })).toBe(true);
    expect(sameLayout({ x: 2, y: 3 }, { x: 2, y: 4 })).toBe(false);
  });

  it("presets start at the 1×1 default", () => {
    expect(REACTOR_LAYOUT_PRESETS[0]).toEqual(REACTOR_LAYOUT_DEFAULT);
  });
});
