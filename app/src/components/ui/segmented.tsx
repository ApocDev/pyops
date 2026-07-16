import * as React from "react";

import { cn } from "#/lib/utils.ts";

/**
 * Choose-one segmented control: joined segments inside one border, the active
 * segment filled with `primary`. Unmistakably a control (unlike a row of loose
 * toggle chips) — use it for mutually exclusive modes (Now/Future/Target,
 * Table/Flow, Requires/Required-by). Independent on/off chips stay
 * `Button variant="toggle"`; a wrapping many-option pick stays toggles too.
 */
function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  size = "default",
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: React.ReactNode; disabled?: boolean }[];
  size?: "default" | "sm";
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="segmented"
      className={cn(
        "inline-flex w-fit items-stretch divide-x divide-border border border-border bg-background dark:bg-input/20",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          disabled={o.disabled}
          onClick={() => onValueChange(o.value)}
          className={cn(
            "flex items-center justify-center gap-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            size === "sm" ? "h-7 px-2.5" : "h-8 px-3",
            value === o.value
              ? "bg-primary-solid text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export { Segmented };
