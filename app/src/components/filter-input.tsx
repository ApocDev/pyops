import { Search, X } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { cn } from "#/lib/utils.ts";

/** The standard search box over a filtered list (#87): a leading search glyph,
 * the `Input` primitive, and a clear button once there's a query. Pair with
 * `useFilteredList` (matching/ranking) and `FilterEmptyState` (no matches). */
export function FilterInput({
  value,
  onValueChange,
  placeholder,
  className,
  autoFocus,
}: {
  value: string;
  onValueChange: (value: string) => void;
  /** page-specific hint, e.g. "filter goods…" */
  placeholder: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={placeholder}
        className={cn("pl-7", value !== "" && "pr-7")}
      />
      {/* titled "clear", not "clear filter" — FilterEmptyState renders a "clear
          filter" button and the two shouldn't collide in accessible-name queries */}
      {value !== "" && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onValueChange("")}
          title="clear"
          className="absolute top-1/2 right-0.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X />
        </Button>
      )}
    </div>
  );
}
