import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Flame, Recycle, RefreshCw, Zap } from "lucide-react";
import { useState } from "react";
import {
  factoryCoherenceFn,
  recomputeAllBlocksFn,
  scalePlanFn,
  setBlockRateFn,
} from "../server/factorio";
import { HelpButton } from "../components/help-drawer";
import { Icon, IconProvider } from "../lib/icons";
import { ItemHover } from "../lib/recipe-card";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Input } from "#/components/ui/input.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "#/components/ui/sheet.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { FilterEmptyState } from "#/components/filter-empty-state.tsx";
import { InfoHint } from "#/components/info-hint.tsx";
import { FilterInput } from "#/components/filter-input.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { useFilteredList } from "../lib/use-filtered-list";

export const Route = createFileRoute("/coherence")({
  component: () => (
    <IconProvider>
      <CoherencePage />
    </IconProvider>
  ),
});

import { formatQty as num, rateLabel } from "../lib/format";

type End = { blockId: number; blockName: string; rate: number; role: string };
type Link = {
  good: string;
  display: string | null;
  kind: string;
  producers: End[];
  consumers: End[];
  produced: number;
  consumed: number;
  net: number;
  craftable?: boolean;
};

// links / unsourced / surplus all filter on the same fields: the localized
// display name, with the internal good name as the hidden fallback
const goodKeys = {
  display: (l: { good: string; display: string | null }) => l.display,
  internal: (l: { good: string; display: string | null }) => l.good,
};

/** Coherence — the factory as block-to-block wiring. Each shared good shows its
 * producer blocks → consumer blocks with the per-good balance, so rate mismatches
 * the aggregate ledger hides (a surplus here + a deficit there cancel) surface on
 * the actual edge. Plus unsourced imports and dangling surplus. */
