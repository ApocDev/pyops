import * as React from "react";

import { cn } from "#/lib/utils.ts";

/** A keycap hint, e.g. `<Kbd>/</Kbd>` or `<Kbd>{formatCombo("mod+k")}</Kbd>`. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
