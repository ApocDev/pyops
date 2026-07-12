import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Droplet, Hammer, Network } from "lucide-react";
import { depsSearchFn, depsTreeFn } from "../server/deps.ts";
import { IconProvider, Icon } from "../lib/icons";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { FilterEmptyState } from "#/components/filter-empty-state.tsx";
import { FilterInput } from "#/components/filter-input.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";
import { SidebarShell } from "#/components/sidebar-shell.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { DepsTreePane } from "#/components/deps/deps-tree-pane.tsx";

/** The dependency explorer (#100): the transitive requires / required-by tree
 * of a good or recipe. Root + direction live in the URL so every view is
 * linkable and back/forward walks the exploration history. */
export const Route = createFileRoute("/explore_/dependencies")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { sel?: string; kind?: "recipe"; dir?: "requiredBy" } => ({
    ...(typeof s.sel === "string" && s.sel ? { sel: s.sel } : {}),
    ...(s.kind === "recipe" ? { kind: "recipe" as const } : {}),
    ...(s.dir === "requiredBy" ? { dir: "requiredBy" as const } : {}),
  }),
  component: () => (
    <IconProvider>
      <Deps />
    </IconProvider>
  ),
});

function Deps() {
  const { sel, kind, dir } = Route.useSearch();
  const rootKind = kind === "recipe" ? ("recipe" as const) : ("good" as const);
  const direction = dir === "requiredBy" ? ("requiredBy" as const) : ("requires" as const);
  const navigate = useNavigate({ from: "/explore/dependencies" });
  const [query, setQuery] = useState("");
  /** depth in TIERS (one tier = good → recipe → good, i.e. 2 edges) */
  const [depth, setDepth] = useState(3);
  const [treeQuery, setTreeQuery] = useState("");

  const results = useQuery({
    queryKey: ["depsSearch", query],
    queryFn: () => depsSearchFn({ data: query }),
    enabled: query.trim().length > 0,
    placeholderData: keepPreviousData,
  });
  const tree = useQuery({
    queryKey: ["depsTree", sel, rootKind, direction, depth],
    queryFn: () =>
      depsTreeFn({ data: { kind: rootKind, name: sel!, dir: direction, depth: depth * 2 } }),
    enabled: !!sel,
    placeholderData: keepPreviousData,
  });

  const open = (name: string, k: "good" | "recipe", d = direction) =>
    void navigate({
      search: {
        sel: name,
        ...(k === "recipe" ? { kind: "recipe" as const } : {}),
        ...(d === "requiredBy" ? { dir: "requiredBy" as const } : {}),
      },
    });
  // a new root deserves a fresh look — drop any stale in-tree filter
  useEffect(() => setTreeQuery(""), [sel, kind]);

  return (
    <SidebarShell
      className="font-mono text-sm text-foreground"
      width="w-72"
      label="Dependencies"
      sidebar={(close) => (
        <>
          <div className="border-b border-border p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <FieldLabel>Dependencies</FieldLabel>
              <HelpButton title="What is the dependency explorer?">
                <p>
                  Pick any <span className="text-foreground">item, fluid, or recipe</span> and walk
                  its full prerequisite tree: what it{" "}
                  <span className="text-foreground">requires</span> (transitively, down to raw
                  resources) or what is <span className="text-foreground">required by</span> it —
                  everything that breaks without it.
                </p>
                <p>
                  The tree keeps the and/or distinction: a good is made by{" "}
                  <span className="text-foreground">any one</span> of its producer recipes, while a
                  recipe needs <span className="text-foreground">all</span> of its ingredients.
                  Collapsed branches show the size of what&apos;s beneath (&quot;12 goods via 4
                  recipes&quot;); locked recipes are marked with the tech that gates them.
                </p>
                <p>
                  <span className="text-foreground">Worked example.</span> Pick a good and switch to{" "}
                  <span className="text-foreground">required by</span> to ask &quot;what breaks if I
                  can&apos;t make this?&quot; — the tree fans out to every downstream recipe and
                  good that depends on it. Switch to{" "}
                  <span className="text-foreground">requires</span> and you get the opposite: the
                  full shopping list of prerequisites to unlock before that good is buildable. A
                  locked branch shows the gating tech, so you can read a plan straight off the tree.
                </p>
              </HelpButton>
            </div>
            <FilterInput
              value={query}
              onValueChange={setQuery}
              placeholder="search goods & recipes…"
              autoFocus
            />
          </div>
          <div className="flex-1 overflow-auto p-1">
            {query.trim().length === 0 && (
              <div className="px-2 py-2 text-sm text-muted-foreground">
                type to search — pick a good or recipe to explore its dependency tree
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
                  open(r.name, r.kind === "recipe" ? "recipe" : "good");
                  close();
                }}
                className={`h-auto w-full justify-start gap-2 px-2 py-1 font-normal ${
                  sel === r.name && (rootKind === "recipe") === (r.kind === "recipe")
                    ? "bg-accent"
                    : ""
                }`}
                title={r.display ?? r.name}
              >
                <Icon
                  kind={r.kind === "recipe" ? "recipe" : r.kind}
                  name={r.name}
                  size="sm"
                  noTitle
                />
                <span className="min-w-0 flex-1 truncate text-left">{r.display ?? r.name}</span>
                {r.kind === "fluid" && (
                  <span className="text-info" title="fluid">
                    <Droplet className="size-3.5" />
                  </span>
                )}
                {r.kind === "recipe" && (
                  <span className="text-muted-foreground" title="recipe">
                    <Hammer className="size-3.5" />
                  </span>
                )}
              </Button>
            ))}
            {query.trim().length > 0 && results.data?.length === 0 && (
              <FilterEmptyState className="px-2 py-3" query={query} onClear={() => setQuery("")} />
            )}
          </div>
        </>
      )}
    >
      <div className="min-w-0 flex-1 overflow-auto p-4">
        {!sel && (
          <EmptyState
            className="h-full"
            icon={Network}
            title="Nothing selected"
            description="Search on the left and pick a good or recipe to explore what it requires — or what requires it."
          />
        )}
        {sel && tree.isPending && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-12" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-64" />
              </div>
            </div>
            <Skeleton className="h-8 w-full max-w-xl" />
            <div className="flex flex-col gap-1">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-11/12" />
              <Skeleton className="h-7 w-5/6" />
              <Skeleton className="h-7 w-3/4" />
            </div>
          </div>
        )}
        {sel && tree.isError && (
          <Callout tone="destructive">failed to load the dependency tree — try again</Callout>
        )}
        {sel && tree.data === null && (
          <EmptyState
            className="h-full"
            icon={Network}
            title="Not in this dataset"
            description={`"${sel}" isn't a known ${rootKind === "recipe" ? "recipe" : "good"} in the loaded data — search on the left to pick another.`}
          />
        )}
        {tree.data && (
          <DepsTreePane
            tree={tree.data}
            dir={direction}
            depth={depth}
            onDepthChange={setDepth}
            onDirChange={(d) => sel && open(sel, rootKind, d)}
            onExplore={(n) => open(n.name, n.type)}
            filter={treeQuery}
            onFilterChange={setTreeQuery}
          />
        )}
      </div>
    </SidebarShell>
  );
}
