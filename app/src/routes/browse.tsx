import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Droplet, Flame, Network, Search } from "lucide-react";
import { browseDetailFn, searchAllFn, statsFn } from "../server/factorio";
import { IconProvider, Icon } from "../lib/icons";
import { recordRecent } from "../lib/recents";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { FilterEmptyState } from "#/components/filter-empty-state.tsx";
import { FilterInput } from "#/components/filter-input.tsx";
import { FlowStaleCallout } from "#/components/browse/flow-stale-callout.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";
import { RecipeList } from "#/components/browse/recipe-list.tsx";
import { SidebarShell } from "#/components/sidebar-shell.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";

/** The item/fluid browser + recipe explorer (#97). `sel` lives in the URL so
 * every view is linkable and back/forward walks your browse history. */
export const Route = createFileRoute("/browse")({
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
  const navigate = useNavigate({ from: "/browse" });
  const [query, setQuery] = useState("");
  // the detail pane's recipe filter — reset when the selected good changes, so
  // walking the graph never lands on an invisibly-filtered list
  const [recipeQuery, setRecipeQuery] = useState("");
  useEffect(() => setRecipeQuery(""), [sel]);

  const stats = useQuery({ queryKey: ["stats"], queryFn: () => statsFn() });
  const results = useQuery({
    queryKey: ["searchAll", query],
    queryFn: () => searchAllFn({ data: query }),
    enabled: query.trim().length > 0,
    placeholderData: keepPreviousData,
  });
  const detail = useQuery({
    queryKey: ["browseDetail", sel],
    queryFn: () => browseDetailFn({ data: sel! }),
    enabled: !!sel,
    placeholderData: keepPreviousData,
  });

  const open = (name: string) => void navigate({ search: { sel: name } });

  // A good that resolves to a detail view is a visit — surfaces it in the
  // command palette's Recent group (#78). Recorded here (not in the palette)
  // so sidebar clicks and shared links count the same as palette jumps.
  const detailData = detail.data;
  useEffect(() => {
    if (!detailData || detailData.name !== sel) return;
    recordRecent({
      type: "good",
      name: detailData.name,
      goodKind: detailData.kind as Kind,
      display: detailData.display ?? detailData.name,
    });
  }, [detailData, sel]);

  return (
    <SidebarShell
      className="font-mono text-sm text-foreground"
      width="w-72"
      label="Browse"
      sidebar={(close) => (
        <>
          <div className="border-b border-border p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <FieldLabel>Browse</FieldLabel>
              <HelpButton title="What is Browse?">
                <p>
                  Search every <span className="text-foreground">item and fluid</span> in the loaded
                  Pyanodons data. Pick one to see its recipes — what makes it, what it&apos;s used
                  in — plus its properties (stack size, fuel value, spoilage, temperatures, and so
                  on).
                </p>
                <p>
                  Use it to explore Py&apos;s tangled recipe graph, and to find the{" "}
                  <span className="text-foreground">internal names</span> that blocks and the
                  assistant refer to (e.g. <span className="text-foreground">iron-pulp-07</span>).
                </p>
              </HelpButton>
            </div>
            <FilterInput
              value={query}
              onValueChange={setQuery}
              placeholder="search items & fluids…"
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
                type to search — results are clickable, as is every icon in the detail pane
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
                search failed — try again
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
                  <span className="text-info" title="fluid">
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
      {/* Detail pane */}
      <div className="min-w-0 flex-1 overflow-auto p-4">
        {!sel && (
          <EmptyState
            className="h-full"
            icon={Search}
            title="Nothing selected"
            description="Search on the left, or click any icon anywhere to inspect it."
          />
        )}
        {sel && detail.isPending && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-12" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-64" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          </div>
        )}
        {sel && detail.isError && (
          <Callout tone="destructive">failed to load this item — try again</Callout>
        )}
        {detail.data && (
          <>
            <div className="mb-4 flex items-center gap-3">
              <Icon kind={detail.data.kind as Kind} name={detail.data.name} size="lg" noTitle />
              <div>
                <h1 className="text-lg font-semibold tracking-tight">{detail.data.display}</h1>
                <div className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
                  {detail.data.name} · {detail.data.kind}
                  {detail.data.item?.stackSize != null && ` · stack ${detail.data.item.stackSize}`}
                  {detail.data.item?.fuelValueJ != null && (
                    <span className="inline-flex items-center gap-1">
                      · <Flame className="size-3.5" /> {fmtJ(detail.data.item.fuelValueJ)} (
                      {detail.data.item.fuelCategory})
                    </span>
                  )}
                  {detail.data.fluid?.fuelValueJ != null && (
                    <span className="inline-flex items-center gap-1">
                      · <Flame className="size-3.5" /> {fmtJ(detail.data.fluid.fuelValueJ)}/unit
                    </span>
                  )}
                  {detail.data.item?.burntResult && ` · burns to ${detail.data.item.burntResult}`}
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-auto gap-1 px-1 py-0 font-normal text-info hover:text-info"
                  >
                    <Link to="/deps" search={{ sel: detail.data.name }}>
                      <Network className="size-3.5" /> dependencies
                    </Link>
                  </Button>
                </div>
              </div>
            </div>

            {!detail.data.flowComputed &&
              detail.data.producedBy.length + detail.data.consumedBy.length > 0 && (
                <FlowStaleCallout />
              )}
            {detail.data.producedBy.length + detail.data.consumedBy.length > 0 && (
              <FilterInput
                value={recipeQuery}
                onValueChange={setRecipeQuery}
                placeholder="filter recipes…"
                className="mb-4 max-w-sm"
              />
            )}
            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
              <RecipeList
                title={`Produced by (${detail.data.producedBy.length})`}
                cards={detail.data.producedBy}
                focus={detail.data.name}
                emptyText="nothing makes this — a raw input"
                query={recipeQuery}
                onClearQuery={() => setRecipeQuery("")}
                onPick={open}
              />
              <RecipeList
                title={`Consumed by (${detail.data.consumedBy.length})`}
                cards={detail.data.consumedBy}
                focus={detail.data.name}
                emptyText="no consumers"
                query={recipeQuery}
                onClearQuery={() => setRecipeQuery("")}
                onPick={open}
              />
            </div>
          </>
        )}
      </div>
    </SidebarShell>
  );
}

const fmtJ = (j: number) =>
  j >= 1e9
    ? `${(j / 1e9).toFixed(1)} GJ`
    : j >= 1e6
      ? `${(j / 1e6).toFixed(1)} MJ`
      : `${(j / 1e3).toFixed(0)} kJ`;
