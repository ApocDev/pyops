import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "#/lib/utils.ts";

/**
 * Styled, keyboard-accessible tooltip (docs/design.md). Wraps a single
 * hoverable/focusable control and floats `content` beside it on hover **or**
 * keyboard focus, dismissable with Escape — the accessibility native `title`
 * never gave us, and themed to match the app instead of the OS bubble.
 *
 *   <Tooltip content="delete (undoable)">
 *     <IconButton …/>
 *   </Tooltip>
 *
 * The child becomes the trigger (Radix `asChild`), so it must forward ref+props
 * — our `Button`/`Badge`/`Link` and every DOM element already do. When `content`
 * is empty/nullish it renders the child alone, so a possibly-undefined message
 * (e.g. `content={sub?.message}`) is safe to pass.
 *
 * Reach for this for explanatory/warning text and branded controls. Plain
 * full-name reveal on a truncated label (`title={display}` on a `.truncate`
 * span) can stay on the native `title` attribute — that's what it's good at. For
 * rich item/recipe cards use `CursorHover`/`Icon` (`lib/hover.tsx`) instead.
 */
function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  sideOffset = 6,
  delayDuration = 250,
  label = false,
  className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
  align?: React.ComponentProps<typeof TooltipPrimitive.Content>["align"];
  sideOffset?: number;
  delayDuration?: number;
  /**
   * Icon-only trigger with no visible text? Radix only wires the tooltip as a
   * `aria-describedby` *description*, so the control would have no accessible
   * *name*. Set `label` to also mirror the (string) `content` into an
   * `aria-label` — restoring exactly the naming the native `title` used to give
   * an icon button. Leave it off for triggers that already read as text.
   */
  label?: boolean;
  className?: string;
}) {
  if (content == null || content === "" || content === false) return <>{children}</>;
  const trigger =
    label &&
    typeof content === "string" &&
    React.isValidElement<{ "aria-label"?: string; "aria-labelledby"?: string }>(children) &&
    children.props["aria-label"] == null &&
    children.props["aria-labelledby"] == null
      ? React.cloneElement(children, { "aria-label": content })
      : children;
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{trigger}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            data-slot="tooltip"
            side={side}
            align={align}
            sideOffset={sideOffset}
            collisionPadding={8}
            className={cn(
              "z-50 max-w-xs border border-foreground/10 bg-popover px-2 py-1 text-sm text-popover-foreground shadow-md",
              // pre-line so `\n`-joined explanatory strings keep their line breaks and still wrap
              "select-none whitespace-pre-line [overflow-wrap:anywhere]",
              "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95",
              "data-[state=instant-open]:animate-in data-[state=instant-open]:fade-in-0 data-[state=instant-open]:zoom-in-95",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
              "data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
              className,
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export { Tooltip };