function CoherencePage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [recomputing, setRecomputing] = useState(false);
  const [scaling, setScaling] = useState<Link | null>(null);
  const data = useQuery({ queryKey: ["coherence"], queryFn: () => factoryCoherenceFn() });

  const recomputeAll = async () => {
    setRecomputing(true);
    try {
      await recomputeAllBlocksFn();
      await qc.invalidateQueries({ queryKey: ["coherence"] });
    } finally {
      setRecomputing(false);
    }
  };

  const links = useFilteredList(data.data?.links ?? [], search, goodKeys);
  const unsourced = useFilteredList(data.data?.unsourced ?? [], search, goodKeys);
  const surplus = useFilteredList(data.data?.surplus ?? [], search, goodKeys);
  const anyData =
    (data.data?.links.length ?? 0) + (data.data?.unsourced.length ?? 0) > 0 ||
    (data.data?.surplus.length ?? 0) > 0;
  const noMatches =
    search.trim() !== "" &&
    anyData &&
    links.length === 0 &&
    unsourced.length === 0 &&
    surplus.length === 0;
  const shortLinks = links.filter((l) => l.net < -1e-6).sort((a, b) => a.net - b.net);
  const surplusLinks = links.filter((l) => l.net > 1e-6);
  const balancedLinks = links.filter((l) => Math.abs(l.net) <= 1e-6);
  const shorts = shortLinks.length;

  return (
    <div className="p-4 font-mono text-foreground">
      <PageHeader
        title="Coherence"
        description={
          <>
            {links.length} link{links.length === 1 ? "" : "s"}
            {shorts > 0 && <span className="text-destructive"> · {shorts} short</span>}
          </>
        }
        actions={
          <>
            <Tooltip content="The aggregate per-item totals (this is the block-to-block wiring)">
              <Button asChild variant="outline" size="sm">
                <Link to="/factory">totals →</Link>
              </Button>
            </Tooltip>
            <Tooltip content="Re-balance the whole factory at once — solve every block's rate together and apply">
              <Button asChild variant="outline" size="sm">
                <Link to="/whatif">re-balance all →</Link>
              </Button>
            </Tooltip>
            <FilterInput
              value={search}
              onValueChange={setSearch}
              placeholder="filter goods…"
              className="w-64"
            />
            <Button
              variant="outline"
              size="icon-sm"
              onClick={recomputeAll}
              disabled={recomputing}
              title="Recompute all blocks — re-solve every block and refresh its cached flows"
            >
              <RefreshCw className={recomputing ? "animate-spin" : ""} />
            </Button>
            <HelpButton title="What is Coherence?">
              <p>
                Coherence shows your factory as{" "}
                <span className="text-foreground">block-to-block wiring</span> — every good one
                block makes and another block consumes, on the actual edge between them.
              </p>
              <p>
                <span className="text-foreground">Why it&apos;s separate from Factory.</span> The
                Factory page sums each block&apos;s output per item, which can <em>hide</em> a real
                problem: if block A overproduces iron by +5 and block B is 5 short, the totals
                cancel to &quot;balanced <Check className="inline size-3.5" />
                &quot; — but the wiring is broken (B is starved, A backs up). Coherence shows each
                edge, so those canceling mismatches surface.
              </p>
              <div>
                <div className="font-semibold text-foreground">The groups</div>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  <li>
                    <span className="text-destructive">Short</span> — a block isn&apos;t getting
                    enough of this good. Scale its producer up.
                  </li>
                  <li>
                    <span className="text-surplus">Overproduced</span> — more is made than used
                    internally. Route the extra or it backs up.
                  </li>
                  <li>
                    <span className="text-success">Balanced</span> — producers meet consumers;
                    nothing to do (collapsed by default).
                  </li>
                  <li>
                    <span className="text-foreground">Unsourced imports</span> — consumed but
                    nothing makes them: supply a raw, or build a block.
                  </li>
                  <li>
                    <span className="text-foreground">Surplus / outputs</span> — produced but
                    nothing consumes them: a final product, or waste to route.
                  </li>
                </ul>
              </div>
              <p>
                <span className="text-foreground">Scale up.</span> On a short good, &quot;scale
                up&quot; opens a planner — pick which producer block grows, set a new target rate,
                preview the buildings, power and inputs it&apos;ll need, then apply.
              </p>
              <div>
                <div className="font-semibold text-foreground">Worked example — scale stone</div>
                <p className="mt-1">
                  Your stone block makes <span className="text-foreground">40/s</span>; two
                  consumers pull <span className="text-foreground">35/s</span> and{" "}
                  <span className="text-foreground">20/s</span> — 55/s total. Stone shows{" "}
                  <span className="text-destructive">Short 15/s</span>. Open scale-up on that block
                  and set the target to <span className="text-foreground">60/s</span> (55 plus a
                  little headroom). It re-solves the block at the new rate — machine-seconds scale
                  ~1.5×, so roughly{" "}
                  <span className="text-foreground">+50% drills, power, and ore draw</span> — and
                  shows the preview before you apply. Applying saves the block; the edge flips to{" "}
                  <span className="text-success">Balanced</span>.
                </p>
              </div>
              <p>
                Sides with many blocks (a heavy hitter like stone or electricity) collapse to a
                count — click <span className="text-foreground">N blocks</span> to expand.
              </p>
            </HelpButton>
          </>
        }
      />

      {data.isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {(data.data?.links.length ?? 0) === 0 && !data.isLoading && (
        <EmptyState
          title="No block-to-block links yet"
          description="Build some blocks that feed each other and their wiring appears here."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/block">build some blocks</Link>
            </Button>
          }
        />
      )}

      {/* A filter that matches nothing must say so, not render a blank page. */}
      {noMatches && <FilterEmptyState query={search} onClear={() => setSearch("")} />}

      {/* Problem-first: shorts (the point of the view) on top, balanced last. */}
      {shortLinks.length > 0 && (
        <Section
          title={`Short (${shortLinks.length})`}
          hint="a block isn't getting enough — scale its producer up"
        >
          {shortLinks.map((l) => (
            <LinkRow key={l.good} l={l} onScale={() => setScaling(l)} />
          ))}
        </Section>
      )}
      {surplusLinks.length > 0 && (
        <Section
          title={`Overproduced (${surplusLinks.length})`}
          hint="more made than used internally — route the extra or it backs up"
        >
          {surplusLinks.map((l) => (
            <LinkRow key={l.good} l={l} onScale={() => setScaling(l)} />
          ))}
        </Section>
      )}
      {balancedLinks.length > 0 && (
        <details className="mb-5">
          <summary className="cursor-pointer border border-border bg-card px-3 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
            Balanced ({balancedLinks.length})
            <InfoHint
              content="producers meet consumers — nothing to do"
              className="ml-1.5 align-text-bottom"
            />
          </summary>
          <div className="mt-2 divide-y divide-border border border-border">
            {balancedLinks.map((l) => (
              <LinkRow key={l.good} l={l} onScale={() => setScaling(l)} />
            ))}
          </div>
        </details>
      )}

      {unsourced.length > 0 && (
        <Section
          title="Unsourced imports"
          hint="consumed but no block produces them — a raw to supply, or a block to build"
        >
          {unsourced.map((l) => (
            <OrphanRow key={l.good} l={l} mode="unsourced" />
          ))}
        </Section>
      )}

      {surplus.length > 0 && (
        <Section
          title="Surplus / outputs"
          hint="produced but no block consumes them — a final product, or waste to route"
        >
          {surplus.map((l) => (
            <OrphanRow key={l.good} l={l} mode="surplus" />
          ))}
        </Section>
      )}

      {scaling && (
        <ScalePlanDrawer
          link={scaling}
          onClose={() => setScaling(null)}
          onApplied={() => {
            void qc.invalidateQueries({ queryKey: ["coherence"] });
            setScaling(null);
          }}
        />
      )}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5 border border-border">
      <div className="flex items-center gap-1.5 border-b border-border bg-card px-3 py-2">
        <span className="text-sm font-semibold">{title}</span>
        <InfoHint content={hint} />
      </div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

/** A good chip with icon + display, hover for details. */
function Good({ good, display, kind }: { good: string; display: string | null; kind: string }) {
  return (
    <ItemHover
      name={good}
      kind={kind as "item" | "fluid"}
      className="flex max-w-full min-w-0 items-center gap-1.5"
    >
      <Icon kind={kind as "item" | "fluid"} name={good} size="sm" noHover />
      <span className="min-w-0 truncate">{display ?? good}</span>
    </ItemHover>
  );
}

/** One block on an edge end: name + rate, links to the block editor. */
function BlockEnd({ good, b, tone }: { good: string; b: End; tone: "make" | "use" }) {
  return (
    <Link
      to="/block/$id"
      params={{ id: String(b.blockId) }}
      className="inline-flex items-center gap-1 bg-muted/50 px-1.5 py-0.5 text-sm hover:bg-muted"
      title={`${b.blockName} · ${b.role}`}
    >
      <span className="max-w-[17rem] truncate md:max-w-[10rem]">{b.blockName}</span>
      <span className={tone === "make" ? "text-success" : "text-warning"}>
        {rateLabel(good, b.rate)}
      </span>
      {b.role === "byproduct" && <Recycle className="size-3.5 text-surplus/80" />}
    </Link>
  );
}

function Balance({ good, net }: { good: string; net: number }) {
  const base = "shrink-0 px-1.5 py-0.5 whitespace-nowrap";
  if (Math.abs(net) <= 1e-6)
    return (
      <span className={`${base} inline-flex items-center gap-1 bg-success/15 text-success`}>
        <Check className="size-3.5" /> balanced
      </span>
    );
  if (net < 0)
    return (
      <span className={`${base} bg-destructive/20 text-destructive`}>
        short {rateLabel(good, -net, { perSec: true })}
      </span>
    );
  return (
    <span className={`${base} bg-surplus/15 text-surplus`}>
      +{rateLabel(good, net, { perSec: true })}
    </span>
  );
}

// Past this many blocks on one side, collapse to a count (a heavy hitter like stone
// or electricity would otherwise wrap into a 40-pill wall). Expandable on click.
const MANY_ENDS = 5;

/** One side of a link — `made by`/`used by` — listing block pills, or a "N blocks"
 * count (expandable) when there are too many to read inline. */
function Ends({
  good,
  ends,
  total,
  tone,
  label,
}: {
  good: string;
  ends: End[];
  total: number;
  tone: "make" | "use";
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const collapsed = ends.length > MANY_ENDS && !open;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {collapsed ? (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setOpen(true)}
          title="Show the blocks"
          className="bg-muted/50 text-muted-foreground"
        >
          {ends.length} blocks
        </Button>
      ) : (
        ends.map((b) => <BlockEnd key={`${b.blockId}-${b.role}`} good={good} b={b} tone={tone} />)
      )}
      {ends.length > MANY_ENDS && open && (
        <Button
          variant="link"
          size="xs"
          onClick={() => setOpen(false)}
          className="text-muted-foreground"
        >
          less
        </Button>
      )}
      <span className="text-sm text-muted-foreground">
        = {rateLabel(good, total, { perSec: true })}
      </span>
    </span>
  );
}

