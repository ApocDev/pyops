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

/** The and/or caption over a node's expanded children — a good is made by ANY
 * one producer, a recipe needs ALL its ingredients. */
export function depsGroupLabel(node: DepsNode, dir: DepsDir): string {
  const n = node.childCount;
  const s = n === 1 ? "" : "s";
  if (dir === "requires")
    return node.type === "good"
      ? `made by any of ${n} recipe${s}`
      : `needs all ${n} ingredient${s}`;
  return node.type === "good" ? `used by ${n} recipe${s}` : `makes ${n} good${s}`;
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
        <span
          className={`inline-flex min-w-0 items-center gap-1 text-sm ${blocked ? "text-destructive" : "text-surplus"}`}
          title={
            blocked
              ? `blocked: a different TURD choice on ${turd.masterDisplay ?? turd.master ?? "this master"} is selected`
              : `requires the TURD choice ${turd.choice ?? ""} — pick it on the TURD page`
          }
        >
          <FlaskConical className="size-3.5 shrink-0" />
          <span className="max-w-40 truncate">{turd.choice ?? "TURD"}</span>
        </span>
      );
    }
    if (node.avail.research === "needs-research") {
      return (
        <span
          className="inline-flex min-w-0 items-center gap-1 text-sm text-warning"
          title={`needs research: ${node.unlockedBy?.join(" / ") || "unknown tech"}${
            node.avail.needs.length ? ` — gated on ${node.avail.needs.join(", ")}` : ""
          }`}
        >
          <Lock className="size-3.5 shrink-0" />
          <span className="max-w-40 truncate">{node.unlockedBy?.[0] ?? "locked"}</span>
        </span>
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
          <span className="shrink-0 text-sm text-info" title="already on this branch — a loop">
            cycle
          </span>
        )}
        {!isCycle && node.type === "good" && dir === "requires" && node.childCount === 0 && (
          <span className="shrink-0 text-sm text-info" title="no recipe makes this">
            raw
          </span>
        )}
        {availBadge}
        {!isCycle && closure && (
          <span
            className="hidden shrink-0 text-sm text-muted-foreground sm:inline"
            title={`${dir === "requires" ? "requires" : "required by"} ${closure} in total`}
          >
            {closure}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onExplore(node)}
          title="explore from here — make this the root"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <Crosshair />
        </Button>
        {node.type === "good" && (
          <Button
            asChild
            variant="ghost"
            size="icon-xs"
            title="open in browse"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Link to="/browse" search={{ sel: node.name }}>
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
