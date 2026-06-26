import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { factoryWhatIfFn } from "../server/factorio";
import { Icon, IconProvider } from "../lib/icons";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";

export const Route = createFileRoute("/whatif")({
  component: () => (
    <IconProvider>
      <WhatIf />
    </IconProvider>
  ),
});

const num = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2));

/** Factory what-if: the whole factory solved as one block. Set a final
 * product's rate and see the per-block scale changes needed to satisfy every
 * demand/consumption — your work list to scale each block (or ignore). */
function WhatIf() {
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const wf = useQuery({
    queryKey: ["whatif", overrides],
    queryFn: () => factoryWhatIfFn({ data: { demands: overrides } }),
  });
  const r = wf.data;
  const changed = (r?.blocks ?? []).filter((b) => Math.abs(b.delta) > 0.001);

  return (
    <div className="p-4 font-mono text-foreground">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold">Factory what-if</h1>
        <span className="text-sm text-muted-foreground">
          set a final product&apos;s rate → the per-block changes to rebalance the whole factory
        </span>
        {Object.keys(overrides).length > 0 && (
          <button
            onClick={() => setOverrides({})}
            className="rounded border border-border px-2 py-1 text-sm hover:bg-muted"
          >
            reset to current
          </button>
        )}
        {r && r.status !== "Optimal" && (
          <span className="text-sm text-amber-300">solve: {r.status}</span>
        )}
        <div className="ml-auto">
          <HelpButton title="What is What-if?">
            <p>
              What-if solves your{" "}
              <span className="text-foreground">whole factory as one system</span>. Set a target
              rate on any final product and it shows the per-block changes needed to satisfy every
              downstream demand — a speculative &quot;if I wanted N/s of X, what changes?&quot;
            </p>
            <p>
              <span className="text-foreground">vs Factory.</span> Factory shows your factory as it
              is now; What-if is a sandbox — it doesn&apos;t change anything until you open a block
              and apply.
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
                  block&apos;s current rate, the required rate, and the ×scale to get there. Click a
                  block to open its editor.
                </li>
                <li>
                  <span className="text-foreground">Raw inputs</span> — what the new target draws in
                  from outside (current vs projected).
                </li>
                <li>
                  <span className="text-foreground">Overproduced</span> — anything the target would
                  pile up that still needs a consumer.
                </li>
              </ul>
            </div>
          </HelpButton>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Demands — edit a target to drive the cascade */}
        <Card>
          <CardHeader>
            <CardTitle className="normal-case">Final products (set a target)</CardTitle>
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
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={overrides[d.good] ?? d.current}
                    onChange={(e) =>
                      setOverrides((o) => ({ ...o, [d.good]: Number(e.target.value) || 0 }))
                    }
                    className={`w-20 rounded border px-1 py-0.5 text-right text-sm ${overridden ? "border-sky-400/60 bg-muted" : "border-input bg-muted"}`}
                  />
                  <span className="text-muted-foreground">/s</span>
                </div>
              );
            })}
            {(r?.demands?.length ?? 0) === 0 && !wf.isLoading && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                no final products — every output is consumed in-factory
              </div>
            )}
          </div>
        </Card>

        {/* Block changes — the work list */}
        <Card className="lg:col-span-2">
          <CardHeader className="justify-between">
            <CardTitle className="normal-case">Block changes ({changed.length})</CardTitle>
            <span className="text-xs text-muted-foreground">scale each block to rebalance</span>
          </CardHeader>
          <div className="flex px-3 pb-1 text-xs text-muted-foreground">
            <span className="flex-1">block</span>
            <span className="w-20 text-right">current/s</span>
            <span className="w-20 text-right">required/s</span>
            <span className="w-16 text-right">×scale</span>
          </div>
          {changed.length === 0 && !wf.isLoading ? (
            <div className="px-3 py-2 text-sm text-emerald-300">
              ✓ already balanced for these demands — no block changes needed
            </div>
          ) : (
            changed.map((b) => (
              <Link
                key={b.id}
                to="/block/$id"
                params={{ id: String(b.id) }}
                className="flex items-center border-t border-border px-3 py-1.5 text-sm hover:bg-muted"
              >
                <span className="min-w-0 flex-1 truncate text-primary underline">{b.name}</span>
                <span className="w-20 text-right text-muted-foreground">{num(b.currentRate)}</span>
                <span
                  className={`w-20 text-right font-semibold ${
                    b.delta > 0 ? "text-amber-300" : "text-sky-300"
                  }`}
                >
                  {num(b.requiredRate)}
                </span>
                <span className="w-16 text-right text-muted-foreground">×{b.scale}</span>
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
          color="text-amber-300"
        />
        <Card>
          <CardHeader className="justify-between">
            <CardTitle className="normal-case">
              Overproduced — needs a consumer ({r?.overproduced?.length ?? 0})
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              byproduct surplus — scale the suggested sink, or add a consumer
            </span>
          </CardHeader>
          {(r?.overproduced ?? []).length === 0 ? (
            <div className="px-3 py-2 text-sm text-emerald-300">✓ nothing piling up</div>
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
                  <span className="text-violet-300">+{num(x.projected)}</span>
                  <span className="text-muted-foreground">/s</span>
                  {x.absorb ? (
                    <Link
                      to="/block/$id"
                      params={{ id: String(x.absorb.id) }}
                      className="ml-2 rounded bg-muted/60 px-1.5 py-0.5 text-xs text-primary hover:bg-muted"
                      title={`scale ${x.absorb.name} to absorb the surplus`}
                    >
                      → {x.absorb.name} ×{x.absorb.scale}
                    </Link>
                  ) : (
                    <span
                      className="ml-2 text-xs text-amber-300/80"
                      title="no block consumes this yet"
                    >
                      no consumer
                    </span>
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
        <span className="text-xs text-muted-foreground">{hint}</span>
      </CardHeader>
      <div className="flex flex-wrap gap-2 p-3">
        {rows.map((x) => (
          <span
            key={x.good}
            className="inline-flex items-center gap-1 rounded bg-muted/50 px-1.5 py-1 text-sm"
            title={x.display + (x.current != null ? ` · was ${num(x.current)}/s` : "")}
          >
            <Icon kind={x.kind as "item" | "fluid"} name={x.good} size="sm" title={x.display} />
            <span>{x.display}</span>
            <span className={color}>{num(x[field])}</span>
            <span className="text-muted-foreground">/s</span>
          </span>
        ))}
      </div>
    </Card>
  );
}