/** The good (anchor) + its balance, then the wiring read tight left→right beside
 * it: `made by [blocks] = N/s · used by [blocks] = M/s`. No center gap. */
function LinkRow({ l, onScale }: { l: Link; onScale: () => void }) {
  const short = l.net < -1e-6;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 text-sm">
      {/* anchor: what this row is ABOUT (fixed width so goods/balances align) */}
      <div className="flex w-72 shrink-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <Good good={l.good} display={l.display} kind={l.kind} />
        </div>
        <Balance good={l.good} net={l.net} />
      </div>
      {/* the wiring */}
      <div className="flex flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
        <Ends good={l.good} ends={l.producers} total={l.produced} tone="make" label="made by" />
        <span className="px-1 text-border">·</span>
        <Ends good={l.good} ends={l.consumers} total={l.consumed} tone="use" label="used by" />
      </div>
      {short && (
        <Button
          variant="outline"
          size="xs"
          onClick={onScale}
          title="Plan scaling a producer block up to meet demand"
          className="shrink-0 border-primary/50 text-primary hover:bg-primary/10 hover:text-primary"
        >
          ⤢ scale up
        </Button>
      )}
    </div>
  );
}

/** An unsourced import (needs a source) or a dangling surplus (needs a sink). */
function OrphanRow({ l, mode }: { l: Link; mode: "unsourced" | "surplus" }) {
  const ends = mode === "unsourced" ? l.consumers : l.producers;
  const total = mode === "unsourced" ? l.consumed : l.produced;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <Good good={l.good} display={l.display} kind={l.kind} />
      <span className={mode === "unsourced" ? "text-warning" : "text-surplus"}>
        {rateLabel(l.good, total, { perSec: true })}
      </span>
      {mode === "unsourced" &&
        (l.craftable ? (
          <Tooltip content="unlocked at your horizon — make a block to supply it">
            <Badge className="border-transparent bg-info/15 text-info">buildable</Badge>
          </Tooltip>
        ) : (
          <Badge>raw / import</Badge>
        ))}
      <span className="text-muted-foreground">{mode === "unsourced" ? "used by" : "made by"}</span>
      {ends.map((b) => (
        <BlockEnd
          key={`${b.blockId}-${b.role}`}
          good={l.good}
          b={b}
          tone={mode === "unsourced" ? "use" : "make"}
        />
      ))}
    </div>
  );
}

