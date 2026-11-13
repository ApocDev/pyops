import { fmtCost } from "../block/format.ts";

/** ¥ per unit: two decimals (¥10.04 vs ¥14.27 must stay comparable), two
 * significant digits for cheap fluids (¥0.0042), `fmtCost` above ¥1000. */
export const fmtUnitCost = (c: number) =>
  c > 0 && c < 0.1 ? c.toPrecision(2) : c < 1000 ? c.toFixed(2) : fmtCost(c);

/** One producer's bar on the explorer's price ladder: ¥ per unit of the
 * selected good on a scale shared by the whole list (`max`, capped by the
 * list). The solid part runs up to the good's price; the hatched rest is what
 * the recipe wastes. */
export function PriceLadder({
  unit,
  price,
  max,
  waste,
}: {
  /** ¥ per unit of the selected good, null when unpriced */
  unit: number | null;
  /** the selected good's cost-analysis price */
  price: number | null;
  /** the list's scale: its largest ¥ per unit, up to a cap */
  max: number;
  /** the recipe's waste share, 0–1 */
  waste: number | null;
}) {
  const pct = (n: number) => `${max > 0 ? (n / max) * 100 : 0}%`;
  // a unit cost past the scale's cap draws a full-width bar
  const shown = unit == null ? 0 : Math.min(unit, max);
  const kept = Math.min(shown, Math.max(0, price ?? shown));
  const lost = shown - kept;
  const wastePct = waste != null ? Math.round(waste * 100) : null;
  return (
    <div className="mt-1 flex items-center gap-2.5" data-testid="price-ladder">
      <span className="flex h-3 min-w-15 flex-1 bg-muted/60" aria-hidden>
        <span className="h-full bg-success" style={{ width: pct(kept) }} />
        <span
          className="h-full bg-[repeating-linear-gradient(135deg,color-mix(in_oklch,var(--destructive)_75%,transparent)_0_3px,color-mix(in_oklch,var(--destructive)_25%,transparent)_3px_6px)]"
          style={{ width: pct(lost) }}
        />
      </span>
      <span className="flex w-28 shrink-0 flex-col items-end text-sm tabular-nums">
        {unit == null ? (
          <span className="text-muted-foreground">Not priced</span>
        ) : (
          <>
            <span className="text-base font-semibold">¥{fmtUnitCost(unit)}</span>
            {wastePct != null && wastePct >= 5 && (
              <span
                className={
                  wastePct >= 90
                    ? "text-destructive"
                    : wastePct >= 50
                      ? "text-warning"
                      : "text-muted-foreground"
                }
              >
                {wastePct}% waste
              </span>
            )}
          </>
        )}
      </span>
    </div>
  );
}
