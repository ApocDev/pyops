import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Crosshair, SquareArrowOutUpRight } from "lucide-react";
import type { DepsNode, DepsTree } from "../../server/deps.ts";
import { Icon } from "../../lib/icons";
import { useFilteredList } from "../../lib/use-filtered-list.ts";
import { Button } from "#/components/ui/button.tsx";
import { FilterEmptyState } from "#/components/filter-empty-state.tsx";
import { RecipeLabel } from "#/components/recipe-label.tsx";

const LIMIT = 100;

/** Flat filtered view of the fetched dependency tree (#87 anatomy): while a
 * filter is typed the nested tree gives way to a ranked list of matching
 * nodes, each with an "explore from here" jump. */
export function DepsFilterResults({
  tree,
  query,
  onClear,
  onExplore,
}: {
  tree: DepsTree;
  query: string;
  onClear: () => void;
  onExplore: (node: DepsNode) => void;
}) {
  const all = useMemo(() => Object.values(tree.nodes).filter((n) => n.key !== tree.root), [tree]);
  const matches = useFilteredList(all, query, {
    display: (n) => n.display,
    internal: (n) => n.name,
  });

  if (matches.length === 0)
    return <FilterEmptyState className="py-6" query={query} onClear={onClear} />;

  return (
    <div className="border border-border bg-card">
      <div className="px-2 py-1.5 text-sm text-muted-foreground">
        {matches.length} of {all.length} fetched node{all.length === 1 ? "" : "s"} match
        {matches.length === 1 ? "es" : ""}
      </div>
      {matches.slice(0, LIMIT).map((n) => (
        <div
          key={n.key}
          className="flex min-w-0 items-center gap-1.5 border-t border-border px-2 py-0.5"
        >
          <Icon
            kind={n.type === "recipe" ? "recipe" : (n.goodKind ?? "item")}
            name={n.name}
            size="sm"
          />
          <RecipeLabel display={n.display ?? n.name} differs={n.differs} className="flex-1" />
          <span className="shrink-0 text-sm text-muted-foreground">
            {n.type === "recipe" ? "recipe" : n.goodKind}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onExplore(n)}
            title="Explore from here — make this the root"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Crosshair />
          </Button>
          {n.type === "good" && (
            <Button
              asChild
              variant="ghost"
              size="icon-xs"
              title="Open in Explore search"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <Link to="/explore" search={{ sel: n.name }}>
                <SquareArrowOutUpRight />
              </Link>
            </Button>
          )}
        </div>
      ))}
      {matches.length > LIMIT && (
        <div className="border-t border-border px-2 py-1.5 text-sm text-muted-foreground">
          +{matches.length - LIMIT} more — narrow the filter
        </div>
      )}
    </div>
  );
}
