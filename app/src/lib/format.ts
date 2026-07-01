/**
 * Adaptive number formatting (#74). One shared formatter for rates/quantities so
 * precision scales with magnitude: small-but-nonzero values never collapse to
 * "0.00" (a 0.001/s block must read 0.001, not a wall of zeros), a true zero
 * still reads "0", and large values can render compact ("200K") or full
 * ("200,000") per a user-toggleable display preference.
 *
 * Pure module (no React) — the Settings toggle subscribes via
 * `subscribeNumberFormat` + `getCompactNumbers` (useSyncExternalStore-shaped).
 * The preference is a per-browser display choice, so it lives in localStorage
 * like the other view preferences (fold state, open tabs), not in the project db.
 */

const COMPACT_KEY = "pyops.compactNumbers";

let compact =
  typeof localStorage === "undefined" ? true : localStorage.getItem(COMPACT_KEY) !== "0";
const listeners = new Set<() => void>();

export const getCompactNumbers = () => compact;
export function setCompactNumbers(v: boolean) {
  compact = v;
  if (typeof localStorage !== "undefined") localStorage.setItem(COMPACT_KEY, v ? "1" : "0");
  for (const l of listeners) l();
}
export function subscribeNumberFormat(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** strip trailing zeros (and a bare trailing dot) from a fixed-decimal string */
const trim = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

const COMPACT_UNITS: [number, string][] = [
  [1e12, "T"],
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "K"],
];

/** Format a quantity/rate with magnitude-scaled precision:
 *  - 0 → "0" (only a TRUE zero reads as zero)
 *  - |n| < 1 → two significant digits ("0.001", "0.00012"; "1.2e-9" when tiny)
 *  - 1 ≤ |n| < 100 → up to 2 decimals, trailing zeros trimmed ("3.74", "1.5")
 *  - 100 ≤ |n| < 10k → whole number, thousands-separated ("124", "3,740")
 *  - |n| ≥ 10k → "12.5K" / "200K" / "1.5M" … or "200,000" with compact off */
export function formatQty(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : n < 0 ? "-∞" : "NaN";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 10_000) {
    if (!compact) return Math.round(n).toLocaleString("en-US");
    for (const [scale, suffix] of COMPACT_UNITS) {
      if (abs >= scale) {
        const v = n / scale;
        const av = Math.abs(v);
        return trim(v.toFixed(av >= 100 ? 0 : av >= 10 ? 1 : 2)) + suffix;
      }
    }
  }
  if (abs >= 1000) return Math.round(n).toLocaleString("en-US");
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 1) return trim(n.toFixed(2));
  // below 1: two significant digits, so the smallest nonzero flow stays visible
  const s = n.toPrecision(2);
  if (s.includes("e")) {
    const [mantissa, exp] = s.split("e");
    return `${trim(mantissa)}e${exp}`;
  }
  return trim(s);
}

/** A per-second rate: adaptive quantity + "/s". */
export const formatRate = (n: number): string => `${formatQty(n)}/s`;
