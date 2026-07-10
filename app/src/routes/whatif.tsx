import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { factoryWhatIfFn } from "../server/factorio";
import { Icon, IconProvider } from "../lib/icons";
import { ItemHover } from "../lib/recipe-card";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";
import { InfoHint } from "#/components/info-hint.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { RebalanceAllButton } from "#/components/whatif/rebalance-all-button.tsx";
import { StatCell } from "#/components/stat-cell.tsx";
import { StatTableHeader } from "#/components/stat-table.tsx";

export const Route = createFileRoute("/whatif")({
  component: () => (
    <IconProvider>
      <WhatIf />
    </IconProvider>
  ),
});

import { rateLabel } from "../lib/format";

// A block "needs a change" only if its solved scale is off by more than this
// RELATIVE amount. An absolute delta threshold falsely flags a high-rate block
// (e.g. 122/s) that's balanced to within rounding — 122 × 0.999 still trips a
// 0.001 absolute test. Sub-1% is unbuildable precision (a fraction of a machine),
// so treat it as balanced. Matches the server's re-balance convergence tolerance.
const SCALE_EPS = 0.01;

/** Factory what-if: the whole factory solved as one block. Set a final
 * product's rate and see the per-block scale changes needed to satisfy every
 * demand/consumption — your work list to scale each block (or ignore). */
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
  const changed = (r?.blocks ?? []).filter((b) => Math.abs(b.scale - 1) > SCALE_EPS);

  return (
    <div className="p-4 font-mono text-foreground">
      <PageHeader
        title="Factory what-if"
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
            <HelpButton title="What is What-if?">
              <p>
                What-if solves your{" "}
                <span className="text-foreground">whole factory as one system</span>. Set a target
                rate on any final product and it shows the per-block changes needed to satisfy every
                downstream demand — a speculative &quot;if I wanted N/s of X, what changes?&quot;
              </p>
              <p>
                <span className="text-foreground">vs Factory.</span> Factory shows your factory as
                it is now; What-if is a sandbox — it doesn&apos;t change anything until you open a
                block and apply.
              </p>
              <div>
                <div className="font-semibold text-foreground">How to use it</div>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  <li>
                    <span className="text-foreground">Final products</span> — edit a target rate to
                    drive the cascade.
                  </li>
                  <li>
                    <span className="text-foreground">Block changes</span> — your work list: each
                    block&apos;s current rate, the required rate, and the ×scale to get there. Click
                    a block to open its editor.
                  </li>
                  <li>
                    <span className="text-foreground">Raw inputs</span> — what the new target draws
                    in from outside (current vs projected).
                  </li>
                  <li>
                    <span className="text-foreground">Overproduced</span> — anything the target
                    would pile up that still needs a consumer.
                  </li>
                </ul>
              </div>
              <div>
                <div className="font-semibold text-foreground">Worked example</div>
                <p className="mt-1">
                  Say your automation-science block currently runs at{" "}
                  <span className="text-foreground">0.5/s</span> and you want{" "}
                  <span className="text-foreground">1/s</span>. Set its target to 1 and the cascade
                  updates: <span className="text-foreground">Block changes</span> lists that block
                  at <span className="text-foreground">×2</span>, plus every upstream block that
                  feeds it rescaled to match; <span className="text-foreground">Raw inputs</span>{" "}
                  shows the new draw (current vs projected) so you can check a mine or import can
                  keep up. Nothing is saved until you open a listed block and apply its new rate.
                </p>
              </div>
              <p>
                <span className="text-foreground">The solve pill</span> (next to this button)
                reports the whole-factory solve. <span className="text-foreground">Optimal</span>{" "}
                means it found a consistent set of rates; any other status means the target
                can&apos;t be met with the current recipes and blocks — treat it as a prompt to add
                a producer or relax the target, and open the affected block to see why.
              </p>
            </HelpButton>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Demands — edit a target to drive the cascade */}
        <Card>
          <CardHeader>
            <CardTitle className="normal-case">Final products</CardTitle>
            <InfoHint content="Set a target rate to see the per-block changes." />
          </CardHeader>
          <div className="divide-y divide-border">
            {(r?.demands ?? []).map((d) => {
              const overridden = overrides[d.good] != null;
              return (
                <div key={d.good} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <Icon
                    kind={d.kind as "item" | "fluid"}
                    name={d.good}
                    size="sm"
                    title={d.display}
                  />
                  <span className="min-w-0 flex-1 truncate" title={d.display}>
                    {d.display}
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={overrides[d.good] ?? d.current}
                    onChange={(e) =>
                      setOverrides((o) => ({ ...o, [d.good]: Number(e.target.value) || 0 }))
                    }
                    className={`w-20 text-right ${overridden ? "border-info/60" : ""}`}
                  />
                  <span className="text-muted-foreground">/s</span>
                </div>
              );
            })}
            {wf.isLoading && (
              <div className="space-y-2 p-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-5/6" />
                <Skeleton className="h-5 w-2/3" />
              </div>
            )}
            {(r?.demands?.length ?? 0) === 0 && !wf.isLoading && (
              <EmptyState
                title="No final products"
                description="Every output is consumed in-factory."
              />
            )}
          </div>
        </Card>

        {/* Block changes — the work list */}
        <Card className="lg:col-span-2">
          <CardHeader className="justify-between">
            <CardTitle className="normal-case">Block changes ({changed.length})</CardTitle>
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
            lead="block"
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
              already balanced for these demands — no block changes needed
            </Callout>
          ) : (
            changed.map((b) => (
              <Link
                key={b.id}
                to="/block/$id"
                params={{ id: String(b.id) }}
                className="flex flex-col gap-1 border-t border-border px-3 py-2 text-sm hover:bg-muted md:flex-row md:items-center md:py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-primary underline">{b.name}</span>
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
                    ×{b.scale}
                  </StatCell>
                </span>
              </Link>
            ))
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
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
                  {x.absorb ? (
                    <Link
                      to="/block/$id"
                      params={{ id: String(x.absorb.id) }}
                      className="ml-2 bg-muted/60 px-1.5 py-0.5 text-sm text-primary hover:bg-muted"
                      title={`scale ${x.absorb.name} to absorb the surplus`}
                    >
                      → {x.absorb.name} ×{x.absorb.scale}
                    </Link>
                  ) : (
                    <Tooltip content="no block consumes this yet">
                      <span className="ml-2 text-sm text-warning/80">no consumer</span>
                    </Tooltip>
                  )}
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
