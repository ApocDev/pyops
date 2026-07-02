import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Cloud, MapPin, Plus, RefreshCw, X, Zap } from "lucide-react";
import { useState } from "react";
import {
  blockChangeReportFn,
  blocksForGoodFn,
  factoryTotalsFn,
  listBlocksFn,
  machineSufficiencyFn,
  productionComparisonFn,
  recomputeAllBlocksFn,
  saveBlockFn,
} from "../server/factorio";
import { bridgeLocateFn } from "../server/bridge/fns";
import { Icon, IconProvider } from "../lib/icons";
import { ItemHover } from "../lib/recipe-card";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Input } from "#/components/ui/input.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { StatCell } from "#/components/stat-cell.tsx";
import { StatTableHeader } from "#/components/stat-table.tsx";
import { GoodsSection } from "#/components/goods-table.tsx";

export const Route = createFileRoute("/factory")({
  component: () => (
    <IconProvider>
      <FactoryPage />
    </IconProvider>
  ),
});

import { formatQty as num } from "../lib/format";
function timeAgo(iso: string): string {
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago`;
}
const fmtW = (w: number) =>
  w >= 1e9
    ? `${(w / 1e9).toFixed(2)} GW`
    : w >= 1e6
      ? `${(w / 1e6).toFixed(2)} MW`
      : `${(w / 1e3).toFixed(0)} kW`;

/** Factory overview — the whole point of caching block flows: every block's
 * solved I/O aggregated per item with zero solving. Deficits (consumed more
 * than produced across blocks) are what you build next. */
function FactoryPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{ item: string; kind: string } | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputed, setRecomputed] = useState<string | null>(null);
  const totals = useQuery({ queryKey: ["factoryTotals"], queryFn: () => factoryTotalsFn() });
  const blocks = useQuery({ queryKey: ["blocks"], queryFn: () => listBlocksFn() });
  const machines = useQuery({
    queryKey: ["machineSufficiency"],
    queryFn: () => machineSufficiencyFn(),
    refetchInterval: 4000,
  });
  const production = useQuery({
    queryKey: ["productionComparison"],
    queryFn: () => productionComparisonFn(),
    refetchInterval: 4000,
  });
  // live actual production rate per item (from the game's flow statistics)
  const actualByItem = new Map(
    (production.data?.items ?? []).map((p) => [
      p.item,
      { produced: p.actualProduced, consumed: p.actualConsumed },
    ]),
  );
  const statsSyncedAt = production.data?.syncedAt ?? null;

  // Re-solve every block and refresh its cached flows — fixes stale factory totals
  // after a solver change (e.g. self-fueling, heat) without editing each block.
  const recomputeAll = async () => {
    setRecomputing(true);
    setRecomputed(null);
    try {
      const res = await recomputeAllBlocksFn();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["factoryTotals"] }),
        qc.invalidateQueries({ queryKey: ["blocks"] }),
        qc.invalidateQueries({ queryKey: ["blocksForGood"] }),
      ]);
      setRecomputed(
        `Recomputed ${res.ok} block${res.ok === 1 ? "" : "s"}` +
          (res.broken ? ` · ${res.broken} broken (kept as-is)` : "") +
          (res.failed.length ? ` · ${res.failed.length} failed` : ""),
      );
    } finally {
      setRecomputing(false);
    }
  };

  // Dry-run change detection: which blocks differ from their cache or
  // reference a now-missing recipe — surfaced on demand, not auto-run (it re-solves
  // every block). After reviewing, "recompute all" applies the fresh solves.
  const changes = useMutation({ mutationFn: () => blockChangeReportFn() });

  // produced (primary + byproduct) vs consumed (imports), net per item
  const byItem = new Map<
    string,
    {
      kind: string;
      display: string | null;
      produced: number;
      consumed: number;
      primary: boolean;
      stock: boolean; // some of this good's production is a stock-refill demand (#38)
      otherProduced: number; // production NOT from stock goals — 0 means stock-only
    }
  >();
  for (const f of totals.data ?? []) {
    const e = byItem.get(f.item) ?? {
      kind: f.kind,
      display: f.display,
      produced: 0,
      consumed: 0,
      primary: false,
      stock: false,
      otherProduced: 0,
    };
    if (f.role === "import") e.consumed += f.rate;
    else {
      e.produced += f.rate;
      if (f.role === "primary") e.primary = true;
      if (f.role === "stock") {
        e.primary = true;
        e.stock = true;
      } else {
        e.otherProduced += f.rate;
      }
    }
    byItem.set(f.item, e);
  }
  const rows = [...byItem.entries()]
    .map(([item, e]) => ({
      item,
      ...e,
      net: e.produced - e.consumed,
      // the deficit list's severity axis: fraction of demand met (null = no demand)
      pctMet: e.consumed > 1e-9 ? e.produced / e.consumed : null,
      actualProduced: actualByItem.get(item)?.produced ?? null,
    }))
    .filter((r) => (r.display ?? r.item).toLowerCase().includes(search.toLowerCase()));

  const totalPowerW = (blocks.data ?? []).reduce((s, b) => s + (b.electricityW ?? 0), 0);
  const totalPollution = (blocks.data ?? []).reduce((s, b) => s + (b.pollutionPerMin ?? 0), 0);
  // A good produced ONLY by keep-in-stock goals isn't surplus to route — a mall
  // of stock goals would otherwise flood the surplus list. Own section below.
  // (A stock good that's also genuinely consumed can still show as a deficit.)
  const stockOnly = (r: (typeof rows)[number]) => r.stock && r.otherProduced <= 1e-9;
  const deficits = rows.filter((r) => r.net < -1e-6);
  const stockBuffers = rows.filter((r) => r.net >= -1e-6 && stockOnly(r));
  const surpluses = rows.filter((r) => r.net > 1e-6 && !stockOnly(r));
  const balanced = rows.filter((r) => Math.abs(r.net) <= 1e-6 && !stockOnly(r));

  return (
    <div className="p-4 font-mono text-foreground">
      <PageHeader
        title="Factory"
        description={
          <span className="flex flex-wrap items-center gap-1">
            {blocks.data?.length ?? 0} block(s) · <Zap className="size-3.5" /> {fmtW(totalPowerW)}
            {Math.abs(totalPollution) > 0.005 && (
              <span
                className={`flex items-center gap-1 ${totalPollution < 0 ? "text-success" : ""}`}
                title="net pollution per minute across all enabled blocks — negative means your forestry/plantations absorb more than the machines emit"
              >
                · <Cloud className="size-3.5" /> {totalPollution < 0 ? "−" : ""}
                {num(Math.abs(totalPollution))}/min
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Button asChild size="sm" variant="outline" className="text-primary">
              <Link
                to="/whatif"
                title="Solve the whole factory: set a product's rate, see the per-block changes to rebalance"
              >
                what-if →
              </Link>
            </Button>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="filter items…"
              className="w-64"
            />
            {recomputed && <span className="text-sm text-muted-foreground">{recomputed}</span>}
            <span className="text-sm text-muted-foreground">
              {statsSyncedAt ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <Check className="size-3.5" /> live stats: {production.data?.syncedCount ?? 0}{" "}
                  goods ({timeAgo(statsSyncedAt)})
                </span>
              ) : (
                "no live stats — Sync in-game"
              )}
            </span>
            <Button
              onClick={recomputeAll}
              disabled={recomputing}
              size="icon-sm"
              variant="outline"
              className="text-muted-foreground"
              title="Recompute all blocks — re-solve every block (after a solver change, TURD pick, or data re-import)"
            >
              <RefreshCw className={recomputing ? "animate-spin" : ""} />
            </Button>
            <Button
              onClick={() => changes.mutate()}
              disabled={changes.isPending}
              size="icon-sm"
              variant="outline"
              className="text-muted-foreground"
              title="Check for changes — dry-run re-solve; report blocks that differ or reference a missing recipe (doesn't save)"
            >
              <AlertTriangle className={changes.isPending ? "animate-pulse" : ""} />
            </Button>
            <HelpButton title="What is Factory?">
              <p>
                Factory is the <span className="text-foreground">whole-factory overview</span> —
                every block&apos;s solved output and consumption summed <em>per item</em>, so you
                see the net picture in one place.
              </p>
              <p>
                <span className="text-foreground">Factory vs Coherence.</span> Factory shows net{" "}
                <em>totals</em> (all production of an item minus all consumption). Coherence shows
                the <em>block-to-block wiring</em>. A surplus in one block that cancels a shortfall
                in another looks balanced here but is broken there — so use Factory for &quot;what
                do I still need to make&quot;, and Coherence to catch mismatches the totals hide.
              </p>
              <div>
                <div className="font-semibold text-foreground">What you see</div>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  <li>
                    <span className="text-foreground">Deficits</span> — a negative net (consumed
                    more than produced across blocks) is what to build or scale next. Ranked by{" "}
                    <span className="text-foreground">% of demand met</span> — a fully-starved
                    intermediate outranks a half-fed bulk fluid, whatever their raw rates.
                  </li>
                  <li>
                    <span className="text-foreground">Sort &amp; fold</span> — click any column
                    header to sort a section (the choice sticks); click a section&apos;s title to
                    collapse it out of the way.
                  </li>
                  <li>
                    <span className="text-foreground">Stock buffers</span> — goods made only by
                    &quot;keep in stock&quot; goals sit in their own list: they&apos;re refill
                    demand, not surplus for other blocks to consume.
                  </li>
                  <li>
                    <span className="text-foreground">Planned vs actual</span> — when the game is
                    linked, each item shows your real in-game rate against plan: red = starved,
                    amber = behind, green = on target.
                  </li>
                  <li>
                    <span className="text-foreground">Built vs required</span> — per machine (and
                    the recipe it runs) how many you&apos;ve placed in-game vs what your blocks need
                    — including drills broken down by the ore they mine.
                  </li>
                </ul>
              </div>
              <div>
                <div className="font-semibold text-foreground">Toolbar (top-right)</div>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  <li>
                    <span className="inline-flex items-center gap-1 text-foreground">
                      <RefreshCw className="size-3.5" /> recompute
                    </span>{" "}
                    — re-solve every block and refresh its cached flows, after a solver change, TURD
                    pick, or data re-import.
                  </li>
                  <li>
                    <span className="inline-flex items-center gap-1 text-foreground">
                      <AlertTriangle className="size-3.5" /> check for changes
                    </span>{" "}
                    — a dry run of the above: list which blocks would change (or reference a
                    now-missing recipe) without saving anything.
                  </li>
                </ul>
              </div>
              <p>
                <span className="text-foreground">what-if →</span> (top-left) sets a final
                product&apos;s target and shows the per-block rescale needed across the whole
                factory.
              </p>
            </HelpButton>
          </>
        }
      />

      {changes.data && <ChangeReport data={changes.data} />}

      {totals.isLoading && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      )}
      {totals.isError && (
        <div className="text-sm text-destructive">
          failed to load factory totals — {totals.error?.message}
        </div>
      )}
      {!totals.isLoading && !totals.isError && (totals.data?.length ?? 0) === 0 && (
        <EmptyState
          title="No flows yet"
          description="The factory overview sums every block's solved production and consumption per item — build a block to see it."
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/block">build some blocks</Link>
            </Button>
          }
        />
      )}
      {(totals.data?.length ?? 0) > 0 && rows.length === 0 && (
        <EmptyState
          title="No items match the filter"
          description={`Nothing in the factory matches "${search}".`}
          action={
            <Button size="sm" variant="outline" onClick={() => setSearch("")}>
              clear filter
            </Button>
          }
        />
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <GoodsSection
          id="deficits"
          title="Deficits"
          hint="consumed across blocks but not produced enough — build these next"
          rows={deficits}
          defaultSorting={[
            { id: "met", desc: false },
            { id: "consumed", desc: true },
          ]}
          showMet
          selectedItem={selected?.item ?? null}
          onSelect={(r) => setSelected({ item: r.item, kind: r.kind })}
        />
        <GoodsSection
          id="surpluses"
          title="Surpluses"
          hint="net production available to new blocks"
          rows={surpluses}
          defaultSorting={[{ id: "net", desc: true }]}
          selectedItem={selected?.item ?? null}
          onSelect={(r) => setSelected({ item: r.item, kind: r.kind })}
        />
        <GoodsSection
          id="balanced"
          title="Balanced"
          hint="block-to-block flows that match exactly"
          rows={balanced}
          defaultSorting={[{ id: "item", desc: false }]}
          selectedItem={selected?.item ?? null}
          onSelect={(r) => setSelected({ item: r.item, kind: r.kind })}
        />
        {/* least actionable of the goods lists — a healthy mall parks here, so it
            takes the last cell rather than crowding the deficit/surplus work lists */}
        <GoodsSection
          id="stock"
          title="Stock buffers"
          hint="keep-on-hand goals — refill demand, not surplus to route"
          rows={stockBuffers}
          defaultSorting={[{ id: "item", desc: false }]}
          selectedItem={selected?.item ?? null}
          onSelect={(r) => setSelected({ item: r.item, kind: r.kind })}
        />
      </div>

      <MachinesCard data={machines.data} />

      {selected && (
        <ResourceDrawer
          item={selected.item}
          kind={selected.kind}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

type MachineRow = {
  machine: string;
  display: string;
  requiredTotal: number;
  builtTotal: number;
  recipeAware: boolean;
  unassignedBuilt: number;
  short: number;
  recipes: {
    recipe: string;
    display: string;
    required: number;
    built: number | null;
    short: number;
  }[];
};
type ChangeReportData = {
  total: number;
  affected: number;
  reports: {
    id: number;
    name: string;
    status: "ok" | "changed" | "broken";
    stale: boolean;
    missingRecipes: string[];
    missingGoods: string[];
    changes: {
      item: string;
      display: string | null;
      kind: string;
      was: number | null;
      now: number | null;
    }[];
    error?: string;
  }[];
};

/** surface which saved blocks were affected by a TURD pick / data re-import —
 * what broke (missing recipe / solve error) and what changed (I/O drift) — instead
 * of silently re-solving. "Recompute all" applies the fresh solves. */
function ChangeReport({ data }: { data: ChangeReportData }) {
  if (data.affected === 0) {
    return (
      <Callout tone="success" className="mb-4">
        all {data.total} block(s) up to date — no drift or missing recipes
      </Callout>
    );
  }
  const rate = (n: number | null) => (n == null ? "—" : num(n));
  return (
    <Card className="mb-4 border-warning/40">
      <CardHeader>
        <CardTitle className="normal-case text-warning">
          {data.affected} of {data.total} block(s) affected — review, then “recompute all” to apply
        </CardTitle>
      </CardHeader>
      <div className="divide-y divide-border">
        {data.reports.map((r) => (
          <div key={r.id} className="px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <Link
                to="/block/$id"
                params={{ id: String(r.id) }}
                className="font-semibold text-primary underline"
              >
                {r.name}
              </Link>
              <Badge
                className={
                  r.status === "broken"
                    ? "border-transparent bg-destructive/20 text-destructive"
                    : "border-transparent bg-warning/20 text-warning"
                }
              >
                {r.status}
              </Badge>
              {r.stale && <span className="text-sm text-muted-foreground">stale data</span>}
            </div>
            {r.missingRecipes.length > 0 && (
              <div className="mt-0.5 text-destructive">
                missing recipe: {r.missingRecipes.join(", ")}
              </div>
            )}
            {r.missingGoods.length > 0 && (
              <div className="mt-0.5 text-destructive">
                missing good: {r.missingGoods.join(", ")}
              </div>
            )}
            {r.error && <div className="mt-0.5 text-destructive">solve error: {r.error}</div>}
            {r.changes.length > 0 && (
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                {r.changes.map((c) => (
                  <span
                    key={c.item}
                    className="inline-flex items-center gap-1"
                    title={c.display ?? c.item}
                  >
                    <Icon
                      kind={c.kind as "item" | "fluid"}
                      name={c.item}
                      size="sm"
                      title={c.display ?? c.item}
                    />
                    {c.display ?? c.item}: {rate(c.was)} →{" "}
                    <span className="text-foreground">{rate(c.now)}</span>
                    /s
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

type MachineSufficiency = {
  machines: MachineRow[];
  syncedAt: string | null;
  syncedCount: number | null;
};

const ceil = (n: number) => Math.ceil(n - 1e-6);

/** Live actual production rate for an item, colored against what's planned: red
 * when the game is making far less than planned (starved), amber when behind,
 * green when on target. "—" when no live stats exist for the good. */
/** Required-vs-built per machine, broken down by the recipe each runs. The blocks
 * say how many machines they need per recipe; the game says how many are placed
 * and (for assemblers / active furnaces) what they're set to craft. So a machine
 * built but on the wrong recipe still reads as short. Mining drills / labs / idle
 * furnaces report no recipe — those fall back to a machine-level total. Built
 * counts are force-wide, so this is the factory-level picture. */
function MachinesCard({ data }: { data: MachineSufficiency | undefined }) {
  if (!data) return null;
  const rows = data.machines;
  if (rows.length === 0 && !data.syncedAt) return null;
  const shortCount = rows.filter((m) => m.short > 0).length;

  return (
    <Card className="mt-4 max-w-3xl">
      <CardHeader className="justify-between">
        <CardTitle className="normal-case">
          Machines ({rows.length})
          {shortCount > 0 && (
            <span className="ml-2 text-sm font-normal text-destructive">
              {shortCount} under-built
            </span>
          )}
        </CardTitle>
        <span className="text-sm text-muted-foreground">
          {data.syncedAt ? (
            <span className="inline-flex items-center gap-1 text-success">
              <Check className="size-3.5" /> live: {data.syncedCount ?? 0} placed (
              {timeAgo(data.syncedAt)})
            </span>
          ) : (
            "no built-machine data — open the PyOps panel in-game and Sync"
          )}
        </span>
      </CardHeader>
      <StatTableHeader
        lead="machine · recipe"
        cols={[
          { label: "built", w: "w-20" },
          { label: "required", w: "w-20" },
          { label: "short", w: "w-24" },
        ]}
      />
      {rows.map((m) => (
        <div key={m.machine} className="border-t border-border">
          {/* machine summary */}
          <div className="flex flex-col gap-1 px-3 py-2 text-sm md:flex-row md:items-center md:gap-2 md:py-1.5">
            <span className="flex min-w-0 items-center gap-2 md:flex-1">
              <Icon kind="item" name={m.machine} size="sm" title={m.display} />
              <span className="min-w-0 flex-1 truncate font-semibold" title={m.display}>
                {m.display}
                {!m.recipeAware && m.builtTotal > 0 && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    (no recipe data)
                  </span>
                )}
              </span>
            </span>
            <span className="grid grid-cols-3 gap-x-3 pl-7 md:flex md:gap-2 md:pl-0">
              <StatCell label="built" w="md:w-20" className="text-muted-foreground">
                {m.builtTotal}
              </StatCell>
              <StatCell label="required" w="md:w-20" className="text-warning">
                {ceil(m.requiredTotal)}
              </StatCell>
              <StatCell
                label="short"
                w="md:w-24"
                className={`font-semibold ${m.short > 0 ? "text-destructive" : "text-success"}`}
              >
                {m.short > 0 ? `need ${m.short}` : <Check className="inline size-4" />}
              </StatCell>
            </span>
          </div>
          {/* per-recipe breakdown (only meaningful when recipe-aware) */}
          {m.recipeAware &&
            m.recipes.map((r) => (
              <div
                key={r.recipe}
                className="flex flex-col gap-0.5 py-1 pr-3 pl-10 text-sm text-muted-foreground md:flex-row md:items-center md:gap-2 md:py-0.5"
              >
                <span className="flex min-w-0 items-center gap-2 md:flex-1">
                  <Icon kind="recipe" name={r.recipe} size="sm" title={r.display} />
                  <span className="min-w-0 flex-1 truncate" title={r.display}>
                    {r.display}
                  </span>
                </span>
                <span className="grid grid-cols-3 gap-x-3 pl-6 md:flex md:gap-2 md:pl-0">
                  <StatCell label="built" w="md:w-20">
                    {r.built ?? "—"}
                  </StatCell>
                  <StatCell label="required" w="md:w-20">
                    {ceil(r.required)}
                  </StatCell>
                  <StatCell
                    label="short"
                    w="md:w-24"
                    className={r.short > 0 ? "text-destructive" : "text-success/70"}
                  >
                    {r.short > 0 ? `need ${r.short}` : <Check className="inline size-3.5" />}
                  </StatCell>
                </span>
              </div>
            ))}
          {m.recipeAware && m.unassignedBuilt > 0 && (
            <div className="flex items-center gap-2 py-0.5 pr-3 pl-10 text-sm text-muted-foreground/70 italic">
              <span className="min-w-0 flex-1">
                {m.unassignedBuilt} built with no recipe set (idle / spare)
              </span>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

/** Slide-over panel for one resource: which blocks make it (primary/byproduct) and
 * which consume it (import), each at its rate — plus a shortcut to draft a new block
 * that produces it. The reverse of the aggregate ledger: who's actually on each end. */
function ResourceDrawer({
  item,
  kind,
  onClose,
}: {
  item: string;
  kind: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const detail = useQuery({
    queryKey: ["blocksForGood", item],
    queryFn: () => blocksForGoodFn({ data: item }),
  });
  const label = detail.data?.display ?? item;

  // Ask the game to find this good in the world (relays to the Factory Search mod).
  const locate = useMutation({
    mutationFn: () => bridgeLocateFn({ data: { name: item, kind: kind as "item" | "fluid" } }),
  });

  // Size the new block to the factory's imbalance for this good, and orient it
  // accordingly: a DEFICIT (consumed > produced) → a producer at +shortfall; a
  // SURPLUS (produced > consumed) → a consuming SINK at −surplus (route the excess,
  // e.g. ash). Balanced/new → a producer at the consumed rate (or 1).
  const consumed = (detail.data?.consumers ?? []).reduce((s, c) => s + c.rate, 0);
  const produced = (detail.data?.producers ?? []).reduce((s, p) => s + p.rate, 0);
  const net = +(produced - consumed).toFixed(3); // >0 surplus, <0 deficit
  const sink = net > 1e-6; // excess to route → a consuming block
  const seedRate = Math.abs(net) > 1e-6 ? -net : consumed > 1e-6 ? +consumed.toFixed(3) : 1;

  const createBlock = async () => {
    setCreating(true);
    const res = await saveBlockFn({
      data: { name: label, data: { goals: [{ name: item, rate: seedRate }], recipes: [] } },
    });
    void qc.invalidateQueries({ queryKey: ["blocks"] });
    void navigate({ to: "/block/$id", params: { id: String(res.id) } });
  };

  const BlockRow = ({
    b,
  }: {
    b: { blockId: number; blockName: string; role: string; rate: number };
  }) => (
    <Link
      to="/block/$id"
      params={{ id: String(b.blockId) }}
      className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted"
    >
      <span className="min-w-0 flex-1 truncate">{b.blockName}</span>
      {b.role === "byproduct" && (
        <Badge className="border-transparent bg-surplus/20 px-1 py-0 text-surplus">byproduct</Badge>
      )}
      <span className="w-20 text-right text-muted-foreground">{num(b.rate)}/s</span>
    </Link>
  );
  const List = ({
    title,
    rows,
    emptyTitle,
    empty,
  }: {
    title: string;
    rows: { blockId: number; blockName: string; role: string; rate: number }[];
    emptyTitle: string;
    empty: string;
  }) => (
    <div className="mb-4">
      <FieldLabel className="mb-1 font-semibold">
        {title} {rows.length > 0 && `(${rows.length})`}
      </FieldLabel>
      {rows.length === 0 ? (
        <EmptyState className="px-2 py-3" title={emptyTitle} description={empty} />
      ) : (
        rows.map((b) => <BlockRow key={`${b.blockId}-${b.role}`} b={b} />)
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <aside
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-96 max-w-[90vw] flex-col border-l border-border bg-background shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-3">
          <Icon kind={kind as "item" | "fluid"} name={item} size="md" />
          <ItemHover name={item} kind={kind as "item" | "fluid"} className="min-w-0 flex-1">
            <div className="truncate font-semibold" title={item}>
              {label}
            </div>
          </ItemHover>
          <Button
            onClick={() => locate.mutate()}
            disabled={locate.isPending}
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            title="Find producers / storage / consumers of this in the game (needs the bridge + Factory Search mod)"
          >
            <MapPin /> locate
          </Button>
          <Button
            onClick={onClose}
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            title="close"
          >
            <X />
          </Button>
        </div>
        {locate.data && !locate.data.sent && (
          <Callout tone="warning" variant="strip" className="border-b border-border">
            game not connected — open Factorio with the PyOps bridge enabled
          </Callout>
        )}
        {locate.data?.sent && (
          <Callout tone="success" variant="strip" className="border-b border-border">
            opened Factory Search in-game for {label}
          </Callout>
        )}

        <div className="flex-1 overflow-auto p-3">
          {detail.isLoading ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <Skeleton className="mb-2 h-4 w-28" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
              <div className="space-y-1">
                <Skeleton className="mb-2 h-4 w-28" />
                <Skeleton className="h-8 w-full" />
              </div>
            </div>
          ) : detail.isError ? (
            <div className="text-sm text-destructive">
              failed to load blocks for this good — {detail.error?.message}
            </div>
          ) : (
            <>
              <List
                title="produced by"
                rows={detail.data?.producers ?? []}
                emptyTitle="No producers"
                empty="no block makes this — it's imported or a raw"
              />
              <List
                title="consumed by"
                rows={detail.data?.consumers ?? []}
                emptyTitle="No consumers"
                empty="no block imports this"
              />
            </>
          )}
        </div>

        <div className="border-t border-border p-3">
          <Button
            onClick={createBlock}
            disabled={creating}
            className="h-auto w-full py-2 font-semibold whitespace-normal"
          >
            <Plus /> new block {sink ? "consuming" : "producing"} {label} @{" "}
            {num(Math.abs(seedRate))}/s
          </Button>
          {sink ? (
            <div className="mt-1 text-center text-sm text-muted-foreground">
              a sink for the {num(net)}/s surplus ({num(produced)} made − {num(consumed)} used) —
              opens consuming this good
            </div>
          ) : (
            net < -1e-6 &&
            produced > 1e-6 && (
              <div className="mt-1 text-center text-sm text-muted-foreground">
                sized to the {num(-net)}/s shortfall ({num(consumed)} used − {num(produced)} made)
              </div>
            )
          )}
        </div>
      </aside>
    </div>
  );
}
