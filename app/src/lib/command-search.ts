/**
 * Query matching for the command palette (#78): a small, dependency-free
 * fuzzy-ish scorer. Tiers (best first): exact match, prefix, word-boundary
 * prefix, substring, in-order subsequence. Within a tier, shorter targets rank
 * first (a query is a bigger fraction of them).
 *
 * Deliberately minimal — fancier ranking (frecency, recent selections, typo
 * tolerance) can layer on later without changing callers.
 */

/** Score `query` against `text`. 0 = no match; higher is better. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1; // empty query matches everything, weakly
  // length bonus in (0, 1): breaks ties inside a tier toward shorter targets.
  const tighter = 1 / (1 + t.length);
  if (t === q) return 5 + tighter;
  if (t.startsWith(q)) return 4 + tighter;
  const at = t.indexOf(q);
  if (at > 0 && !/[a-z0-9]/.test(t[at - 1])) return 3 + tighter; // word-boundary start
  if (at > 0) return 2 + tighter;
  // subsequence: every query char appears in order ("coh" ~ "Coherence", "nbl" ~ "New block")
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 1 + tighter : 0;
}

/** Filter `items` to those matching `query` and sort best-first (stable within
 * equal scores, so callers' input order is the final tiebreak). */
export function rankMatches<T>(query: string, items: T[], text: (item: T) => string): T[] {
  return items
    .map((item, i) => ({ item, i, score: fuzzyScore(query, text(item)) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.item);
}
