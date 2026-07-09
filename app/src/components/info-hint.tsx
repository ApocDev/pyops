import { Info } from "lucide-react";
import { Tooltip } from "./ui/tooltip";
import { cn } from "#/lib/utils.ts";

/** A small ⓘ beside a label that reveals one clause of context on hover/focus.
 * The house pattern for qualifiers that used to live inline in parentheses —
 * anything longer than a sentence belongs in a `HelpButton` drawer instead. */
export function InfoHint({ content, className }: { content: string; className?: string }) {
  return (
    <Tooltip content={content}>
      <span
        tabIndex={0}
        aria-label={content}
        className={cn(
          "inline-flex cursor-help items-center text-muted-foreground/70 outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50",
          className,
        )}
      >
        <Info className="size-3.5" />
      </span>
    </Tooltip>
  );
}
