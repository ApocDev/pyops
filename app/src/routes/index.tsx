import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Blocks,
  Check,
  CircleDot,
  Factory,
  Gamepad2,
  Hammer,
  ListChecks,
  Search,
  Sparkles,
} from "lucide-react";

import { bridgeStatusSubscription } from "../lib/live-query-options";
import {
  dataStatusFn,
  factoryTotalsFn,
  listBlocksFn,
  machineSufficiencyFn,
  modDriftFn,
} from "../server/factorio";
import { LaunchFactorioButton } from "#/components/launch-factorio-button.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { QueryError } from "#/components/query-error.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";

export const Route = createFileRoute("/")({ component: Home });

const BRIDGE_FRESH_MS = 6000;

function Home() {
  const data = useQuery({ queryKey: ["dataStatus"], queryFn: () => dataStatusFn() });
  const blocks = useQuery({ queryKey: ["blocks"], queryFn: () => listBlocksFn() });
  const totals = useQuery({ queryKey: ["factoryTotals"], queryFn: () => factoryTotalsFn() });
  const machines = useQuery({
    queryKey: ["machineSufficiency"],
    queryFn: () => machineSufficiencyFn(),
  });
  const drift = useQuery({ queryKey: ["modDrift"], queryFn: () => modDriftFn() });
  const bridge = useQuery(bridgeStatusSubscription);

  const failed = [data, blocks, totals, machines, drift, bridge].some((query) => query.isError);
  // Project data is enough to choose the next action. Slower live-game and
  // filesystem checks fill into their own cards without blocking the page.
  const loading = [data, blocks, totals].some((query) => query.isPending);
  const dataReady = (data.data?.stats.recipes ?? 0) > 0;
  const blockRows = blocks.data ?? [];
  const blockErrors = blockRows.filter((block) => block.health === "error");
  const blockWarnings = blockRows.filter((block) => block.health === "warn");

  const byGood = new Map<
    string,
    { display: string; produced: number; consumed: number; kind: string }
  >();
  for (const flow of totals.data ?? []) {
    const row = byGood.get(flow.item) ?? {
      display: flow.display ?? flow.item,
      produced: 0,
      consumed: 0,
      kind: flow.kind,
    };
    if (flow.role === "import") row.consumed += flow.rate;
    else row.produced += flow.rate;
    byGood.set(flow.item, row);
  }
  const deficits = [...byGood.entries()]
    .map(([item, row]) => ({
      item,
      ...row,
      net: row.produced - row.consumed,
      pctMet: row.consumed > 1e-9 ? row.produced / row.consumed : 1,
    }))
    .filter(
      (row) =>
        row.net < 0 &&
        Math.abs(row.net) > Math.max(1e-6, 1e-2 * Math.max(row.produced, row.consumed)),
    )
    .sort((a, b) => a.pctMet - b.pctMet || a.net - b.net);
  const nextDeficit = deficits[0] ?? null;
  const machineShort = (machines.data?.machines ?? []).reduce(
    (sum, machine) => sum + machine.short,
    0,
  );
  const haveBuiltSync = machines.data?.syncedAt != null;
  const peer = bridge.data?.lastPeer ?? null;
  const gameLinked = peer != null && Date.now() - peer.lastSeenMs < BRIDGE_FRESH_MS;
  const recentBlocks = [...blockRows]
    .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
    .slice(0, 4);
  const needsSetup = !dataReady || blockRows.length === 0;
  const nextProblemBlock = blockErrors[0] ?? blockWarnings[0] ?? null;

  return (
    <div className="mx-auto max-w-6xl p-4 font-mono text-foreground">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <img src="/logo.svg" alt="" className="size-8 shrink-0" />
            PyOps
          </span>
        }
        description="Plan the next factory change, then keep the running build on target."
        actions={<LaunchFactorioButton size="sm" />}
      />

      {failed && (
        <QueryError
          title="Couldn’t load the factory command center"
          message="Some project status is unavailable. Retry the summary queries."
          onRetry={() => {
            void Promise.all([
              data.refetch(),
              blocks.refetch(),
              totals.refetch(),
              machines.refetch(),
              drift.refetch(),
              bridge.refetch(),
            ]);
          }}
          className="mb-4"
        />
      )}

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-36 w-full" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        </div>
      ) : needsSetup ? (
        <Card>
          <CardHeader>
            <CardTitle>Get this project ready</CardTitle>
          </CardHeader>
          <div className="grid gap-0 divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
            <div className="flex gap-3 p-4">
              <span className="flex size-7 shrink-0 items-center justify-center border border-border text-sm">
                {dataReady ? <Check className="size-4 text-success" /> : "1"}
              </span>
              <div className="space-y-2">
                <div className="font-semibold">Sync game data</div>
                <p className="text-sm text-muted-foreground">
                  Load the recipes, machines, technologies, and icons from your Factorio mod set.
                </p>
                <Button asChild size="sm" variant={dataReady ? "outline" : "default"}>
                  <Link to="/settings" search={{ tab: "data" }}>
                    {dataReady ? "Review game data" : "Sync game data"}
                  </Link>
                </Button>
              </div>
            </div>
            <div className="flex gap-3 p-4">
              <span className="flex size-7 shrink-0 items-center justify-center border border-border text-sm">
                {blockRows.length > 0 ? <Check className="size-4 text-success" /> : "2"}
              </span>
              <div className="space-y-2">
                <div className="font-semibold">Create a production block</div>
                <p className="text-sm text-muted-foreground">
                  Set an output goal, choose its recipes and machines, and solve the first chain.
                </p>
                <Button asChild size="sm" variant={dataReady ? "default" : "outline"}>
                  <Link to="/block">Create your first block</Link>
                </Button>
              </div>
            </div>
            <div className="flex gap-3 p-4">
              <span className="flex size-7 shrink-0 items-center justify-center border border-border text-sm">
                3
              </span>
              <div className="space-y-2">
                <div className="font-semibold">Choose what comes next</div>
                <p className="text-sm text-muted-foreground">
                  Use Factory to turn the first block’s imports into the next planning decisions.
                </p>
                <Button asChild size="sm" variant="outline">
                  <Link to="/factory">Open Factory</Link>
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-primary">Next action</CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              {nextProblemBlock ? (
                <>
                  <div className="flex items-center gap-2 text-lg font-semibold">
                    <AlertTriangle
                      className={`size-5 ${nextProblemBlock.health === "error" ? "text-destructive" : "text-warning"}`}
                    />
                    {nextProblemBlock.health === "error" ? "Repair" : "Finish"}{" "}
                    {nextProblemBlock.name}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {nextProblemBlock.health === "error"
                      ? "This block is broken or infeasible, so its plan needs attention before expanding the factory."
                      : "This block is stale, incomplete, or not cleanly solved yet."}
                  </p>
                </>
              ) : nextDeficit ? (
                <>
                  <div className="flex items-center gap-2 text-lg font-semibold">
                    <Factory className="size-5 text-destructive" /> Plan {nextDeficit.display}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The factory is short{" "}
                    {Math.abs(nextDeficit.net).toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}
                    /s. Review the deficit and choose its producer block.
                  </p>
                </>
              ) : machineShort > 0 && haveBuiltSync ? (
                <>
                  <div className="flex items-center gap-2 text-lg font-semibold">
                    <Hammer className="size-5 text-warning" /> Place {machineShort} missing machine
                    {machineShort === 1 ? "" : "s"}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The production plan balances, but the connected save is still under-built.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-lg font-semibold">
                    <Check className="size-5 text-success" /> Factory plan balanced
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try a new output target or start the next production block.
                  </p>
                </>
              )}
            </div>
            {nextProblemBlock ? (
              <Button asChild>
                <Link to="/block/$id" params={{ id: String(nextProblemBlock.id) }}>
                  Open block <ArrowRight />
                </Link>
              </Button>
            ) : nextDeficit || (machineShort > 0 && haveBuiltSync) ? (
              <Button asChild>
                <Link to="/factory">
                  Open Factory <ArrowRight />
                </Link>
              </Button>
            ) : (
              <Button asChild>
                <Link to="/factory/scenario">
                  Try a scenario <ArrowRight />
                </Link>
              </Button>
            )}
          </div>
        </Card>
      )}

      {!needsSetup && !loading && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader>
                <Blocks className="size-4" /> <CardTitle>Blocks</CardTitle>
              </CardHeader>
              <div className="p-3">
                <div className="text-2xl font-semibold">{blockRows.length}</div>
                <div className="text-sm text-muted-foreground">
                  {blockErrors.length > 0 && (
                    <span className="text-destructive">{blockErrors.length} broken</span>
                  )}
                  {blockErrors.length > 0 && blockWarnings.length > 0 && " · "}
                  {blockWarnings.length > 0 && (
                    <span className="text-warning">{blockWarnings.length} need attention</span>
                  )}
                  {blockErrors.length === 0 && blockWarnings.length === 0 && "All healthy"}
                </div>
              </div>
            </Card>
            <Card>
              <CardHeader>
                <Factory className="size-4" /> <CardTitle>Factory balance</CardTitle>
              </CardHeader>
              <div className="p-3">
                <div className="text-2xl font-semibold">{deficits.length}</div>
                <div className="truncate text-sm text-muted-foreground">
                  {nextDeficit ? `Most urgent: ${nextDeficit.display}` : "No actionable deficits"}
                </div>
              </div>
            </Card>
            <Card>
              <CardHeader>
                <Hammer className="size-4" /> <CardTitle>Build status</CardTitle>
              </CardHeader>
              <div className="p-3">
                <div className="text-2xl font-semibold">{haveBuiltSync ? machineShort : "—"}</div>
                <div className="text-sm text-muted-foreground">
                  {haveBuiltSync ? "Machines still to place" : "Connect the game for built counts"}
                </div>
              </div>
            </Card>
            <Card>
              <CardHeader>
                <Gamepad2 className="size-4" /> <CardTitle>Project status</CardTitle>
              </CardHeader>
              <div className="space-y-1 p-3 text-sm">
                <div className={drift.data?.needsRedump ? "text-warning" : "text-success"}>
                  <CircleDot className="mr-1.5 inline size-3" />
                  {drift.data?.needsRedump ? "Game data is stale" : "Game data is current"}
                </div>
                <div className={gameLinked ? "text-success" : "text-muted-foreground"}>
                  <CircleDot className="mr-1.5 inline size-3" />
                  {gameLinked
                    ? `Game linked${peer?.player ? ` · ${peer.player}` : ""}`
                    : "No game linked"}
                </div>
              </div>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="justify-between">
                <CardTitle>Recent blocks</CardTitle>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/block">All blocks</Link>
                </Button>
              </CardHeader>
              <div className="divide-y divide-border">
                {recentBlocks.map((block) => (
                  <Link
                    key={block.id}
                    to="/block/$id"
                    params={{ id: String(block.id) }}
                    className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50"
                  >
                    <span
                      className={`size-2 shrink-0 rounded-full ${
                        block.health === "error"
                          ? "bg-destructive"
                          : block.health === "warn"
                            ? "bg-warning"
                            : "bg-success"
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate font-semibold">{block.name}</span>
                    <span className="text-muted-foreground">
                      {block.goalCount} goal{block.goalCount === 1 ? "" : "s"} · {block.recipeCount}{" "}
                      recipe{block.recipeCount === 1 ? "" : "s"}
                    </span>
                    <ArrowRight className="size-3.5 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Keep planning</CardTitle>
              </CardHeader>
              <div className="grid grid-cols-2 gap-px bg-border">
                {[
                  { to: "/explore" as const, label: "Explore", icon: Search },
                  { to: "/assistant" as const, label: "Assistant", icon: Sparkles },
                  { to: "/tasks" as const, label: "Tasks", icon: ListChecks },
                  { to: "/block" as const, label: "Blocks", icon: Blocks },
                ].map(({ to, label, icon: Icon }) => (
                  <Link
                    key={to}
                    to={to}
                    className="flex min-h-20 flex-col items-center justify-center gap-2 bg-card p-3 text-sm hover:bg-muted/50"
                  >
                    <Icon className="size-5 text-primary" /> {label}
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
