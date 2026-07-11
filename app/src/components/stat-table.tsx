import { type ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * The desktop header row of the app's stat-table anatomy (see `docs/development/design.md`):
 * a muted `hidden md:flex` line with a `flex-1` lead label over the rows' lead
 * cells and fixed-width right-aligned labels over their `StatCell` columns.
 * Each `cols[i].w` must match the `w` the rows pass to the corresponding
 * `StatCell` (minus its `md:` prefix — the header is already md-only), or the
 * columns drift out from under their labels.
 *
 * The rows themselves stay hand-written (they differ per table: Link vs div,
 * nesting, badges); only the header anatomy is shared.
 */
export function StatTableHeader({
  lead,
  cols,
  className,
}: {
  lead: ReactNode;
  cols: { label: ReactNode; w: string }[];
  className?: string;
}) {
  return (
    <div className={cn("hidden px-3 pb-1 text-sm text-muted-foreground md:flex", className)}>
      <span className="flex-1">{lead}</span>
      {cols.map((c, i) => (
        <span key={i} className={`${c.w} text-right`}>
          {c.label}
        </span>
      ))}
    </div>
  );
}
