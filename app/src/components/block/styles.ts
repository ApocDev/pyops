/** Shared block-page class strings. These are raw-element styles for shapes the
 * `components/ui` primitives don't cover (dense grid cells, whole-row triggers —
 * Button's fixed-height anatomy would fight them). */

export const head =
  "px-3 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground border-b border-border";

// whole-row picker trigger — icon + truncating label
export const rowBtn = "flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-muted";

// compact YAFC-style cell chip: icon + number, clickable
export const cellChip = "flex items-center gap-1 bg-muted/50 px-1.5 py-1 text-sm hover:bg-accent";
