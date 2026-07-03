/**
 * Per-table view preferences — sort order and folded/expanded state — persisted
 * in localStorage. Display choices, like the number-format toggle, so they live
 * per-browser rather than in the project db. Shared by the factory stat tables
 * (goods sections + machines card); any new sortable/collapsible section should
 * use these instead of re-rolling the persistence.
 */
import { useState } from "react";
import type { SortingState, Updater } from "@tanstack/react-table";

const readJSON = (key: string): unknown => {
  if (typeof localStorage === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
};

/** TanStack Table sorting state that survives reloads under the given key. */
export function usePersistedSorting(key: string, defaultSorting: SortingState) {
  const [sorting, setSorting] = useState<SortingState>(() => {
    const saved = readJSON(key);
    return Array.isArray(saved) && saved.length ? (saved as SortingState) : defaultSorting;
  });
  const onSortingChange = (u: Updater<SortingState>) =>
    setSorting((old) => {
      const next = typeof u === "function" ? u(old) : u;
      if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  return [sorting, onSortingChange] as const;
}

/** A section's collapsed state, persisted under the given key. */
export function usePersistedFold(key: string) {
  const [folded, setFolded] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem(key) === "1",
  );
  const toggleFold = () =>
    setFolded((f) => {
      localStorage.setItem(key, f ? "0" : "1");
      return !f;
    });
  return [folded, toggleFold] as const;
}
