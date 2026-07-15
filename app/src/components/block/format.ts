/** Block-page display formats. `num` (adaptive precision, #74) is the shared
 * quantity format; the rest are page-specific compactions. */
import { formatQty } from "../../lib/format";

export { ENERGY_PSEUDO, fmtPower, quantityLabel, rateLabel } from "../../lib/format";

export const num = formatQty; // adaptive precision (#74) — shared with every other table

// goal-rate display: enough precision to be exact, trailing zeros trimmed
export const fmtRate = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (Math.abs(n) < 0.0001) return formatQty(n); // below toFixed(4) — sig-figs, never "0"
  // large rates are whole numbers with NO decimal point — never run the
  // zero-trimmer on them (it would eat integer zeros: 5000 → "5")
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  return n.toFixed(4).replace(/\.?0+$/, ""); // trim only trailing DECIMAL zeros
};

export const fmtW = (w: number) =>
  w >= 1e12
    ? `${(w / 1e12).toFixed(2)} TW`
    : w >= 1e9
      ? `${(w / 1e9).toFixed(2)} GW`
      : w >= 1e6
        ? `${(w / 1e6).toFixed(2)} MW`
        : w >= 1e3
          ? `${(w / 1e3).toFixed(0)} kW`
          : `${w.toFixed(0)} W`;

export const fmtJ = (j: number) =>
  j >= 1e9
    ? `${(j / 1e9).toFixed(1)} GJ`
    : j >= 1e6
      ? `${(j / 1e6).toFixed(1)} MJ`
      : j >= 1e3
        ? `${(j / 1e3).toFixed(0)} kJ`
        : `${j.toFixed(0)} J`;

// io amounts: integers stay clean ("50", "1000"), long numbers humanize ("1.2k")
export const fmtAmt = (n: number) => {
  const r = Math.round(n * 100) / 100;
  const plain = String(r);
  if (plain.length <= 5) return plain;
  for (const [div, suf] of [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ] as const) {
    if (Math.abs(r) >= div) return `${Math.round((r / div) * 10) / 10}${suf}`;
  }
  return plain;
};

// cost-analysis values span 0.001 … 500k — compact but readable
export const fmtCost = (c: number) =>
  c >= 1e6
    ? `${(c / 1e6).toFixed(1)}M`
    : c >= 1e3
      ? `${(c / 1e3).toFixed(1)}k`
      : c >= 10
        ? c.toFixed(0)
        : c.toFixed(2);

export const fmtCount = (n: number) =>
  !Number.isFinite(n)
    ? "∞"
    : n === 0
      ? "0"
      : n < 0.01
        ? "<0.01"
        : n >= 10
          ? n.toFixed(0)
          : n >= 1
            ? n.toFixed(1)
            : n.toFixed(2);

const MAGNITUDE: Record<string, number> = { k: 1e3, m: 1e6, g: 1e9, t: 1e12 };
// power → solver units/s (1 unit = 1 MJ): 1 MW = 1 unit/s
const POWER: Record<string, number> = { w: 1e-6, kw: 1e-3, mw: 1, gw: 1e3, tw: 1e6 };

/** Parse a rate-input string with optional suffix: magnitude (k/M/G/T — plain
 * multipliers) always; power units (W/kW/MW/GW/TW) when `energy` (converted to
 * solver units/s). A power-unit value is ALREADY per-second (`perSecond`), so
 * the caller must not apply the /min·/h display-window factor to it. Returns
 * null for unparseable input or an unknown suffix. */
export function parseRateInput(
  text: string,
  energy = false,
): { value: number; perSecond: boolean } | null {
  const m = /^\s*(-?\d*\.?\d+)\s*([a-z]*)\s*$/i.exec(text);
  if (!m) {
    const n = Number(text); // fall back for exotic-but-valid forms like "1e3"
    return Number.isFinite(n) ? { value: n, perSecond: false } : null;
  }
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const suf = m[2].toLowerCase();
  if (!suf) return { value: n, perSecond: false };
  if (energy && suf in POWER) return { value: n * POWER[suf], perSecond: true };
  if (suf in MAGNITUDE) return { value: n * MAGNITUDE[suf], perSecond: false };
  return null;
}
