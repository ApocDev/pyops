import { createFileRoute, redirect } from "@tanstack/react-router";

type DependencySearch = { sel?: string; kind?: "recipe"; dir?: "requiredBy" };

/** Compatibility redirect that preserves the dependency root and direction. */
export const Route = createFileRoute("/deps")({
  validateSearch: (search: Record<string, unknown>): DependencySearch => ({
    ...(typeof search.sel === "string" && search.sel ? { sel: search.sel } : {}),
    ...(search.kind === "recipe" ? { kind: "recipe" as const } : {}),
    ...(search.dir === "requiredBy" ? { dir: "requiredBy" as const } : {}),
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/explore/dependencies", search, replace: true });
  },
});
