/**
 * Undo action-name formatting (#90) — pure helpers shared by the block editor
 * (which threads descriptive `actionName`s into `saveBlockFn`) and the undo
 * UI (toast wording). Kept dependency-free so the rules are unit-testable.
 */

/**
 * Merge the doc store's pending action label across the edits that accumulate
 * before one debounced save. Rules:
 * - an unlabeled edit keeps whatever label is already pending (a tweak right
 *   after "Add recipe X" still saves as "Add recipe X");
 * - a repeat of the same label stays that label;
 * - two DIFFERENT labels in one burst fall back to null — the save uses the
 *   generic `Edit block "…"` default rather than naming only part of what it
 *   contains.
 */
export function mergeActionLabel(prev: string | null, next: string | null): string | null {
  if (next == null) return prev;
  if (prev == null || prev === next) return next;
  return null;
}

/** The undo-stack name for a labeled editor save: `Add recipe "Auog paddock" — Auog`.
 * Null label → undefined, so `saveBlockFn` falls back to its generic default. */
export function blockActionName(label: string | null, blockName: string): string | undefined {
  if (!label) return undefined;
  const name = blockName.trim();
  return name ? `${label} — ${name}` : label;
}

/** Toast wording after an undo attempt: what was reverted, or a quiet no-op
 * note when the stack was already empty. */
export function undoToastMessage(undone: string | null): string {
  return undone ? `Undid: ${undone}` : "Nothing to undo";
}
