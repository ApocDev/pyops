import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  factoryScenarioProgressFn,
  factoryScenarioSnapshotFn,
  factoryWhatIfFn,
} from "../server/factorio";
import { Icon, IconProvider } from "../lib/icons";
import { ItemHover } from "../lib/recipe-card";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";
import { InfoHint } from "#/components/info-hint.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { RebalanceAllButton } from "#/components/whatif/rebalance-all-button.tsx";
import { StatCell } from "#/components/stat-cell.tsx";
import { StatTableHeader } from "#/components/stat-table.tsx";
import { SupplyAllocationCard } from "#/components/whatif/supply-allocation-card.tsx";
import { FactoryPinsCard } from "#/components/whatif/factory-pins-card.tsx";
import { ScenarioValidationCard } from "#/components/whatif/scenario-validation-card.tsx";
import { ScenarioStatusBar } from "#/components/whatif/scenario-status-bar.tsx";

export const Route = createFileRoute("/factory_/scenario")({
  component: () => (
    <IconProvider>
      <WhatIf />
    </IconProvider>
  ),
});

import { rateLabel } from "../lib/format";

/** Factory what-if: solve every enabled block goal from a small set of signed
 * whole-factory pins. */
function WhatIf() {
  const qc = useQueryClient();
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [calculatedOverrideKey, setCalculatedOverrideKey] = useState("{}");
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const autoCalculateStarted = useRef(false);
  const overrideKey = (values: Record<string, number>) =>
    JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
  const draftOverrideKey = useMemo(() => overrideKey(overrides), [overrides]);
  const snapshot = useQuery({
    queryKey: ["factoryScenarioSnapshot"],
    queryFn: () => factoryScenarioSnapshotFn(),
  });
  const calculate = useMutation({
    mutationFn: (variables: { demands: Record<string, number>; requestId: string }) =>
      factoryWhatIfFn({ data: variables }),
    onSuccess: (next, variables) => {
      qc.setQueryData(["factoryScenarioSnapshot"], next);
      void qc.invalidateQueries({ queryKey: ["factoryPins"] });
      setCalculatedOverrideKey(overrideKey(variables.demands));
    },
    onSettled: () => setActiveRequestId(null),
  });
  const progress = useQuery({
    queryKey: ["factoryScenarioProgress", activeRequestId],
    queryFn: () => factoryScenarioProgressFn({ data: activeRequestId! }),
    enabled: activeRequestId != null,
    refetchInterval: activeRequestId != null ? 250 : false,
  });
  const recalculate = (demands = overrides) => {
    if (calculate.isPending) return;
    const requestId = globalThis.crypto.randomUUID();
    setActiveRequestId(requestId);
    calculate.mutate({ demands, requestId });
  };
  useEffect(() => {
    if (snapshot.data?.state !== "empty" || autoCalculateStarted.current) return;
    autoCalculateStarted.current = true;
    recalculate({});
    // Initial empty-cache calculation runs once; later stale results wait for
    // an explicit click so route visits never hide expensive background work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.data?.state]);

  const r = snapshot.data?.result;
  const dirty = snapshot.data?.state !== "current" || draftOverrideKey !== calculatedOverrideKey;
  const changed = (r?.goalChanges ?? []).map((goal) => ({ ...goal, name: goal.display }));

  return (
    <div
      className="mx-auto max-w-[100rem] p-4 font-mono text-foreground"
      data-testid="scenario-workspace"
    >
      <PageHeader
        title="Scenario"
        actions={
          <>
            {Object.keys(overrides).length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setOverrides({})}>
                Reset to current
              </Button>
            )}
            {r && r.status !== "Optimal" && (
              <span className="text-sm text-warning">
                Solve: {r.status === "ValidationFailed" ? "Validation failed" : r.status}
              </span>
            )}
            <HelpButton title="What is Scenario?">
              <p>
                Scenario solves your{" "}
                <span className="text-foreground">whole factory as one system</span>. Pin the goods
                that define its desired output or consumption, and it calculates every other block
                goal.
              </p>
              <p>
                <span className="text-foreground">vs Overview.</span> Overview shows your factory as
                it is now; Scenario is a sandbox — it doesn&apos;t change anything until you open a
                block, select <span className="text-foreground">Balance factory</span>, or apply an
                edited scenario.
              </p>
              <div>
                <div className="font-semibold text-foreground">How to use it</div>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  <li>
                    <span className="text-foreground">Factory pins</span> — the only fixed
                    whole-factory targets. Use a positive rate for production or a negative rate for
                    deliberate consumption.
                  </li>
                  <li>
                    <span className="text-foreground">Goal changes</span> — your work list: each
                    affected good&apos;s current and next block goal, total factory use, actual
                    block output, and remaining surplus. The block name shows where that goal lives;
                    click the row to open it.
                  </li>
                  <li>
                    <span className="text-foreground">Supply priority</span> — when several blocks
                    can supply the same good, Preferred blocks are used before Normal blocks, and
                    Fallback blocks fill what remains. Set a block&apos;s priority from the icon
                    beside its Goal heading.
                  </li>
                  <li>
                    <span className="text-foreground">Raw inputs</span> — what the new target draws
                    in from outside (current vs projected), including a required good no enabled
                    block can currently supply.
                  </li>
                  <li>
                    <span className="text-foreground">Overproduced</span> — anything the target
                    would pile up that still needs a consumer.
                  </li>
                </ul>
              </div>
              <div>
                <div className="font-semibold text-foreground">Supply priority</div>
                <p className="mt-1">
                  Priority chooses between competing suppliers; it does not replace block goals or
                  constraints. A block is never scaled solely to manufacture an incidental
                  byproduct. In Advanced supply priorities mode, numeric tiers are allowed and an
                  individual export can override its block&apos;s priority; otherwise every export
                  inherits the block setting.
                </p>
              </div>
              <div>
                <div className="font-semibold text-foreground">Worked example</div>
                <p className="mt-1">
                  Say your automation-science block currently runs at{" "}
                  <span className="text-foreground">0.5/s</span> and you want{" "}
                  <span className="text-foreground">1/s</span>. Set its target to 1 and the cascade
                  updates: <span className="text-foreground">Goal changes</span> lists that good at
                  <span className="text-foreground">1/s next goal</span>, plus every upstream goal
                  that feeds it; <span className="text-foreground">Raw inputs</span> shows the new
                  draw (current vs projected) so you can check a mine or import can keep up. Nothing
                  is saved until you apply the listed goal changes.
                </p>
              </div>
              <p>
                <span className="text-foreground">The solve pill</span> (next to this button)
                reports the whole-factory solve. <span className="text-foreground">Optimal</span>{" "}
                means it found a complete set of rates. A failure shows an on-page diagnostic with
                the affected blocks, proposed goals, or material mismatches. Applying also runs
                every full block solve and refuses to write if that validation disagrees with the
                preview.
              </p>
            </HelpButton>
          </>
        }
      />

      <ScenarioStatusBar
        state={snapshot.isPending ? "loading" : (snapshot.data?.state ?? "empty")}
        dirty={dirty}
        calculating={calculate.isPending || activeRequestId != null}
        progress={progress.data}
        calculatedAt={snapshot.data?.calculatedAt}
        durationMs={snapshot.data?.durationMs}
        error={snapshot.isError || calculate.isError}
        onRecalculate={() => recalculate()}
      />

      {r && r.status !== "Optimal" && (
        <ScenarioValidationCard status={r.status} validation={r.validation} />
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(20rem,28rem)_minmax(0,1fr)]">
        <FactoryPinsCard
          overrides={overrides}
          onOverride={(good, rate) => setOverrides((current) => ({ ...current, [good]: rate }))}
        />

        {/* Goal changes — the work list */}
        <Card>
          <CardHeader className="justify-between">
            <div className="flex items-center gap-2">
              <CardTitle>Goal changes ({changed.length})</CardTitle>
              <InfoHint content="Next goal is the useful demand assigned to this block. Block output includes coproduct made by its other recipes; factory surplus is what remains after every projected use." />
            </div>
            <div className="flex items-center gap-3">
              <RebalanceAllButton
                changed={changed}
                overrides={overrides}
                status={r?.status}
                previewStale={dirty || calculate.isPending}
                onProgressStart={setActiveRequestId}
                onProgressEnd={() => setActiveRequestId(null)}
                onApplied={() => {
                  setOverrides({});
                  recalculate({});
                }}
              />
            </div>
          </CardHeader>
          <StatTableHeader
            lead="Good"
            className="gap-x-4"
            cols={[
              { label: "Current goal/s", w: "w-28" },
              { label: "Next goal/s", w: "w-28" },
              { label: "Factory use/s", w: "w-28" },
              { label: "Block output/s", w: "w-28" },
              { label: "Surplus/s", w: "w-24" },
            ]}
          />
          {!r ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-5/6" />
              <Skeleton className="h-5 w-2/3" />
            </div>
          ) : changed.length === 0 ? (
            <Callout tone="success" variant="strip">
              Already balanced for these demands — no goal changes needed
            </Callout>
          ) : (
            changed.map((b) => (
              <Link
                key={`${b.id}-${b.goal ? b.good : "primary"}`}
                to="/block/$id"
                params={{ id: String(b.id) }}
                className="flex flex-col gap-1 border-t border-border px-3 py-2 text-sm hover:bg-muted md:flex-row md:items-center md:py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-primary underline">{b.display}</span>
                <span className="grid grid-cols-2 gap-x-4 gap-y-2 md:flex">
                  <StatCell label="Current goal/s" w="md:w-28" className="text-muted-foreground">
                    {rateLabel(b.good ?? "", b.currentRate)}
                  </StatCell>
                  <StatCell
                    label="Next goal/s"
                    w="md:w-28"
                    className={`font-semibold ${b.delta > 0 ? "text-warning" : "text-info"}`}
                  >
                    {rateLabel(b.good ?? "", b.requiredRate)}
                  </StatCell>
                  <StatCell label="Factory use/s" w="md:w-28" className="text-foreground">
                    {rateLabel(b.good ?? "", b.factoryNeed)}
                  </StatCell>
                  <StatCell label="Block output/s" w="md:w-28" className="text-foreground">
                    {rateLabel(b.good ?? "", b.projectedOutput)}
                  </StatCell>
                  <StatCell label="Surplus/s" w="md:w-24" className="text-surplus">
                    {rateLabel(b.good ?? "", b.factorySurplus)}
                  </StatCell>
                </span>
              </Link>
            ))
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SupplyAllocationCard rows={r?.supplyAllocations ?? []} />
        <GoodsCard
          title="Raw inputs needed"
          hint="External supply — current vs. projected"
          rows={(r?.raws ?? []).filter((x) => x.projected > 1e-3)}
          field="projected"
          color="text-warning"
        />
        <Card>
          <CardHeader>
            <CardTitle>Overproduced ({r?.overproduced?.length ?? 0})</CardTitle>
            <InfoHint content="Byproduct surplus that needs a consumer — scale the suggested sink, or add one" />
          </CardHeader>
          {(r?.overproduced ?? []).length === 0 ? (
            <Callout tone="success" variant="strip">
              Nothing piling up
            </Callout>
          ) : (
            <div className="divide-y divide-border">
              {(r?.overproduced ?? []).map((x) => (
                <div key={x.good} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <Icon
                    kind={x.kind as "item" | "fluid"}
                    name={x.good}
                    size="sm"
                    title={x.display}
                  />
                  <span className="min-w-0 flex-1 truncate" title={x.display}>
                    {x.display}
                  </span>
                  <span className="text-surplus">+{rateLabel(x.good, x.projected)}</span>
                  <span className="text-muted-foreground">/s</span>
                  <Tooltip content="Factory balance does not scale consumers to absorb surplus">
                    <span className="ml-2 text-sm text-warning/80">Surplus</span>
                  </Tooltip>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function GoodsCard({
  title,
  hint,
  rows,
  field,
  color,
}: {
  title: string;
  hint: string;
  rows: { good: string; display: string; kind: string; current?: number; projected: number }[];
  field: "projected";
  color: string;
}) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader className="justify-between">
        <CardTitle>
          {title} ({rows.length})
        </CardTitle>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </CardHeader>
      <div className="flex flex-wrap gap-2 p-3">
        {rows.map((x) => (
          <ItemHover
            key={x.good}
            name={x.good}
            kind={x.kind as "item" | "fluid"}
            extraText={
              x.current != null
                ? `Previously ${rateLabel(x.good, x.current, { perSec: true })}.`
                : undefined
            }
            className="inline-flex items-center gap-1 bg-muted/50 px-1.5 py-1 text-sm"
          >
            <Icon kind={x.kind as "item" | "fluid"} name={x.good} size="sm" noHover />
            <span>{x.display}</span>
            <span className={color}>{rateLabel(x.good, x[field])}</span>
            <span className="text-muted-foreground">/s</span>
          </ItemHover>
        ))}
      </div>
    </Card>
  );
}
