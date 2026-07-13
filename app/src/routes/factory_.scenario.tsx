import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { factoryWhatIfFn } from "../server/factorio";
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
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const wf = useQuery({
    queryKey: ["whatif", overrides],
    queryFn: () => factoryWhatIfFn({ data: { demands: overrides } }),
    // Changing a target starts a fresh whole-factory solve. Keep the demand rows
    // mounted while it runs so the active input does not lose focus mid-edit.
    placeholderData: keepPreviousData,
  });
  const r = wf.data;
  const changed = (r?.goalChanges ?? []).map((goal) => ({ ...goal, name: goal.display }));

  return (
    <div className="p-4 font-mono text-foreground">
      <PageHeader
        title="Scenario"
        actions={
          <>
            {Object.keys(overrides).length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setOverrides({})}>
                reset to current
              </Button>
            )}
            {r && r.status !== "Optimal" && (
              <span className="text-sm text-warning">solve: {r.status}</span>
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
                    affected good&apos;s current target, required target, and ×scale. The block name
                    shows where that goal lives; click the row to open it.
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
                  <span className="text-foreground">×2</span>, plus every upstream goal that feeds
                  it; <span className="text-foreground">Raw inputs</span> shows the new draw
                  (current vs projected) so you can check a mine or import can keep up. Nothing is
                  saved until you apply the listed goal changes.
                </p>
              </div>
              <p>
                <span className="text-foreground">The solve pill</span> (next to this button)
                reports the whole-factory solve. <span className="text-foreground">Optimal</span>{" "}
                means it found a complete set of rates; any other status means the pinned material
                model could not solve. Applying also runs every full block solve and refuses to
                write if that validation disagrees with the preview.
              </p>
            </HelpButton>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FactoryPinsCard
          overrides={overrides}
          onOverride={(good, rate) => setOverrides((current) => ({ ...current, [good]: rate }))}
        />

        {/* Goal changes — the work list */}
        <Card className="lg:col-span-2">
          <CardHeader className="justify-between">
            <CardTitle className="normal-case">Goal changes ({changed.length})</CardTitle>
            <div className="flex items-center gap-3">
              <RebalanceAllButton
                changed={changed}
                overrides={overrides}
                status={r?.status}
                onApplied={() => setOverrides({})}
              />
            </div>
          </CardHeader>
          <StatTableHeader
            lead="good"
            cols={[
              { label: "current/s", w: "w-24" },
              { label: "required/s", w: "w-24" },
              { label: "×scale", w: "w-20" },
            ]}
          />
          {wf.isLoading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-5/6" />
              <Skeleton className="h-5 w-2/3" />
            </div>
          ) : changed.length === 0 ? (
            <Callout tone="success" variant="strip">
              already balanced for these demands — no goal changes needed
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
                <span className="grid grid-cols-3 gap-x-3 md:flex">
                  <StatCell label="current/s" w="md:w-24" className="text-muted-foreground">
                    {rateLabel(b.good ?? "", b.currentRate)}
                  </StatCell>
                  <StatCell
                    label="required/s"
                    w="md:w-24"
                    className={`font-semibold ${b.delta > 0 ? "text-warning" : "text-info"}`}
                  >
                    {rateLabel(b.good ?? "", b.requiredRate)}
                  </StatCell>
                  <StatCell label="×scale" w="md:w-20" className="text-muted-foreground">
                    {b.activation ? "start" : `×${b.scale}`}
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
          hint="external supply — current vs. projected"
          rows={(r?.raws ?? []).filter((x) => x.projected > 1e-3)}
          field="projected"
          color="text-warning"
        />
        <Card>
          <CardHeader>
            <CardTitle className="normal-case">
              Overproduced ({r?.overproduced?.length ?? 0})
            </CardTitle>
            <InfoHint content="byproduct surplus that needs a consumer — scale the suggested sink, or add one" />
          </CardHeader>
          {(r?.overproduced ?? []).length === 0 ? (
            <Callout tone="success" variant="strip">
              nothing piling up
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
                  <Tooltip content="factory balance does not scale consumers to absorb surplus">
                    <span className="ml-2 text-sm text-warning/80">surplus</span>
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
        <CardTitle className="normal-case">
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
