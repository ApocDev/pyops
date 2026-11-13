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

/** Pick the largest unit whose threshold the value reaches once rounded to 3
 * significant figures, so 999,999 reads "1M" rather than "1000K". */
function pickUnit<T>(n: number, units: readonly (readonly [number, T])[]) {
  const rounded = Math.abs(Number(n.toPrecision(3)));
  return units.find(([scale]) => rounded >= scale);
}

/** The non-compact precision rules shared by quantities and power mantissas:
 *  - 0 → "0" (only a TRUE zero reads as zero)
 *  - |n| < 1 → two significant digits ("0.001", "0.00012"; "1.2e-9" when tiny)
 *  - 1 ≤ |n| < 100 → up to 2 decimals, trailing zeros trimmed ("3.74", "1.5")
 *  - |n| ≥ 100 → whole number, thousands-separated ("124", "3,740") */
function plain(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 100) return Math.round(n).toLocaleString("en-US");
  if (abs >= 1) return trim(n.toFixed(2));
  // below 1: two significant digits, so the smallest nonzero flow stays visible
  const s = n.toPrecision(2);
  if (s.includes("e")) {
    const [mantissa, exp] = s.split("e");
    return `${trim(mantissa)}e${exp}`;
  }
  return trim(s);
}

/** Format a quantity/rate with magnitude-scaled precision (see `plain`). With
 * compact numbers on, every value from 1000 up renders with a suffix ("8.73K",
 * "12.5K", "1.5M"), so cells in one row never mix "10.2K" with "8,729". */
export function formatQty(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : n < 0 ? "-∞" : "NaN";
  const unit = compact ? pickUnit(n, COMPACT_UNITS) : undefined;
  if (!unit) return plain(n);
  const [scale, suffix] = unit;
  const v = n / scale;
  const av = Math.abs(v);
  return trim(v.toFixed(av >= 100 ? 0 : av >= 10 ? 1 : 2)) + suffix;
}

/** A per-second rate: adaptive quantity + "/s". */
export const formatRate = (n: number): string => `${formatQty(n)}/s`;

/** Coarse "how stale is this sync" text: "12s ago", "3m ago", "2h ago",
 * "107 days ago". */
export function timeAgo(iso: string): string {
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  const days = Math.round(sec / 86400);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** Energy pseudo-fluids (1 unit = 1 MJ, so 1 unit/s = 1 MW): rates for these
 * display as power, and inputs accept power units. */
export const ENERGY_PSEUDO = new Set(["pyops-electricity", "pyops-heat", "pyops-fluid-fuel"]);

const POWER_UNITS = [
  [1e12, "TW"],
  [1e9, "GW"],
  [1e6, "MW"],
  [1e3, "kW"],
] as const;

/** Power in watts, with the largest sensible unit and the same precision as
 * `formatQty`: 357.3451 MW → "357 MW", 88.5046 MW → "88.5 MW". Watts are
 * per-second by definition, so the result never takes a /s suffix. */
export function formatPower(watts: number): string {
  const [scale, unit] = pickUnit(watts, POWER_UNITS) ?? [1, "W"];
  return `${plain(watts / scale)} ${unit}`;
}

/** Solver residue on a net flow (-1.4e-14, +2e-8, -0.00019 of 156/s) reads as
 * an exact 0. A net below the 4th significant figure of the throughput is
 * invisible in the produced/consumed cells too, so "0" matches what they show.
 * The absolute floor matches `meaningfulImbalance`. */
export const snapResidue = (net: number, throughput: number) =>
  Math.abs(net) <= Math.max(1e-6, 1e-4 * Math.abs(throughput)) ? 0 : net;

/** Rate text for a good wherever flows render: power units for the energy
 * pseudo-fluids (never a /s suffix — watts are per-second), adaptive-precision
 * quantity (+ optional /s) for everything else. */
export const rateLabel = (
  good: string,
  rate: number,
  opts?: { perSec?: boolean; sign?: boolean },
) => {
  const sign = opts?.sign && rate > 0 ? "+" : "";
  // energy pseudo-fluids: 1 unit/s = 1 MW
  if (ENERGY_PSEUDO.has(good)) return sign + formatPower(rate * 1e6);
  return `${sign}${formatQty(rate)}${opts?.perSec ? "/s" : ""}`;
};

/** A finite amount of a good. Energy pseudo-fluids use MJ as their stored
 * quantity unit, so campaign totals need an energy unit rather than looking
 * like an unexplained item count. */
export const quantityLabel = (good: string, quantity: number) =>
  ENERGY_PSEUDO.has(good) ? `${formatQty(quantity)} MJ` : formatQty(quantity);

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
