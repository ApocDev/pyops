import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "#/lib/utils.ts";

/**
 * The one empty-state component (docs/design.md): say what's missing and, via
 * `action`, how to fill it. Async surfaces must never render blank.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-1.5 p-8 text-center", className)}
    >
      {Icon && <Icon className="mb-1 size-8 text-muted-foreground/50" aria-hidden />}
      <div className="text-sm font-medium">{title}</div>
      {description && <div className="max-w-sm text-sm text-muted-foreground">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