/** Scale-to-demand planner: pick a producer block of a short good and preview the
 * concrete changes (buildings, modules/beacons, I/O) to grow it to a new target. */
function ScalePlanDrawer({
  link,
  onClose,
  onApplied,
}: {
  link: Link;
  onClose: () => void;
  onApplied: () => void;
}) {
  const producers = link.producers.filter((p) => p.role === "primary" || p.role === "stock");
  const shortfall = +(-link.net).toFixed(3);
  const initId = producers.length === 1 ? producers[0].blockId : null;
  const initRate = initId ? +(producers[0].rate + shortfall).toFixed(3) : 0;
  const [selId, setSelId] = useState<number | null>(initId);
  const [rate, setRate] = useState(initRate);
  const [rateStr, setRateStr] = useState(String(initRate));
  const [applying, setApplying] = useState(false);

  const pick = (id: number) => {
    const p = producers.find((x) => x.blockId === id);
    const r = p ? +(p.rate + shortfall).toFixed(3) : 0;
    setSelId(id);
    setRate(r);
    setRateStr(String(r));
  };
  const commitRate = () => {
    const v = Number(rateStr);
    if (Number.isFinite(v) && v > 0) setRate(+v.toFixed(3));
    else setRateStr(String(rate));
  };

  const plan = useQuery({
    queryKey: ["scalePlan", selId, rate],
    queryFn: () => scalePlanFn({ data: { blockId: selId!, newRate: rate } }),
    enabled: selId != null && rate > 0,
  });
  const p = plan.data;

  const apply = async () => {
    if (selId == null) return;
    setApplying(true);
    try {
      await setBlockRateFn({ data: { blockId: selId, rate } });
      onApplied();
    } finally {
      setApplying(false);
    }
  };

  const Delta = ({ from, to }: { from: number; to: number }) => {
    const d = to - from;
    return (
      <span className={d > 1e-6 ? "text-success" : d < -1e-6 ? "text-destructive" : ""}>
        {num(from)} → {num(to)}{" "}
        {Math.abs(d) > 1e-6 && (
          <span className="text-muted-foreground">
            ({d > 0 ? "+" : ""}
            {num(d)})
          </span>
        )}
      </span>
    );
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" aria-describedby={undefined} className="w-[30rem] max-w-[92vw]">
        <SheetHeader className="h-auto gap-2 py-3 pr-12">
          <Icon
            kind={link.kind as "item" | "fluid"}
            name={link.good}
            size="md"
            title={link.display ?? link.good}
          />
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate">Scale up to demand</SheetTitle>
            <div className="truncate text-sm text-muted-foreground">
              {link.display ?? link.good} · short {num(shortfall)}/s · demand {num(link.consumed)}/s
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {/* pick which producer block grows */}
          <FieldLabel className="mb-1">Which block grows?</FieldLabel>
          {producers.length === 0 ? (
            <div className="text-sm text-muted-foreground/70 italic">
              only byproduct sources make this — scale the block whose primary it is instead.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {producers.map((b) => (
                <Button
                  key={b.blockId}
                  variant="toggle"
                  aria-pressed={selId === b.blockId}
                  onClick={() => pick(b.blockId)}
                  className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-left"
                >
                  <span className="min-w-0 flex-1 truncate">{b.blockName}</span>
                  <span className="text-success">{num(b.rate)}/s</span>
                </Button>
              ))}
            </div>
          )}

          {selId != null && (
            <>
              <div className="mt-4 mb-1 flex items-center gap-2">
                <FieldLabel>New target</FieldLabel>
                <Input
                  value={rateStr}
                  onChange={(e) => setRateStr(e.target.value)}
                  onBlur={commitRate}
                  onKeyDown={(e) => e.key === "Enter" && commitRate()}
                  inputMode="decimal"
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">
                  /s {p && <>(was {num(p.block.currentRate)})</>}
                </span>
              </div>

              {plan.isLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-4/5" />
                  <Skeleton className="h-5 w-3/5" />
                </div>
              )}
              {p && p.status !== "solved" && (
                <Callout tone="destructive" className="mb-2">
                  {p.message ?? "this rate doesn't solve cleanly"}
                </Callout>
              )}

              {p && (
                <div className="space-y-4">
                  {/* buildings per recipe */}
                  <PlanSection
                    title="Buildings"
                    hint={
                      p.rows.some((r) => r.modules.length || r.beaconCount > 0)
                        ? "modules/beacons per machine are unchanged — tune them in the block editor to cut building count"
                        : undefined
                    }
                  >
                    {p.rows.map((r) => (
                      <div key={r.recipe} className="flex items-center gap-2 py-0.5 text-sm">
                        {r.machine && <Icon kind="entity" name={r.machine} size="sm" noTitle />}
                        <span
                          className="min-w-0 flex-1 truncate"
                          title={r.machineDisplay ?? r.display}
                        >
                          {r.machineDisplay ?? r.display}
                        </span>
                        <span className="shrink-0">
                          <Delta from={r.countCur} to={r.countNew} />
                        </span>
                      </div>
                    ))}
                  </PlanSection>

                  {(p.power.nextW > 1 || p.power.nextHeatW > 1) && (
                    <PlanSection title="Power">
                      {p.power.nextW > 1 && (
                        <FlowLine
                          label={
                            <span className="inline-flex items-center gap-1">
                              <Zap className="size-3.5" /> electricity (MW)
                            </span>
                          }
                        >
                          <Delta from={p.power.curW / 1e6} to={p.power.nextW / 1e6} />
                        </FlowLine>
                      )}
                      {p.power.nextHeatW > 1 && (
                        <FlowLine
                          label={
                            <span className="inline-flex items-center gap-1">
                              <Flame className="size-3.5" /> heat (MW)
                            </span>
                          }
                        >
                          <Delta from={p.power.curHeatW / 1e6} to={p.power.nextHeatW / 1e6} />
                        </FlowLine>
                      )}
                    </PlanSection>
                  )}

                  {p.imports.length > 0 && (
                    <PlanSection title="Imports — bring in more">
                      {p.imports.map((f) => (
                        <FlowLine key={f.good} good={f.good} display={f.display} kind={f.kind}>
                          <Delta from={f.cur} to={f.next} />
                        </FlowLine>
                      ))}
                    </PlanSection>
                  )}

                  {p.byproducts.length > 0 && (
                    <PlanSection title="Byproducts — more to route">
                      {p.byproducts.map((f) => (
                        <FlowLine key={f.good} good={f.good} display={f.display} kind={f.kind}>
                          <Delta from={f.cur} to={f.next} />
                        </FlowLine>
                      ))}
                    </PlanSection>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-border p-3">
          <Button
            className="w-full"
            onClick={apply}
            disabled={selId == null || applying || rate <= 0}
          >
            {applying ? "applying…" : `Apply — set to ${num(rate)}/s`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PlanSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <FieldLabel>{title}</FieldLabel>
        {hint && <InfoHint content={hint} />}
      </div>
      <div className="border border-border px-2 py-1">{children}</div>
    </div>
  );
}

function FlowLine({
  good,
  display,
  kind,
  label,
  children,
}: {
  good?: string;
  display?: string | null;
  kind?: string;
  label?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-sm">
      {good && kind ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <Icon kind={kind as "item" | "fluid"} name={good} size="sm" title={display ?? good} />
          <span className="truncate">{display ?? good}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
      )}
      <span className="shrink-0">{children}</span>
    </div>
  );
}
