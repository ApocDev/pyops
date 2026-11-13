/**
 * TanStack Table features for the factory stat tables (goods sections and the
 * machines card): client-side sorting and column visibility, nothing else. The
 * text sort fns are the ones auto-sort picks for string columns; without them it
 * falls back to a plain comparison and "iron-pulp-07" sorts after "iron-pulp-10".
 */
import {
  columnVisibilityFeature,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
} from "@tanstack/react-table";

export const statTableFeatures = tableFeatures({
  rowSortingFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

export type StatTableFeatures = typeof statTableFeatures;
