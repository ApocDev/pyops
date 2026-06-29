import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { PanelLeft } from "lucide-react";

import { cn } from "#/lib/utils.ts";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";

/**
 * Rail-or-drawer layout shell for the routes built around a fixed left sidebar
 * (block, browse). From `md` up the sidebar is the familiar inline rail; below
 * `md` it would crush the content, so it collapses behind a toggle into a left
 * drawer. The drawer auto-closes on navigation, so picking an item dismisses it.
 *
 * `sidebar` is rendered in both the rail and the drawer; keep its state in the
 * consuming route (both renders then read one source of truth, no divergence).
 */
export function SidebarShell({
  sidebar,
  children,
  width = "w-64",
  label = "Menu",
  className,
}: {
  sidebar: ReactNode;
  children: ReactNode;
  /** Tailwind width class for the rail/drawer (must be a literal, e.g. "w-64"). */
  width?: string;
  /** Text on the mobile toggle button. */
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  // Selecting an item navigates; close the drawer whenever that happens.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className={cn("flex h-full", className)}>
      {/* md+: inline rail */}
      <aside className={cn("hidden shrink-0 flex-col border-r border-border md:flex", width)}>
        {sidebar}
      </aside>

      {/* main column, with a mobile-only toggle bar above it */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center border-b border-border px-2 md:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex h-8 items-center gap-1.5 rounded border border-border px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PanelLeft className="size-4" /> {label}
          </button>
        </div>
        {children}
      </div>

      {/* below md: the same sidebar in a drawer */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          showClose={false}
          aria-describedby={undefined}
          className={cn("p-0", width)}
        >
          <SheetTitle className="sr-only">{label}</SheetTitle>
          <div className="flex h-full flex-col">{sidebar}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
