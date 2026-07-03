/**
 * The shared filtered-list primitive (#87). Every page that filters a
 * client-side list through a search box goes through `filterList` /
 * `useFilteredList`, so matching behavior stays identical everywhere:
 * localized display names are the primary target, internal names
 * (`iron-pulp-07`) are a hidden fallback, and results rank best-first with the
 * same scorer the command palette uses (`fuzzyScore` — one matching behavior
 * app-wide, not a third implementation). Pair with `FilterInput` for the box
 * and `FilterEmptyState` for the no-matches state.
 *
 * This module is pure (no React) so it unit-tests in a node environment; the
 * `useFilteredList` hook lives in `use-filtered-list.ts`.
 */
import { fuzzyScore } from "./command-search";

type Candidate = string | null | undefined;

export type FilterKeys<T> = {
  /** localized display name(s) — the primary match target */
  display: (item: T) => Candidate | readonly Candidate[];
  /** internal name(s) — matched only when no display name hits, never shown */
  internal?: (item: T) => Candidate | readonly Candidate[];
};

const bestScore = (
  query: string,
  values: Candidate | readonly Candidate[],
  map: (s: string) => string = (s) => s,
): number => {
  let best = 0;
  for (const v of Array.isArray(values) ? values : [values]) {
    if (!v) continue;
    const s = fuzzyScore(query, map(v));
    if (s > best) best = s;
  }
  return best;
};

// internal names are hyphen/underscore-separated ("iron-pulp-07"); match them
// separator-insensitively, the way the server-side searchAll does
const normalize = (s: string) => s.replace(/[-_\s]+/g, " ");

// fuzzyScore tops out below this, so adding it makes ANY display match outrank
// EVERY internal-only match (internal names are a fallback, not a peer field).
const DISPLAY_TIER = 10;

/** Filter `items` against `query` and sort best-first (stable: callers' input
 * order is the final tiebreak, and an empty query returns the list untouched). */
export function filterList<T>(
  items: readonly T[],
  query: string,
  // NoInfer: T comes from `items`; a `keys` typed on a supertype still fits
  keys: FilterKeys<NoInfer<T>>,
): T[] {
  const q = query.trim();
  if (!q) return [...items];
  const qNorm = normalize(q.toLowerCase());
  const ranked: { item: T; score: number; i: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const display = bestScore(q, keys.display(item));
    const score =
      display > 0
        ? display + DISPLAY_TIER
        : keys.internal
          ? bestScore(qNorm, keys.internal(item), normalize)
          : 0;
    if (score > 0) ranked.push({ item, score, i });
  }
  return ranked.sort((a, b) => b.score - a.score || a.i - b.i).map((r) => r.item);
}
