import { Search } from "lucide-react";
import { openCommandPalette } from "./command-palette";
import { useFormattedCombo } from "../lib/hotkeys";
import { Button } from "#/components/ui/button.tsx";
import { Kbd } from "#/components/ui/kbd.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";

/**
 * The top bar's visible way into the command palette. `short` is the compact
 * field in the full desktop bar, `wide` the roomy field in the folded bar
 * (md up to the 1400px fold), `icon` the phone-sized magnifier. Both fields
 * truncate their label first when the bar runs short of room.
 */
export function SearchButton({ size }: { size: "short" | "wide" | "icon" }) {
  const combo = useFormattedCombo("mod+k");
  if (size === "icon") {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Search"
        aria-keyshortcuts="Control+K /"
        onClick={openCommandPalette}
        className="size-10 text-muted-foreground hover:bg-muted/50"
      >
        <Search className="size-5" />
      </Button>
    );
  }
  const wide = size === "wide";
  const field = (
    <Button
      variant="outline"
      aria-label="Search"
      aria-keyshortcuts="Control+K /"
      onClick={openCommandPalette}
      className={`h-7 max-w-full min-w-17 shrink justify-start gap-2 border-input pr-1 pl-2 font-normal text-muted-foreground ${
        wide ? "w-[440px]" : ""
      }`}
    >
      <Search className="size-3.5" />
      <span className="min-w-0 flex-1 truncate text-left">
        {wide ? "Search pages, blocks, goods…" : "Search"}
      </span>
      <Kbd>{wide ? combo : "/"}</Kbd>
    </Button>
  );
  return wide ? field : <Tooltip content={`Search (${combo})`}>{field}</Tooltip>;
}
