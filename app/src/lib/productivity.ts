/**
 * Per-product productivity math (#93).
 *
 * Factorio 2.0's `ProductPrototype.ignored_by_productivity` is an AMOUNT, not a
 * flag: the first N units of a product are catalytic and never multiplied by
 * productivity; only the remainder is. Canonical vanilla data (data-raw-dump):
 * Kovarex outputs 41 u-235 with `ignored_by_productivity = 40` (bonus applies to
 * just 1); coal-liquefaction outputs 90 heavy-oil with 25 ignored (its own 25
 * heavy-oil catalyst input), so productivity scales only the net 65.
 *
 * Shared by the solver defs (block-compute), the what-if scenario (queries), and
 * the recipe-diff card, so every surface agrees.
 */

/** Expected per-craft output of one product under a productivity multiplier:
 * `ignored + (amount − ignored) × prodMult`, with `ignored` clamped to
 * `[0, amount]` (a min/max product's average can sit below its ignored amount —
 * the bonus part never goes negative). `amount` is the average rolled amount;
 * probability is NOT applied here (it multiplies base and bonus alike, so
 * callers keep it as a separate factor). */
export function prodScaledAmount(
  amount: number,
  prodMult: number,
  ignoredByProductivity: number | null | undefined,
): number {
  const ignored = Math.min(Math.max(ignoredByProductivity ?? 0, 0), amount);
  return ignored + (amount - ignored) * prodMult;
}
