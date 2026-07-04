import * as React from "react";

import { cn } from "#/lib/utils.ts";

/**
 * The one page-title component (docs/design.md): every route renders exactly one
 * PageHeader so the h1 scale, description style, and action alignment never drift.
 * Toolbars (filters, sort controls) go in `children`, below the title row.
 *
 * The header is **sticky** to the top of its scroll container so the title and the
 * toolbar that drives the content below stay reachable on long pages (docs/design.md
 * "Scroll model"). It sits on a solid `bg-background` above row hover/sticky-subheader
 * layers (`z-20`), with a bottom rule marking the stuck bar against the scrolling
 * content behind it. The negative `-mx-4/-mt-4` (paired with `px-4/pt-4`) let the bar
 * bleed to the edges of the page's `p-4` scroll region — every PageHeader lives directly
 * inside a `p-4` container (the root `overflow-auto` for full pages, the SidebarShell
 * inner region for settings); keep that invariant or the bleed misaligns.
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-20 -mx-4 -mt-4 mb-4 flex flex-col gap-2 border-b border-border bg-background px-4 pt-4 pb-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
