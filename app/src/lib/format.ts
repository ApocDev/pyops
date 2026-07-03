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

/** Energy pseudo-fluids (1 unit = 1 MJ, so 1 unit/s = 1 MW): rates for these
 * display as power, and inputs accept power units. */
export const ENERGY_PSEUDO = new Set(["pyops-electricity", "pyops-heat"]);

/** Display an energy pseudo-fluid rate (units/s) as power with the largest
 * sensible unit and trimmed decimals: 5000/s → "5 GW". Watts are per-second by
 * definition, so no /s suffix applies. */
export const fmtPower = (unitsPerSec: number) => {
  const w = unitsPerSec * 1e6;
  const a = Math.abs(w);
  const [div, suf] =
    a >= 1e12
      ? [1e12, "TW"]
      : a >= 1e9
        ? [1e9, "GW"]
        : a >= 1e6
          ? [1e6, "MW"]
          : a >= 1e3
            ? [1e3, "kW"]
            : [1, "W"];
  const m = w / div;
  const s = Math.abs(m) >= 1000 ? m.toFixed(0) : m.toFixed(4).replace(/\.?0+$/, "");
  return `${s} ${suf}`;
};

/** Rate text for a good wherever flows render: power units for the energy
 * pseudo-fluids (never a /s suffix — watts are per-second), adaptive-precision
 * quantity (+ optional /s) for everything else. */
export const rateLabel = (
  good: string,
  rate: number,
  opts?: { perSec?: boolean; sign?: boolean },
) => {
  const sign = opts?.sign && rate > 0 ? "+" : "";
  if (ENERGY_PSEUDO.has(good)) return sign + fmtPower(rate);
  return `${sign}${formatQty(rate)}${opts?.perSec ? "/s" : ""}`;
};

// compact temperature values: 4000 → "4k", 2500 → "2.5k", 125 → "125"
const tempVal = (t: number) =>
  Math.abs(t) >= 1000 ? `${String(Math.round((t / 1000) * 10) / 10)}k` : String(t);

/** A fluid's produced temperature as a chip label ("125°", "4k°"), or null when
 * the recipe doesn't specify one (default-temp fluids stay unlabelled). */
export const fmtTemp = (t?: number | null): string | null => (t == null ? null : `${tempVal(t)}°`);

/** A consumer's accepted temperature range as a chip label: "4k°" (exact),
 * "125–999°", "≥500°", "≤101°" — null when unconstrained. */
export const fmtTempRange = (min?: number | null, max?: number | null): string | null => {
  if (min == null && max == null) return null;
  if (min != null && max != null)
    return min === max ? `${tempVal(min)}°` : `${tempVal(min)}–${tempVal(max)}°`;
  return min != null ? `≥${tempVal(min)}°` : `≤${tempVal(max!)}°`;
};
