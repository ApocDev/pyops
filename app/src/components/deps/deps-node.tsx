import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  Crosshair,
  Ellipsis,
  FlaskConical,
  Lock,
  RefreshCw,
  SquareArrowOutUpRight,
} from "lucide-react";
import type { DepsDir, DepsNode } from "../../server/deps.ts";
import { Icon } from "../../lib/icons";
import { Button } from "#/components/ui/button.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";

/** The and/or caption over a node's expanded children — a good is made by ANY
 * one producer, a recipe needs ALL its ingredients. */
export function depsGroupLabel(node: DepsNode, dir: DepsDir): string {
  const n = node.childCount;
  const s = n === 1 ? "" : "s";
  if (dir === "requires")
    return node.type === "good"
      ? `Made by any of ${n} recipe${s}`
      : `Needs all ${n} ingredient${s}`;
  return node.type === "good" ? `Used by ${n} recipe${s}` : `Makes ${n} good${s}`;
}

/** Compact closure summary for a collapsed branch ("12 goods · 4 recipes"). */
const closureText = (node: DepsNode) =>
  node.closure.goods + node.closure.recipes === 0
    ? null
    : `${node.closure.goods} goods · ${node.closure.recipes} recipes`;

/** One row of the dependency tree, recursing into its children while expanded.
 * A node that reappears below itself (Py loves loops) renders as a cycle
 * marker instead of recursing forever; a node cut off by the depth limit or
 * node budget offers "explore from here" (re-root) instead of a chevron. */
export function DepsNodeRow({
  nodes,
  nodeKey,
  dir,
  level,
  path,
  expanded,
  onToggle,
  onExplore,
}: {
  nodes: Record<string, DepsNode>;
  nodeKey: string;
  dir: DepsDir;
  level: number;
  /** ancestor keys, root first — the cycle guard */
  path: readonly string[];
  expanded: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onExplore: (node: DepsNode) => void;
}) {
  const node = nodes[nodeKey];
  if (!node) return null;
  const isCycle = path.includes(nodeKey);
  const expandable = !isCycle && node.children.length > 0;
  /** beyond the fetched depth/budget: nothing to unfold — re-root instead */
  const frontier = !isCycle && !expandable && node.truncated;
  const open = expandable && expanded.has(nodeKey);
  const indent = 8 + Math.min(level, 8) * 16;
  const closure = closureText(node);

  const lead = expandable ? (
    open ? (
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
    ) : (
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
    )
  ) : frontier ? (
    <Ellipsis className="size-3.5 shrink-0 text-muted-foreground" />
  ) : isCycle ? (
    <RefreshCw className="size-3.5 shrink-0 text-info" />
  ) : (
    <span className="size-3.5 shrink-0" />
  );
  const body = (
    <>
      {lead}
      <Icon
        kind={node.type === "recipe" ? "recipe" : (node.goodKind ?? "item")}
        name={node.name}
        size="sm"
      />
      <span className="min-w-0 truncate text-left">{node.display ?? node.name}</span>
    </>
  );

  // availability coloring (recipes): locked-behind-research or a TURD choice
  const availBadge = (() => {
    if (node.type !== "recipe" || !node.avail) return null;
    const turd = node.avail.turd;
    if (turd && turd.state !== "active") {
      const blocked = turd.state === "blocked";
      return (
        <Tooltip
          content={
            blocked
              ? `Blocked: a different TURD choice on ${turd.masterDisplay ?? turd.master ?? "this master"} is selected`
              : `Requires the TURD choice ${turd.choice ?? ""} — pick it on the TURD page`
          }
        >
          <span
            className={`inline-flex min-w-0 items-center gap-1 text-sm ${blocked ? "text-destructive" : "text-surplus"}`}
          >
            <FlaskConical className="size-3.5 shrink-0" />
            <span className="max-w-40 truncate">{turd.choice ?? "TURD"}</span>
          </span>
        </Tooltip>
      );
    }
    if (node.avail.research === "needs-research") {
      return (
        <Tooltip
          content={`Needs research: ${node.unlockedBy?.join(" / ") || "unknown tech"}${
            node.avail.needs.length ? ` — gated on ${node.avail.needs.join(", ")}` : ""
          }`}
        >
          <span className="inline-flex min-w-0 items-center gap-1 text-sm text-warning">
            <Lock className="size-3.5 shrink-0" />
            <span className="max-w-40 truncate">{node.unlockedBy?.[0] ?? "locked"}</span>
          </span>
        </Tooltip>
      );
    }
    return null;
  })();

  return (
    <>
      <div
        className="flex min-w-0 items-center gap-1.5 border-t border-border py-0.5 pr-1"
        style={{ paddingLeft: indent }}
      >
        {expandable || frontier ? (
          <Button
            variant="ghost"
            onClick={() => (expandable ? onToggle(nodeKey) : onExplore(node))}
            className="h-auto min-w-0 flex-1 justify-start gap-1.5 px-1 py-1 font-normal"
            title={
              frontier
                ? `${node.display ?? node.name} — beyond the fetched depth, click to explore from here`
                : (node.display ?? node.name)
            }
          >
            {body}
          </Button>
        ) : (
          <span
            className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-1"
            title={node.display ?? node.name}
          >
            {body}
          </span>
        )}
        {isCycle && (
          <Tooltip content="Already on this branch — a loop">
            <span className="shrink-0 text-sm text-info">Cycle</span>
          </Tooltip>
        )}
        {!isCycle && node.type === "good" && dir === "requires" && node.childCount === 0 && (
          <Tooltip content="No recipe makes this">
            <span className="shrink-0 text-sm text-info">Raw</span>
          </Tooltip>
        )}
        {availBadge}
        {!isCycle && closure && (
          <Tooltip
            content={`${dir === "requires" ? "Requires" : "Required by"} ${closure} in total`}
          >
            <span className="hidden shrink-0 text-sm text-muted-foreground sm:inline">
              {closure}
            </span>
          </Tooltip>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onExplore(node)}
          title="Explore from here — make this the root"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <Crosshair />
        </Button>
        {node.type === "good" && (
          <Button
            asChild
            variant="ghost"
            size="icon-xs"
            title="Open in Explore search"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Link to="/explore" search={{ sel: node.name }}>
              <SquareArrowOutUpRight />
            </Link>
          </Button>
        )}
      </div>
      {open && (
        <>
          <div
            className="border-t border-border py-1 text-sm text-muted-foreground"
            style={{ paddingLeft: indent + 24 }}
          >
            {depsGroupLabel(node, dir)}
          </div>
          {node.children.map((key) => (
            <DepsNodeRow
              key={key}
              nodes={nodes}
              nodeKey={key}
              dir={dir}
              level={level + 1}
              path={[...path, nodeKey]}
              expanded={expanded}
              onToggle={onToggle}
              onExplore={onExplore}
            />
          ))}
          {node.truncated && (
            <div
              className="flex items-center border-t border-border py-0.5"
              style={{ paddingLeft: indent + 24 }}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onExplore(node)}
                className="h-auto px-1 py-1 font-normal text-info hover:text-info"
              >
                {node.childCount - node.children.length} more beyond the fetched depth — explore
                from here
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
