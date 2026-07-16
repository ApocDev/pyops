import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  Blocks,
  Check,
  CircleDot,
  Factory,
  Gamepad2,
  Github,
  Hammer,
  ListChecks,
  Search,
  Sparkles,
} from "lucide-react";

import { bridgeStatusSubscription } from "../lib/live-query-options";
import {
  dismissHomeActionFn,
  dataStatusFn,
  factoryTotalsFn,
  homeActionContextFn,
  listBlocksFn,
  modDriftFn,
  restoreHomeActionsFn,
} from "../server/factorio";
import { NextActionCard } from "#/components/home/next-action-card.tsx";
import { LaunchFactorioButton } from "#/components/launch-factorio-button.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { QueryError } from "#/components/query-error.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import {
  activeHomeActionKeys,
  chooseHomeAction,
  factoryDeficits,
  homeActionKey,
  liveDrains,
  type HomeActionInput,
} from "../lib/home-actions.ts";

export const Route = createFileRoute("/")({ component: Home });

const BRIDGE_FRESH_MS = 6000;

function Home() {
  const queryClient = useQueryClient();
  const data = useQuery({ queryKey: ["dataStatus"], queryFn: () => dataStatusFn() });
  const blocks = useQuery({ queryKey: ["blocks"], queryFn: () => listBlocksFn() });
  const totals = useQuery({ queryKey: ["factoryTotals"], queryFn: () => factoryTotalsFn() });
  const actionContext = useQuery({
    queryKey: ["homeActionContext"],
    queryFn: () => homeActionContextFn(),
    refetchInterval: 4000,
  });
  const drift = useQuery({ queryKey: ["modDrift"], queryFn: () => modDriftFn() });
  const bridge = useQuery(bridgeStatusSubscription);

  const failed = [data, blocks, totals, actionContext, drift, bridge].some(
    (query) => query.isError,
  );
  const loading = [data, blocks, totals].some((query) => query.isPending);
  const actionLoading = actionContext.isPending || drift.isPending;
  const dataReady = (data.data?.stats.recipes ?? 0) > 0;
  const blockRows = blocks.data ?? [];
  const blockErrors = blockRows.filter((block) => block.health === "error");
  const blockWarnings = blockRows.filter((block) => block.health === "warn");
  const deficits = factoryDeficits(
    totals.data ?? [],
    actionContext.data?.deficitAvailability ?? [],
  );
  const actionableDeficits = deficits.filter((row) => row.state === "actionable");
  const waitingDeficits = deficits.filter((row) => row.state === "waiting");
  const externalDeficits = deficits.filter((row) => row.state === "external");
  const drains = liveDrains(
    actionContext.data?.production ?? [],
    actionContext.data?.statsSyncedAt ?? null,
  );
  const haveBuiltSync = actionContext.data?.builtSyncedAt != null;
  const buildRows = haveBuiltSync ? (actionContext.data?.build ?? []) : [];
  const unbuiltCount = buildRows.filter((block) => block.phase === "unbuilt").length;
  const partialCount = buildRows.filter((block) => block.phase === "partial").length;
  const scaleCount = buildRows.filter((block) => block.phase === "scale").length;
  const peer = bridge.data?.lastPeer ?? null;
  const gameLinked = peer != null && Date.now() - peer.lastSeenMs < BRIDGE_FRESH_MS;
  const recentBlocks = [...blockRows]
    .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
    .slice(0, 4);
  const needsSetup = !dataReady || blockRows.length === 0;
  const actionInput: HomeActionInput = {
    needsRedump: drift.data?.needsRedump ?? false,
    drains,
    builds: buildRows,
    deficits,
    unhealthy: [...blockErrors, ...blockWarnings].map((block) => ({
      id: block.id,
      name: block.name,
      health: block.health === "error" ? ("error" as const) : ("warn" as const),
    })),
    dismissed: actionContext.data?.dismissedActions ?? [],
  };
  const nextAction = chooseHomeAction(actionInput);
  const nextActionKey = homeActionKey(nextAction);
  const activeKeys = new Set(activeHomeActionKeys(actionInput));
  const dismissedCount = (actionContext.data?.dismissedActions ?? []).filter((key) =>
    activeKeys.has(key),
  ).length;
  const dismissAction = useMutation({
    mutationFn: (key: string) => dismissHomeActionFn({ data: key }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["homeActionContext"] }),
  });
  const restoreActions = useMutation({
    mutationFn: () => restoreHomeActionsFn(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["homeActionContext"] }),
  });

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
        actions={
          <>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <a
                href="https://apocdev.github.io/pyops/"
                target="_blank"
                rel="noreferrer"
                title="Read the PyOps documentation"
              >
                <BookOpen /> Docs
              </a>
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <a
                href="https://github.com/ApocDev/pyops"
                target="_blank"
                rel="noreferrer"
                title="View PyOps on GitHub"
              >
                <Github /> GitHub
              </a>
            </Button>
            <LaunchFactorioButton size="sm" />
          </>
        }
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
              actionContext.refetch(),
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
      ) : actionLoading ? (
        <Skeleton className="h-36 w-full" />
      ) : (
        <NextActionCard
          action={nextAction}
          canDismiss={nextActionKey != null}
          dismissedCount={dismissedCount}
          pending={dismissAction.isPending || restoreActions.isPending}
          onDismiss={() => {
            if (nextActionKey) dismissAction.mutate(nextActionKey);
          }}
          onRestore={() => restoreActions.mutate()}
        />
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
                  {blockErrors.length + blockWarnings.length > 0 ? (
                    <span className="text-warning">
                      {blockErrors.length + blockWarnings.length} unhealthy
                    </span>
                  ) : (
                    "All healthy"
                  )}
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
                  {actionContext.isPending
                    ? "Checking planning horizon…"
                    : actionableDeficits[0]
                      ? `Ready to plan: ${actionableDeficits[0].display}`
                      : waitingDeficits.length > 0
                        ? `${waitingDeficits.length} waiting on research`
                        : externalDeficits.length > 0
                          ? `${externalDeficits.length} external ${externalDeficits.length === 1 ? "input" : "inputs"}`
                          : "No deficits"}
                </div>
              </div>
            </Card>
            <Card>
              <CardHeader>
                <Hammer className="size-4" /> <CardTitle>Build status</CardTitle>
              </CardHeader>
              <div className="p-3">
                <div className="text-2xl font-semibold">
                  {actionContext.isPending
                    ? "…"
                    : haveBuiltSync
                      ? unbuiltCount + partialCount
                      : "—"}
                </div>
                <div className="text-sm text-muted-foreground">
                  {actionContext.isPending
                    ? "Checking build coverage…"
                    : !haveBuiltSync
                      ? "Connect the game for build coverage"
                      : unbuiltCount + partialCount > 0
                        ? `${unbuiltCount} unbuilt · ${partialCount} partial`
                        : scaleCount > 0
                          ? `${scaleCount} built · scaling optional`
                          : "All planned blocks operational"}
                </div>
              </div>
            </Card>
            <Card>
              <CardHeader>
                <Gamepad2 className="size-4" /> <CardTitle>Project status</CardTitle>
              </CardHeader>
              <div className="space-y-1 p-3 text-sm">
                {drift.isPending ? (
                  <div className="text-muted-foreground">
                    <CircleDot className="mr-1.5 inline size-3" /> Checking game data…
                  </div>
                ) : (
                  <div className={drift.data?.needsRedump ? "text-warning" : "text-success"}>
                    <CircleDot className="mr-1.5 inline size-3" />
                    {drift.data?.needsRedump ? "Game data is stale" : "Game data is current"}
                  </div>
                )}
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
