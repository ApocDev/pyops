import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Crosshair, SquareArrowOutUpRight } from "lucide-react";
import type { DepsDir, DepsNode, DepsTree } from "../../server/deps.ts";
import { Icon } from "../../lib/icons";
import { useFilteredList } from "../../lib/use-filtered-list.ts";
import { Button } from "#/components/ui/button.tsx";
import { FilterEmptyState } from "#/components/filter-empty-state.tsx";

const LIMIT = 100;

/** Flat filtered view of the fetched dependency tree (#87 anatomy): while a
 * filter is typed the nested tree gives way to a ranked list of matching
 * nodes, each with its closure size and an "explore from here" jump. */
export function DepsFilterResults({
  tree,
  dir,
  query,
  onClear,
  onExplore,
}: {
  tree: DepsTree;
  dir: DepsDir;
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
          <span className="min-w-0 flex-1 truncate" title={n.display ?? n.name}>
            {n.display ?? n.name}
          </span>
          <span className="shrink-0 text-sm text-muted-foreground">
            {n.type === "recipe" ? "recipe" : n.goodKind}
          </span>
          {n.closure.goods + n.closure.recipes > 0 && (
            <span
              className="hidden shrink-0 text-sm text-muted-foreground sm:inline"
              title={`${dir === "requires" ? "requires" : "required by"} ${n.closure.goods} goods · ${n.closure.recipes} recipes in total`}
            >
              {n.closure.goods} goods · {n.closure.recipes} recipes
            </span>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onExplore(n)}
            title="explore from here — make this the root"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Crosshair />
          </Button>
          {n.type === "good" && (
            <Button
              asChild
              variant="ghost"
              size="icon-xs"
              title="open in browse"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <Link to="/browse" search={{ sel: n.name }}>
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
