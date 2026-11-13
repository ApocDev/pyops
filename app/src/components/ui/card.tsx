import * as React from "react";

import { cn } from "#/lib/utils.ts";

/** Card surface classes, for an element that must be something other than a
 * div (e.g. a router `Link` that is the whole card). */
const cardClassName =
  "flex flex-col rounded-none border border-border bg-card text-card-foreground";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn(cardClassName, className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex items-center gap-2 border-b px-3 py-2", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-sm font-semibold tracking-wide text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("p-3", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardContent, cardClassName };
