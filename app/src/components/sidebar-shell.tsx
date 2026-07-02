import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { PanelLeft } from "lucide-react";

import { cn } from "#/lib/utils.ts";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";

/**
 * Rail-or-drawer layout shell for the routes built around a fixed left sidebar
 * (block, browse, assistant, tasks). From `md` up the sidebar is the familiar
 * inline rail; below `md` it would crush the content, so it collapses behind a
 * toggle into a left drawer.
 *
 * Closing the drawer on selection: routes that open a detail by changing the
 * pathname (block → /block/$id) close automatically. Routes that select via a
 * search param (browse ?sel, assistant ?c, tasks ?t/?n) pass a render function
 * for `sidebar` and call the supplied `close()` in their select handlers — that
 * way switching an in-drawer list tab (tasks' Tasks/Notes) does NOT close it,
 * only actually picking an item does.
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
  sidebarClassName,
}: {
  sidebar: ReactNode | ((close: () => void) => ReactNode);
  children: ReactNode;
  /** Tailwind width class for the rail/drawer (must be a literal, e.g. "w-64"). */
  width?: string;
  /** Text on the mobile toggle button. */
  label?: string;
  className?: string;
  /** Extra classes for the desktop rail (e.g. a "bg-card" the route's aside had). */
  sidebarClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  const close = () => setOpen(false);
  // Pathname-based selection (block → /block/$id) auto-closes. Search-param routes
  // call close() themselves so an in-drawer tab switch (same pathname) doesn't.
  useEffect(() => setOpen(false), [pathname]);
  const sidebarNode = typeof sidebar === "function" ? sidebar(close) : sidebar;

  return (
    <div className={cn("flex h-full", className)}>
      {/* md+: inline rail */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-border md:flex",
          width,
          sidebarClassName,
        )}
      >
        {sidebarNode}
      </aside>

      {/* main column, with a mobile-only toggle bar above it */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center border-b border-border px-2 md:hidden">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(true)}
            className="text-muted-foreground"
          >
            <PanelLeft className="size-4" /> {label}
          </Button>
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
          <div className="flex h-full flex-col">{sidebarNode}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
