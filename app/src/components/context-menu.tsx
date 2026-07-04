import * as React from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * Right-click context menu shell (docs/design.md): a Radix `DropdownMenu`
 * anchored at the pointer, so Escape-to-close, focus containment/roving,
 * `role="menu"` semantics, and click-away come from the primitive rather than a
 * hand-rolled backdrop (#86). Callers stay declarative — own the open state and
 * render `{menu && <ContextMenu x y onClose>…</ContextMenu>}`; a second
 * right-click still dismisses.
 */
function ContextMenu({
  x,
  y,
  onClose,
  className,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* A zero-size anchor at the pointer; Radix positions the menu against it
          and keeps it on-screen (collision handling the old backdrop lacked). */}
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none fixed" style={{ left: x, top: y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={0}
        alignOffset={0}
        className={cn("min-w-48", className)}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One row in a ContextMenu: icon + label, full-width hover/highlight target. */
function ContextMenuItem({
  children,
  onClick,
  active,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenuItem
      onClick={onClick}
      className={cn("gap-2 px-3 py-1 text-sm", active && "text-info", className)}
    >
      {children}
    </DropdownMenuItem>
  );
}

export { ContextMenu, ContextMenuItem };
