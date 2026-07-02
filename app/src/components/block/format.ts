/** Block-page display formats. `num` (adaptive precision, #74) is the shared
 * quantity format; the rest are page-specific compactions. */
import { formatQty } from "../../lib/format";

export const num = formatQty; // adaptive precision (#74) — shared with every other table

// goal-rate display: enough precision to be exact, trailing zeros trimmed
export const fmtRate = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (Math.abs(n) < 0.0001) return formatQty(n); // below toFixed(4) — sig-figs, never "0"
  const s = Math.abs(n) >= 1000 ? n.toFixed(0) : n.toFixed(4);
  return s.replace(/\.?0+$/, "");
};

export const fmtW = (w: number) =>
  w >= 1e9
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
