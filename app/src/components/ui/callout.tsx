import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, type LucideIcon } from "lucide-react";

import { cn } from "#/lib/utils.ts";

/**
 * Block-level status message (docs/development/design.md): a tinted row with an icon and a
 * short sentence — "game not connected", "already balanced", "infeasible".
 * `variant="box"` (default) is a standalone bordered panel; `variant="strip"`
 * is the full-bleed row used inside cards/drawers (borders only top/bottom
 * come from the container). For inline w-fit labels use Badge instead.
 */

const tones: Record<string, { classes: string; strip: string; icon: LucideIcon }> = {
  success: {
    classes: "border-success/40 bg-success/10 text-success",
    strip: "bg-success/10 text-success",
    icon: CheckCircle2,
  },
  warning: {
    classes: "border-warning/40 bg-warning/10 text-warning",
    strip: "bg-warning/10 text-warning",
    icon: AlertTriangle,
  },
  info: {
    classes: "border-info/40 bg-info/10 text-info",
    strip: "bg-info/10 text-info",
    icon: Info,
  },
  destructive: {
    classes: "border-destructive/40 bg-destructive/10 text-destructive",
    strip: "bg-destructive/10 text-destructive",
    icon: OctagonAlert,
  },
  primary: {
    classes: "border-primary/40 bg-primary/10 text-primary",
    strip: "bg-primary/10 text-primary",
    icon: Info,
  },
};

export type CalloutTone = keyof typeof tones;

function Callout({
  tone = "info",
  variant = "box",
  icon,
  title,
  action,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  tone?: CalloutTone;
  variant?: "box" | "strip";
  /** Override the tone's default icon; `null` hides it. */
  icon?: LucideIcon | null;
  title?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const t = tones[tone];
  const IconComp = icon === null ? null : (icon ?? t.icon);
  return (
    <div
      data-slot="callout"
      data-tone={tone}
      className={cn(
        "flex items-start gap-2 text-sm",
        variant === "box" ? cn("border px-3 py-2", t.classes) : cn("px-3 py-1.5", t.strip),
        className,
      )}
      {...props}
    >
      {IconComp && <IconComp className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children}
      </div>
      {action && <div className="ml-2 shrink-0">{action}</div>}
    </div>
  );
}

export { Callout };
