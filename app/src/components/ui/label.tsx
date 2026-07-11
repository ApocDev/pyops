import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";

import { cn } from "#/lib/utils.ts";

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Micro caption above a field group or stat cluster — the uppercase muted
 * eyebrow. True fine print, so text-xs is allowed here (docs/development/design.md).
 */
function FieldLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-label"
      className={cn("text-xs font-medium tracking-wide text-muted-foreground uppercase", className)}
      {...props}
    />
  );
}

export { Label, FieldLabel };
