import * as React from "react";

import { cn } from "#/lib/utils.ts";

/**
 * Minimal right-click context menu shell (docs/design.md): a full-viewport
 * invisible backdrop that dismisses on click / second right-click, plus a
 * square-cornered panel positioned at the pointer, sharing Select's popover
 * surface. Callers own the open state and render `{menu && <ContextMenu …>}`.
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
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className={cn(
          "fixed z-50 min-w-48 overflow-hidden bg-popover py-1 text-popover-foreground shadow-md ring-1 ring-foreground/10",
          className,
        )}
        style={{ left: x, top: y }}
      >
        {children}
      </div>
    </>
  );
}

/** One row in a ContextMenu: icon + label, full-width hover target. */
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
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1 text-left text-sm hover:bg-muted",
        active && "text-info",
        className,
      )}
    >
      {children}
    </button>
  );
}

export { ContextMenu, ContextMenuItem };
