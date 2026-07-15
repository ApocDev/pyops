import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { SquareArrowOutUpRight } from "lucide-react";
import type { DepsDir, DepsNode, DepsTree } from "../../server/deps.ts";
import { Icon } from "../../lib/icons";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Segmented } from "#/components/ui/segmented.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { FilterInput } from "#/components/filter-input.tsx";
import { DepsFilterResults } from "./deps-filter-results.tsx";
import { DepsNodeRow, depsGroupLabel } from "./deps-node.tsx";

/** One loaded dependency tree: root header, direction/depth toolbar, and the
 * expandable node rows (or the flat filtered view while a filter is typed). */
export function DepsTreePane({
  tree,
  dir,
  depth,
  onDepthChange,
  onDirChange,
  onExplore,
  filter,
  onFilterChange,
}: {
  tree: DepsTree;
  dir: DepsDir;
  /** depth in tiers (one tier = good → recipe → good) */
  depth: number;
  onDepthChange: (tiers: number) => void;
  onDirChange: (dir: DepsDir) => void;
  /** re-root the explorer on a node */
  onExplore: (node: DepsNode) => void;
  filter: string;
  onFilterChange: (q: string) => void;
}) {
  const root = tree.nodes[tree.root];
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => setExpanded(new Set()), [tree.root, dir]);
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const fetched = useMemo(() => Object.keys(tree.nodes).length, [tree.nodes]);
  const summary =
    dir === "requires"
      ? `Requires ${root.closure.goods} goods via ${root.closure.recipes} recipes`
      : `Required by ${root.closure.recipes} recipes touching ${root.closure.goods} goods`;

  return (
    <div className="flex flex-col gap-4">
      {/* root header */}
      <div className="flex items-center gap-3">
        <Icon
          kind={root.type === "recipe" ? "recipe" : (root.goodKind ?? "item")}
          name={root.name}
          size="lg"
          noTitle
        />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {root.display ?? root.name}
          </h1>
          <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span>
              {root.name} · {root.type === "recipe" ? "recipe" : (root.goodKind ?? "item")}
            </span>
            <span>· {summary}</span>
            {root.type === "good" && (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-auto gap-1 px-1 py-0 font-normal text-info hover:text-info"
              >
                <Link to="/explore" search={{ sel: root.name }}>
                  <SquareArrowOutUpRight className="size-3.5" /> Open in Search
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* toolbar: direction, depth, in-tree filter */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          aria-label="Dependency direction"
          size="sm"
          value={dir}
          onValueChange={onDirChange}
          options={[
            { value: "requires", label: "Requires" },
            { value: "requiredBy", label: "Required by" },
          ]}
        />
        <Select value={String(depth)} onValueChange={(v) => onDepthChange(Number(v))}>
          <SelectTrigger className="h-8 w-32" aria-label="Tree depth">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5, 6].map((d) => (
              <SelectItem key={d} value={String(d)}>
                Depth {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FilterInput
          value={filter}
          onValueChange={onFilterChange}
          placeholder="Filter tree…"
          className="min-w-40 grow sm:ml-auto sm:max-w-64 sm:grow-0"
        />
      </div>

      {tree.budgetHit && (
        <Callout tone="info" variant="strip">
          Large graph — the tree is capped at {fetched} nodes; use “explore from here” on a branch
          to dig deeper
        </Callout>
      )}

      {filter.trim() ? (
        <DepsFilterResults
          tree={tree}
          dir={dir}
          query={filter}
          onClear={() => onFilterChange("")}
          onExplore={onExplore}
        />
      ) : (
        <div className="border border-border bg-card">
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            {depsGroupLabel(root, dir)}
          </div>
          {root.children.map((key) => (
            <DepsNodeRow
              key={key}
              nodes={tree.nodes}
              nodeKey={key}
              dir={dir}
              level={0}
              path={[tree.root]}
              expanded={expanded}
              onToggle={toggle}
              onExplore={onExplore}
            />
          ))}
          {root.childCount === 0 && (
            <div className="border-t border-border px-2 py-2 text-muted-foreground">
              {dir === "requires"
                ? root.type === "recipe"
                  ? "No ingredients — free to run"
                  : "Nothing makes this — a raw input"
                : root.type === "recipe"
                  ? "Makes nothing — a pure sink"
                  : "Nothing uses this"}
            </div>
          )}
          {root.truncated && (
            <div className="border-t border-border px-2 py-1.5 text-sm text-muted-foreground">
              {root.childCount - root.children.length} more not fetched — raise the depth
            </div>
          )}
        </div>
      )}
    </div>
  );
}
