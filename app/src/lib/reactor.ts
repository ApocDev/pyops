/**
 * Reactor neighbour-bonus math (#94).
 *
 * A Factorio reactor gains `neighbour_bonus` × its base heat output for every
 * ADJACENT working reactor (Py's `nuclear-reactor` dumps `neighbour_bonus: 1`,
 * i.e. +100% per neighbour — the engine default). The planner sizes reactors
 * fractionally, so instead of simulating placement we let the user assume a
 * rectangular x-by-y farm and scale each reactor's heat output by the grid's
 * AVERAGE multiplier:
 *
 *   an x×y grid has x·(y−1) + y·(x−1) adjacent pairs; each pair boosts both
 *   members, so the average bonus per reactor is
 *     b × 2·(2xy − x − y) / (xy)  =  b × (4 − 2/x − 2/y)
 *   and the per-reactor output multiplier is 1 + b·(4 − 2/x − 2/y).
 *
 * 1×1 (the default) is exactly the un-bonused base output. Fuel burn is NOT
 * scaled — the bonus is free heat; each reactor still consumes fuel at its
 * rated power.
 */

export type ReactorLayout = { x: number; y: number };

/** Single reactor — no neighbours, multiplier 1 (the pre-#94 behavior). */
export const REACTOR_LAYOUT_DEFAULT: ReactorLayout = { x: 1, y: 1 };

/** Common farm shapes for the row picker: a lone reactor, a pair, and the
 * classic 2×N rows (2×N → ×4 asymptotically with the vanilla bonus of 1). */
export const REACTOR_LAYOUT_PRESETS: ReactorLayout[] = [
  { x: 1, y: 1 },
  { x: 1, y: 2 },
  { x: 2, y: 2 },
  { x: 2, y: 3 },
  { x: 2, y: 4 },
  { x: 2, y: 6 },
  { x: 2, y: 8 },
  { x: 4, y: 4 },
];

const dim = (n: number) => Math.max(1, Math.floor(Number.isFinite(n) ? n : 1));

/** Average per-reactor heat-output multiplier for an x×y farm:
 * `1 + neighbourBonus × (4 − 2/x − 2/y)`. Dimensions are clamped to whole
 * reactors ≥ 1, so a missing/degenerate layout is the 1×1 identity. */
export function reactorHeatMultiplier(neighbourBonus: number, layout?: ReactorLayout): number {
  const b = Number.isFinite(neighbourBonus) ? neighbourBonus : 0;
  const x = dim(layout?.x ?? 1);
  const y = dim(layout?.y ?? 1);
  return 1 + b * (4 - 2 / x - 2 / y);
}

/** "2×4" — the layout as the row chip / picker labels show it. */
export const fmtReactorLayout = (l: ReactorLayout): string => `${dim(l.x)}×${dim(l.y)}`;

/** Same rectangle regardless of orientation (2×3 ≡ 3×2 — the math agrees). */
export const sameLayout = (a: ReactorLayout, b: ReactorLayout): boolean =>
  (dim(a.x) === dim(b.x) && dim(a.y) === dim(b.y)) ||
  (dim(a.x) === dim(b.y) && dim(a.y) === dim(b.x));
