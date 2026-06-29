import { type ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * A table stat cell that reflows for mobile — the shared building block for the
 * data tables (factory goods + machines, whatif block changes, …) so dense rows
 * stay readable on phones without each table reinventing it.
 *
 * Desktop (md+): a right-aligned fixed-width column — pass the width via `w`
 * (e.g. "md:w-24"); the column header is hidden separately by the caller.
 * Mobile: the value carries its own label, either label-beside-value
 * (`layout="row"`, good in a 2-up grid) or label-above-value (`layout="stack"`,
 * good in a tighter 3-up grid). The parent supplies the mobile grid wrapper.
 */
export function StatCell({
  label,
  w,
  layout = "stack",
  className,
  children,
}: {
  label: string;
  /** Desktop width class, e.g. "md:w-24". */
  w: string;
  layout?: "row" | "stack";
  /** Colour / weight for the value column. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        layout === "row" ? "flex items-baseline justify-between gap-2" : "flex flex-col",
        "md:block md:text-right",
        w,
        className,
      )}
    >
      <span className="text-xs font-normal text-muted-foreground md:hidden">{label}</span>
      <span>{children}</span>
    </span>
  );
}
