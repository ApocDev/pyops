import { useMemo, useRef } from "react";
import { filterList, type FilterKeys } from "./filtered-list";

export type { FilterKeys };

/** `filterList` (#87) as a hook. `keys` is usually an inline object literal,
 * so the memo tracks it through a ref and keys on `items` + `query` alone. */
export function useFilteredList<T>(
  items: readonly T[],
  query: string,
  // NoInfer: T comes from `items`; a `keys` typed on a supertype still fits
  keys: FilterKeys<NoInfer<T>>,
): T[] {
  const keysRef = useRef(keys);
  keysRef.current = keys;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keysRef.current is the latest `keys`
  return useMemo(() => filterList(items, query, keysRef.current), [items, query]);
}
