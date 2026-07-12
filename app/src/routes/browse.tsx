import { createFileRoute, redirect } from "@tanstack/react-router";

/** Compatibility redirect that preserves the selected good in older saved links. */
export const Route = createFileRoute("/browse")({
  validateSearch: (search: Record<string, unknown>): { sel?: string } =>
    typeof search.sel === "string" && search.sel ? { sel: search.sel } : {},
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/explore", search, replace: true });
  },
});
