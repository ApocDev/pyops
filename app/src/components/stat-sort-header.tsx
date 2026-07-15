import type { Header } from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";

import { cn } from "#/lib/utils.ts";

/**
 * The click-to-sort variant of the stat-table header row (`StatTableHeader` is
 * the static one — same anatomy, no sorting): one sort-toggle button per
 * TanStack Table column, sticky inside the section's height-capped scroll area.
 * `widths[columnId]` must match the `w` the rows pass to the corresponding
 * `StatCell` (minus the `md:` prefix — the header is already md-only): the lead
 * column takes `flex-1 text-left`, numeric columns add `justify-end`.
 */
export function StatSortHeader<T>({
  headers,
  widths,
  className,
}: {
  headers: Header<T, unknown>[];
  widths: Record<string, string>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 hidden gap-2 bg-card px-3 pb-1 text-sm text-muted-foreground md:flex",
        className,
      )}
    >
      {headers.map((h) => {
        const dir = h.column.getIsSorted();
        return (
          <button
            key={h.id}
            onClick={h.column.getToggleSortingHandler()}
            title="Click to sort"
            className={cn(
              "flex items-center gap-0.5 hover:text-foreground",
              widths[h.id],
              dir && "text-foreground",
            )}
          >
            {h.column.columnDef.header as string}
            {dir === "asc" && <ArrowUp className="size-3" />}
            {dir === "desc" && <ArrowDown className="size-3" />}
          </button>
        );
      })}
    </div>
  );
}
