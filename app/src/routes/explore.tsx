import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Droplet } from "lucide-react";
import { searchAllFn, statsFn } from "../server/factorio";
import { IconProvider, Icon } from "../lib/icons";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { FilterEmptyState } from "#/components/filter-empty-state.tsx";
import { FilterInput } from "#/components/filter-input.tsx";
import { GoodDetail } from "#/components/browse/good-detail.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";
import { SidebarShell } from "#/components/sidebar-shell.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";

/** The item/fluid browser + recipe explorer (#97). `sel` lives in the URL so
 * every view is linkable and back/forward walks your browse history. */
export const Route = createFileRoute("/explore")({
  validateSearch: (s: Record<string, unknown>): { sel?: string } =>
    typeof s.sel === "string" && s.sel ? { sel: s.sel } : {},
  component: () => (
    <IconProvider>
      <Browse />
    </IconProvider>
  ),
});

type Kind = "item" | "fluid";

function Browse() {
  const { sel } = Route.useSearch();
  const navigate = useNavigate({ from: "/explore" });
  const [query, setQuery] = useState("");

  const stats = useQuery({ queryKey: ["stats"], queryFn: () => statsFn() });
  const results = useQuery({
    queryKey: ["searchAll", query],
    queryFn: () => searchAllFn({ data: query }),
    enabled: query.trim().length > 0,
    placeholderData: keepPreviousData,
  });
  const open = (name: string) => void navigate({ search: { sel: name } });

  return (
    <SidebarShell
      className="font-mono text-sm text-foreground"
      width="w-72"
      label="Explore search"
      sidebar={(close) => (
        <>
          <div className="border-b border-border p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <FieldLabel>Search</FieldLabel>
              <HelpButton title="What is Explore search?">
                <p>
                  Search every <span className="text-foreground">item and fluid</span> in the loaded
                  Factorio data. Pick one to see its recipes — what makes it, what it&apos;s used in
                  — plus its properties (stack size, fuel value, spoilage, temperatures, and so on).
                </p>
                <p>
                  Use it to explore the recipe graph, and to find the{" "}
                  <span className="text-foreground">internal names</span> that blocks and the
                  assistant refer to (e.g. <span className="text-foreground">iron-pulp-07</span>).
                </p>
                <p>
                  <span className="text-foreground">Worked example.</span> Search{" "}
                  <span className="text-foreground">iron plate</span> and pick it:{" "}
                  <span className="text-foreground">Produced by</span> lists every recipe that makes
                  it (overhaul mods often have several tiers), and{" "}
                  <span className="text-foreground">Consumed by</span> lists where it&apos;s used.
                  Click any ingredient or product chip in a recipe to jump to that good and keep
                  walking upstream — that&apos;s how you trace a chain back to raw ores. A good
                  that&apos;s a fuel or carries a fuel value shows it inline (with its heat energy),
                  so you can tell at a glance whether it burns.
                </p>
              </HelpButton>
            </div>
            <FilterInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search items & fluids…"
              autoFocus
            />
            {stats.data && (
              <div className="mt-1.5 text-sm text-muted-foreground">
                {stats.data.recipes.toLocaleString()} recipes · {stats.data.items.toLocaleString()}{" "}
                items · {stats.data.fluids} fluids
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto p-1">
            {query.trim().length === 0 && (
              <div className="px-2 py-2 text-sm text-muted-foreground">
                Type to search — results are clickable, as is every icon in the detail pane
              </div>
            )}
            {query.trim().length > 0 && results.isPending && (
              <div className="flex flex-col gap-1 px-2 py-1">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-5/6" />
                <Skeleton className="h-6 w-2/3" />
              </div>
            )}
            {query.trim().length > 0 && results.isError && (
              <Callout tone="destructive" variant="strip">
                Search failed — try again
              </Callout>
            )}
            {results.data?.map((r) => (
              <Button
                key={`${r.kind}/${r.name}`}
                variant="ghost"
                onClick={() => {
                  open(r.name);
                  close();
                }}
                className={`h-auto w-full justify-start gap-2 px-2 py-1 font-normal ${
                  sel === r.name ? "bg-accent" : ""
                }`}
                title={r.display ?? r.name}
              >
                <Icon kind={r.kind as Kind} name={r.name} size="sm" noTitle />
                <span className="min-w-0 flex-1 truncate text-left">{r.display ?? r.name}</span>
                {r.kind === "fluid" && (
                  <span className="text-info" title="Fluid">
                    <Droplet className="size-3.5" />
                  </span>
                )}
              </Button>
            ))}
            {query && results.data?.length === 0 && (
              <FilterEmptyState className="px-2 py-3" query={query} onClear={() => setQuery("")} />
            )}
          </div>
        </>
      )}
    >
      <GoodDetail name={sel} onPick={open} className="min-w-0 flex-1 overflow-auto p-4" />
    </SidebarShell>
  );
}
