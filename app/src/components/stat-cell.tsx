import { type ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * A table stat cell that reflows for mobile — the shared building block for the
 * data tables (factory goods + machines, whatif block changes, …) so dense rows
 * stay readable on phones without each table reinventing it.
 *
 * Desktop (md+): a right-aligned fixed-width column — pass the width via `w`
 * (e.g. "md:w-24"); the column header is hidden separately by the caller.
 * Mobile: the value carries its own label stacked above it, and the value
 * doesn't wrap, so a rate keeps its unit on the same line. The parent supplies
 * the mobile grid wrapper (2- or 3-up).
 */
export function StatCell({
  label,
  w,
  className,
  children,
}: {
  label: string;
  /** Desktop width class, e.g. "md:w-24". */
  w: string;
  /** Colour / weight for the value column. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("flex min-w-0 flex-col md:block md:text-right", w, className)}>
      <span className="text-sm font-normal text-muted-foreground md:hidden">{label}</span>
      <span className="whitespace-nowrap md:whitespace-normal">{children}</span>
    </span>
  );
}
