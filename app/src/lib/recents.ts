/**
 * Recently visited blocks and goods (#78), surfaced by the command palette
 * when it opens with an empty query. Visits are recorded where they happen —
 * the block editor on load, the browse page on selection — so jumps made
 * through the sidebar count exactly like ones made through the palette.
 *
 * Storage is localStorage (a per-browser view preference, like fold state —
 * not project data). Entries are identity-only where the source of truth is
 * live (a block's label/icon resolve against the current block list at render,
 * so renames show fresh and deleted blocks drop out); goods carry their display
 * name because game data is stable.
 */

export type RecentEntry =
  | { type: "block"; id: number }
  | { type: "good"; name: string; goodKind: "item" | "fluid"; display: string };

/** Most-recent-first cap. The palette shows fewer; the store keeps a little
 * slack so entries that resolve to nothing (deleted blocks) don't leave gaps. */
export const RECENTS_CAP = 12;

const STORAGE_KEY = "pyops.palette.recents";

/** Identity for dedupe: revisiting moves an entry to the front, never duplicates. */
export function recentKey(e: RecentEntry): string {
  return e.type === "block" ? `block:${e.id}` : `good:${e.name}`;
}

/** Pure core: prepend `entry`, drop its older occurrence, cap the list. */
export function pushRecent(
  list: readonly RecentEntry[],
  entry: RecentEntry,
  cap: number = RECENTS_CAP,
): RecentEntry[] {
  const k = recentKey(entry);
  return [entry, ...list.filter((e) => recentKey(e) !== k)].slice(0, cap);
}

/** Keep only entries that look like ones we wrote — localStorage survives app
 * versions, so parse defensively instead of trusting the shape. */
function isRecentEntry(e: unknown): e is RecentEntry {
  if (typeof e !== "object" || e === null) return false;
  const r = e as Record<string, unknown>;
  if (r.type === "block") return typeof r.id === "number" && Number.isFinite(r.id);
  if (r.type === "good")
    return (
      typeof r.name === "string" &&
      r.name.length > 0 &&
      (r.goodKind === "item" || r.goodKind === "fluid") &&
      typeof r.display === "string"
    );
  return false;
}

/** Read the stored list (most recent first). Empty on SSR, missing, or garbage. */
export function loadRecents(): RecentEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isRecentEntry).slice(0, RECENTS_CAP) : [];
  } catch {
    return [];
  }
}

/** Record a visit: load, push-to-front, persist. Safe to call repeatedly with
 * the same entry (idempotent apart from ordering). No-op on SSR. */
export function recordRecent(entry: RecentEntry): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pushRecent(loadRecents(), entry)));
  } catch {
    // quota/serialization failures just skip the record — recents are a nicety
  }
}
