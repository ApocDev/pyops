import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bolt, Flame, Timer, Zap } from "lucide-react";
import { entityDetailFn, itemDetailFn, recipeDetailFn, techDetailFn } from "../server/factorio";
// Cards render the bare sprite (RawIcon) so a card's own icons never spawn nested
// hover cards. The rich hover is the wrapper `Icon` adds around a RawIcon.
import { RawIcon as Icon, fmtSpoilTime } from "./icons";
import { CursorCard, CursorHover } from "./hover";
import { formatQty, formatRate } from "./format";
import { prodScaledAmount } from "./productivity";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";

/** One ingredient/product line: icon + amount + name (+ temps / probability). */
function Comp(c: {
  kind: string;
  name: string;
  display?: string | null;
  amount: number | null;
  amountMin?: number | null;
  amountMax?: number | null;
  probability?: number | null;
  temperature?: number | null;
  minTemp?: number | null;
  maxTemp?: number | null;
}) {
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <Icon kind={c.kind as "item" | "fluid"} name={c.name} size="md" />
      <span className="truncate">
        {c.amount ?? `${c.amountMin}–${c.amountMax}`}× {c.display ?? c.name}
        {c.temperature != null && <span className="text-info"> @{c.temperature}°</span>}
        {c.kind === "fluid" && (c.minTemp != null || c.maxTemp != null) && (
          <span className="text-info">
            {" "}
            [{c.minTemp ?? ""}…{c.maxTemp ?? ""}°]
          </span>
        )}
        {c.probability != null && c.probability < 1 && (
          <span className="text-warning"> p={c.probability}</span>
        )}
      </span>
    </div>
  );
}

function HoverContext({ children }: { children?: React.ReactNode }) {
  return children ? (
    <div className="mt-2 border-l-2 border-info/50 pl-2 text-foreground/90">{children}</div>
  ) : null;
}

export function RecipeCard({ name, extraText }: { name: string; extraText?: React.ReactNode }) {
  const { data } = useQuery({
    queryKey: ["recipe", name],
    queryFn: () => recipeDetailFn({ data: name }),
    staleTime: 60_000,
  });
  const r = data?.recipe;
  return (
    <div className="w-[26rem] border border-border bg-popover p-3 text-sm text-popover-foreground shadow-xl">
      <div className="flex items-center gap-2 text-base font-semibold">
        <Icon kind="recipe" name={name} size="md" />
        <span className="truncate">{r?.display ?? name}</span>
      </div>
      <div className="mb-2 truncate text-sm text-muted-foreground">{name}</div>
      <HoverContext>{extraText}</HoverContext>
      {!r ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-56" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        </div>
      ) : (
        <>
          <div className="mb-2 text-muted-foreground">
            {r.kind} · {r.category} · {r.energyRequired}s{r.allowProductivity ? " · prod" : ""}
            {!r.enabled ? " · locked" : ""}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-0.5 text-muted-foreground">in</div>
              {r.ingredients.length ? (
                r.ingredients.map((c, i) => <Comp key={i} {...c} />)
              ) : (
                <div className="text-muted-foreground">—</div>
              )}
            </div>
            <div>
              <div className="mb-0.5 text-muted-foreground">out</div>
              {r.products.map((c, i) => (
                <Comp key={i} {...c} />
              ))}
            </div>
          </div>
          {data!.machines.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">made in</span>
              {data!.machines.slice(0, 8).map((m) => (
                <Icon key={m.name} kind="item" name={m.name} size="sm" />
              ))}
            </div>
          )}
          {data!.unlocks.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {data!.unlocks.map((u) => (
                <div key={u.tech} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground">unlock</span>
                  <span className="truncate" title={u.tech}>
                    {u.display ?? u.tech}
                  </span>
                  {u.science.map((s) => (
                    <span key={s.name} className="flex items-center gap-0.5 text-muted-foreground">
                      <Icon kind="item" name={s.name} size="sm" />
                      {s.amount}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Hover card for a technology: its science cost, what it unlocks, and its direct
 * prerequisites — all by display name. */
export function TechCard({ name, extraText }: { name: string; extraText?: React.ReactNode }) {
  const { data } = useQuery({
    queryKey: ["tech", name],
    queryFn: () => techDetailFn({ data: name }),
    staleTime: 60_000,
  });
  return (
    <div className="w-[26rem] border border-border bg-popover p-3 text-sm text-popover-foreground shadow-xl">
      <div className="flex items-center gap-2 text-base font-semibold">
        <Icon kind="technology" name={name} size="md" />
        <span className="truncate">{data?.display ?? name}</span>
      </div>
      <HoverContext>{extraText}</HoverContext>
      {!data ? (
        <div className="mt-1.5 space-y-1.5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      ) : (
        <>
          {data.science.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">cost</span>
              {data.science.map((s) => (
                <span
                  key={s.name}
                  className="flex items-center gap-0.5"
                  title={s.display ?? s.name}
                >
                  <Icon kind="item" name={s.name} size="sm" />
                  {s.amount}
                </span>
              ))}
              {data.unitCount ? (
                <span className="text-muted-foreground">× {data.unitCount}</span>
              ) : null}
            </div>
          )}
          {data.prereqs.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-muted-foreground">needs</span>
              {data.prereqs.map((p) => (
                <span key={p.name} className="flex items-center gap-1">
                  <Icon kind="technology" name={p.name} size="sm" />
                  <span className="truncate">{p.display ?? p.name}</span>
                </span>
              ))}
            </div>
          )}
          <div className="mt-2 mb-0.5 text-muted-foreground">unlocks ({data.unlocks.length})</div>
          {data.unlocks.length ? (
            <div className="max-h-48 space-y-0.5 overflow-auto">
              {data.unlocks.map((u) => (
                <div key={u.name} className="flex items-center gap-1.5">
                  <Icon kind="recipe" name={u.name} size="sm" />
                  <span className="truncate">{u.display ?? u.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground">— no recipe unlocks</div>
          )}
        </>
      )}
    </div>
  );
}

export function TechHover({
  name,
  extraText,
  className,
  children,
}: {
  name: string;
  extraText?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      className={className}
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && typeof document !== "undefined" && (
        <CursorCard pos={pos} z={50}>
          <TechCard name={name} extraText={extraText} />
        </CursorCard>
      )}
    </div>
  );
}

/** Wraps a row; shows a floating RecipeCard near the cursor on hover. Portaled so
 * it escapes scroll/overflow containers. */
export function RecipeHover({
  name,
  extraText,
  className,
  children,
}: {
  name: string;
  extraText?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      className={className}
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && typeof document !== "undefined" && (
        <CursorCard pos={pos} z={50}>
          <RecipeCard name={name} extraText={extraText} />
        </CursorCard>
      )}
    </div>
  );
}

const fmtJ = (j: number) =>
  j >= 1e9
    ? `${(j / 1e9).toFixed(1)} GJ`
    : j >= 1e6
      ? `${(j / 1e6).toFixed(1)} MJ`
      : `${(j / 1e3).toFixed(0)} kJ`;
const fmtCost = (c: number) =>
  c >= 1e6
    ? `${(c / 1e6).toFixed(1)}M`
    : c >= 1e3
      ? `${(c / 1e3).toFixed(1)}k`
      : c >= 10
        ? c.toFixed(0)
        : c.toFixed(2);

/** Styled hover card for an item/fluid: identity, stack/fuel facts, cost, and
 * how connected it is (produced by / used in). */
export function ItemCard({
  name,
  kind,
  extraText,
}: {
  name: string;
  kind: "item" | "fluid";
  /** Context supplied by the surface that opened this otherwise shared card. */
  extraText?: React.ReactNode;
}) {
  const { data } = useQuery({
    queryKey: ["item", name],
    queryFn: () => itemDetailFn({ data: name }),
    staleTime: 60_000,
  });
  const display = data?.item?.display ?? data?.fluid?.display ?? name;
  return (
    <div className="w-96 border border-border bg-popover p-3 text-sm text-popover-foreground shadow-xl">
      <div className="flex items-center gap-2 text-base font-semibold">
        <Icon kind={kind} name={name} size="md" noTitle />
        <span className="truncate">{display}</span>
        {data?.cost != null && (
          <span className="ml-auto font-normal text-muted-foreground" title="cost analysis">
            ¥{fmtCost(data.cost)}
          </span>
        )}
      </div>
      <div className="truncate text-sm text-muted-foreground">
        {name} · {kind}
      </div>
      <HoverContext>{extraText}</HoverContext>
      {!data ? (
        <div className="mt-1.5 space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-4 w-44" />
        </div>
      ) : (
        <div className="mt-1.5 space-y-0.5 text-muted-foreground">
          {data.item?.stackSize != null && <div>stack {data.item.stackSize}</div>}
          {data.item?.fuelValueJ != null && (
            <div className="flex items-center gap-1">
              <Flame className="size-3.5 shrink-0" /> {fmtJ(data.item.fuelValueJ)} (
              {data.item.fuelCategory}){data.item.burntResult && ` → ${data.item.burntResult}`}
            </div>
          )}
          {data.fluid?.fuelValueJ != null && (
            <div className="flex items-center gap-1">
              <Flame className="size-3.5 shrink-0" /> {fmtJ(data.fluid.fuelValueJ)}/unit
            </div>
          )}
          {data.fluid?.defaultTemperature != null && (
            <div>default {data.fluid.defaultTemperature}°</div>
          )}
          {data.item?.spoilResult && (
            <div className="flex items-center gap-1">
              <Timer className="size-3.5 text-warning" />
              spoils
              {data.item.spoilTicks != null ? ` in ${fmtSpoilTime(data.item.spoilTicks)}` : ""} →{" "}
              {data.spoilResultDisplay ?? data.item.spoilResult}
            </div>
          )}
          <RecipeList
            label="produced by"
            recipes={data.producedBy}
            empty="nothing makes this (raw)"
          />
          <RecipeList label="used in" recipes={data.consumedBy} empty="nothing uses this" />
        </div>
      )}
    </div>
  );
}

/** Compact recipe list for the item tooltip — so you can see at a glance whether
 * a good is used elsewhere (import it) or only here (build it local). */
function RecipeList({
  label,
  recipes,
  empty,
}: {
  label: string;
  recipes: { name: string; display: string | null }[];
  empty: string;
}) {
  const CAP = 7;
  return (
    <div className="mt-1.5">
      <FieldLabel className="text-muted-foreground/70">
        {label} {recipes.length > 0 && `(${recipes.length})`}
      </FieldLabel>
      {recipes.length === 0 ? (
        <div className="text-sm italic text-muted-foreground/60">{empty}</div>
      ) : (
        <div className="mt-0.5 flex flex-col gap-0.5">
          {recipes.slice(0, CAP).map((r) => (
            <div key={r.name} className="flex min-w-0 items-center gap-1.5">
              <Icon kind="recipe" name={r.name} size="sm" noTitle />
              <span className="truncate text-foreground/90">{r.display ?? r.name}</span>
            </div>
          ))}
          {recipes.length > CAP && (
            <div className="text-xs text-muted-foreground/70">+{recipes.length - CAP} more…</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Recipe comparison ─────────────────────────────────────────────────────────
 * Side-by-side diff of two recipes — what a TURD swap or a Py recipe tier actually
 * changes: which inputs/outputs are added, dropped, or re-sized, plus time. */

type RecipeComp = Parameters<typeof Comp>[0];
// products (not ingredients) additionally carry this — the AMOUNT of the output
// that is catalytic (barrels/catalyst returns), which productivity never scales (#93).
type DiffInput = RecipeComp & { ignoredByProductivity?: number | null };
// Always-on module effects a TURD choice grants; applied to the chosen recipe's
// output rate (speed scales all outputs, productivity skips ignored ones).
type RateBonus = { speed: number; prod: number };

const compAmount = (c: RecipeComp) =>
  c.amount ?? (c.amountMin != null && c.amountMax != null ? (c.amountMin + c.amountMax) / 2 : 0);

const fmtAmount = formatQty; // adaptive precision (#74)

const fmtRate = formatRate;

type DiffCell = {
  kind: string;
  name: string;
  display?: string | null;
  amount: number;
  rate: number | null; // per-second base output, 1 building at 1× speed; null for inputs
};

/** Map a recipe's inputs/outputs by good, tagging each with its per-second rate
 * (only meaningful for outputs, where amount ÷ crafting time is the yield). `bonus`
 * is the chosen recipe's always-on module effects: speed scales every output,
 * productivity only the non-ignored ones (barrels/catalysts don't get duplicated).
 * Pass null for the base side (or a recipe the module doesn't touch). */
function ioByName(
  comps: DiffInput[],
  time: number,
  withRate: boolean,
  bonus: RateBonus | null,
): Map<string, DiffCell> {
  const m = new Map<string, DiffCell>();
  for (const c of comps) {
    let rate: number | null = null;
    if (withRate && time > 0) {
      const speedMult = bonus ? 1 + bonus.speed : 1;
      // productivity scales only the non-ignored part of the output (#93)
      const amount = bonus
        ? prodScaledAmount(compAmount(c), 1 + bonus.prod, c.ignoredByProductivity)
        : compAmount(c);
      rate = ((amount * (c.probability ?? 1)) / time) * speedMult;
    }
    m.set(c.name, { kind: c.kind, name: c.name, display: c.display, amount: compAmount(c), rate });
  }
  return m;
}

// Conventional diff coloring — read at a glance regardless of in/out: added is
// green, removed is red, a resized amount is amber. (Whether a change is *good* is
// conveyed separately by the output-rate line, which greens/reds by direction.)
const DIFF_TONE = {
  added: "text-success",
  removed: "text-destructive",
  changed: "text-warning",
  same: "text-muted-foreground",
};

/** One diffed input/output line: the good, its amount delta, and — for outputs —
 * the base /s rate delta (colored by whether throughput went up or down). */
function DiffRow({ before, after }: { before: DiffCell | null; after: DiffCell | null }) {
  const row = before ?? after!;
  const status = !before
    ? "added"
    : !after
      ? "removed"
      : before.amount !== after.amount
        ? "changed"
        : "same";
  const amountBody =
    status === "added" ? (
      <span>+{fmtAmount(after!.amount)}</span>
    ) : status === "removed" ? (
      <span>−{fmtAmount(before!.amount)}</span>
    ) : status === "changed" ? (
      <span>
        {fmtAmount(before!.amount)} <span className="text-muted-foreground">→</span>{" "}
        {fmtAmount(after!.amount)}
      </span>
    ) : (
      <span>{fmtAmount(before!.amount)}</span>
    );
  const rb = before?.rate ?? null;
  const ra = after?.rate ?? null;
  const hasRate = rb != null || ra != null;
  const rateUp = rb != null && ra != null ? (ra > rb ? 1 : ra < rb ? -1 : 0) : ra != null ? 1 : -1;
  const rateTone =
    rateUp > 0 ? "text-success" : rateUp < 0 ? "text-destructive" : "text-muted-foreground";
  // % change in throughput when both sides have a rate (e.g. same yield but faster)
  const pctStr =
    rb != null && ra != null && rb > 0 && ra !== rb
      ? ` (${ra > rb ? "+" : ""}${Math.round(((ra - rb) / rb) * 100)}%)`
      : "";
  return (
    <div className="flex items-start gap-1.5 py-0.5">
      <Icon kind={row.kind as "item" | "fluid"} name={row.name} size="md" />
      <span className="min-w-0 flex-1 truncate text-foreground/90">{row.display ?? row.name}</span>
      <span className="shrink-0 text-right">
        <span className={`block tabular-nums ${DIFF_TONE[status]}`}>{amountBody}</span>
        {hasRate && (
          <span className={`block text-xs tabular-nums ${rateTone}`}>
            {rb != null && ra != null && rb !== ra
              ? `${fmtRate(rb)} → ${fmtRate(ra)}${pctStr}`
              : ra != null && rb == null
                ? `+${fmtRate(ra)}`
                : ra == null && rb != null
                  ? `−${fmtRate(rb)}`
                  : fmtRate(ra ?? rb!)}
          </span>
        )}
      </span>
    </div>
  );
}

function DiffGroup({
  label,
  a,
  b,
  timeA,
  timeB,
  rate,
  bonusB = null,
}: {
  label: string;
  a: DiffInput[];
  b: DiffInput[];
  timeA: number;
  timeB: number;
  rate: boolean;
  bonusB?: RateBonus | null;
}) {
  const am = ioByName(a, timeA, rate, null);
  const bm = ioByName(b, timeB, rate, bonusB);
  const names = [...new Set([...am.keys(), ...bm.keys()])];
  const rank = (n: string) => {
    const x = am.get(n);
    const y = bm.get(n);
    if (!x || !y) return 0; // added/removed first
    return x.amount !== y.amount ? 1 : 2; // then resized, then unchanged
  };
  names.sort((p, q) => rank(p) - rank(q) || p.localeCompare(q));
  return (
    <div>
      <div className="mb-0.5 text-muted-foreground">{label}</div>
      {names.length === 0 ? (
        <div className="text-muted-foreground">—</div>
      ) : (
        names.map((n) => <DiffRow key={n} before={am.get(n) ?? null} after={bm.get(n) ?? null} />)
      )}
    </div>
  );
}

/** Compare two recipes (a = base/old tier, b = upgraded/new tier). `bonus` is the
 * chosen recipe's always-on module effects (a TURD choice's +prod/±speed), applied
 * to side b's output rate — pass it only when the module actually affects this
 * recipe (i.e. NOT a recipe that just builds a building; see turd.tsx). */
export function RecipeDiffCard({ a, b, bonus }: { a: string; b: string; bonus?: RateBonus }) {
  const qa = useQuery({
    queryKey: ["recipe", a],
    queryFn: () => recipeDetailFn({ data: a }),
    staleTime: 60_000,
  });
  const qb = useQuery({
    queryKey: ["recipe", b],
    queryFn: () => recipeDetailFn({ data: b }),
    staleTime: 60_000,
  });
  const ra = qa.data?.recipe;
  const rb = qb.data?.recipe;
  return (
    <div className="w-[32rem] border border-border bg-popover p-3 text-sm text-popover-foreground shadow-xl">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon kind="recipe" name={a} size="sm" />
        <span className="min-w-0 truncate">{ra?.display ?? a}</span>
        <span className="shrink-0 text-muted-foreground">→</span>
        <Icon kind="recipe" name={b} size="sm" />
        <span className="min-w-0 truncate">{rb?.display ?? b}</span>
      </div>
      {!ra || !rb ? (
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : (
        (() => {
          const ta = ra.energyRequired ?? 0;
          const tb = rb.energyRequired ?? 0;
          const bonusParts = [
            bonus?.prod ? `${bonus.prod > 0 ? "+" : ""}${Math.round(bonus.prod * 100)}% prod` : "",
            bonus?.speed
              ? `${bonus.speed > 0 ? "+" : ""}${Math.round(bonus.speed * 100)}% speed`
              : "",
          ].filter(Boolean);
          return (
            <>
              {ta !== tb && (
                <div className="mt-1 flex items-center gap-1">
                  <Timer className="size-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">{ta}s</span>
                  <span className="text-muted-foreground">→</span>
                  <span className={tb < ta ? "text-success" : "text-destructive"}>{tb}s</span>
                  <span className="text-xs text-muted-foreground">
                    ({tb < ta ? "faster" : "slower"})
                  </span>
                </div>
              )}
              <div className="mt-2 grid grid-cols-2 gap-3">
                <DiffGroup
                  label="in"
                  a={ra.ingredients}
                  b={rb.ingredients}
                  timeA={ta}
                  timeB={tb}
                  rate={false}
                />
                <DiffGroup
                  label="out (/s per building)"
                  a={ra.products}
                  b={rb.products}
                  timeA={ta}
                  timeB={tb}
                  rate
                  bonusB={bonus ?? null}
                />
              </div>
              {bonusParts.length > 0 && (
                <div className="mt-1.5 text-sm text-muted-foreground">
                  out /s includes this choice&apos;s module ({bonusParts.join(", ")}); productivity
                  skips barrels &amp; catalysts
                </div>
              )}
            </>
          );
        })()
      )}
    </div>
  );
}

/** Wraps a trigger; shows a floating RecipeDiffCard near the cursor on hover. */
export function RecipeDiffHover({
  a,
  b,
  bonus,
  className,
  children,
}: {
  a: string;
  b: string;
  bonus?: RateBonus;
  className?: string;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      className={className}
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && typeof document !== "undefined" && (
        <CursorCard pos={pos} z={50}>
          <RecipeDiffCard a={a} b={b} bonus={bonus} />
        </CursorCard>
      )}
    </div>
  );
}

/** Hover wrapper showing an ItemCard near the cursor (portaled, like RecipeHover). */
export function ItemHover({
  name,
  kind,
  extraText,
  className,
  children,
}: {
  name: string;
  kind: "item" | "fluid";
  extraText?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      className={className}
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && typeof document !== "undefined" && (
        <CursorCard pos={pos} z={60}>
          <ItemCard name={name} kind={kind} extraText={extraText} />
        </CursorCard>
      )}
    </span>
  );
}

const fmtW = (w: number) =>
  w >= 1e6 ? `${(w / 1e6).toFixed(1)} MW` : w >= 1e3 ? `${(w / 1e3).toFixed(0)} kW` : `${w} W`;
// compact number for speeds — the shared adaptive formatter (#74)
const fmtNum = formatQty;

/** Hover card for a placeable entity — crafting machine, mining drill, or beacon:
 * its throughput (crafting/mining speed or beacon effectivity), module slots,
 * power draw + energy source, and (for machines) the recipe categories it runs.
 * Falls back to item facts (stack/fuel/cost) since most entities are also items. */
export function EntityCard({ name, extraText }: { name: string; extraText?: React.ReactNode }) {
  const { data } = useQuery({
    queryKey: ["entity", name],
    queryFn: () => entityDetailFn({ data: name }),
    staleTime: 60_000,
  });
  const display = data?.display ?? name;
  const rows: React.ReactNode[] = [];
  if (data?.machine) {
    const mc = data.machine;
    rows.push(<div key="speed">{fmtNum(mc.craftingSpeed)}× crafting speed</div>);
    if (mc.moduleSlots > 0) rows.push(<div key="slots">{mc.moduleSlots} module slots</div>);
    if (mc.energyUsageW != null)
      rows.push(
        <div key="power" className="flex items-center gap-1">
          <Zap className="size-3.5 shrink-0 text-warning" />
          {fmtW(mc.energyUsageW)}
          {mc.energySource ? ` · ${mc.energySource}` : ""}
        </div>,
      );
    if (mc.categories.length)
      rows.push(
        <div key="cats" className="text-sm">
          crafts: {mc.categories.join(", ")}
        </div>,
      );
  }
  if (data?.drill) {
    const d = data.drill;
    rows.push(<div key="mine">{fmtNum(d.miningSpeed)}× mining speed</div>);
    if (d.moduleSlots > 0) rows.push(<div key="dslots">{d.moduleSlots} module slots</div>);
    if (d.energyUsageW != null)
      rows.push(
        <div key="dpower" className="flex items-center gap-1">
          <Zap className="size-3.5 shrink-0 text-warning" />
          {fmtW(d.energyUsageW)}
          {d.energySource ? ` · ${d.energySource}` : ""}
        </div>,
      );
  }
  if (data?.beacon) {
    const b = data.beacon;
    if (b.distributionEffectivity != null)
      rows.push(
        <div key="eff" className="flex items-center gap-1">
          <Bolt className="size-3.5 shrink-0 text-info" />
          {Math.round(b.distributionEffectivity * 100)}% module effect
        </div>,
      );
    if (b.moduleSlots > 0) rows.push(<div key="bslots">{b.moduleSlots} module slots</div>);
    if (b.energyUsageW != null)
      rows.push(
        <div key="bpower" className="flex items-center gap-1">
          <Zap className="size-3.5 shrink-0 text-warning" />
          {fmtW(b.energyUsageW)}
        </div>,
      );
  }
  if (data?.item?.fuelValueJ != null)
    rows.push(
      <div key="fuel" className="flex items-center gap-1">
        <Flame className="size-3.5 shrink-0" /> {fmtJ(data.item.fuelValueJ)} (
        {data.item.fuelCategory})
      </div>,
    );
  if (data?.item?.stackSize != null) rows.push(<div key="stack">stack {data.item.stackSize}</div>);
  return (
    <div className="w-80 border border-border bg-popover p-3 text-sm text-popover-foreground shadow-xl">
      <div className="flex items-center gap-2 text-base font-semibold">
        <Icon kind="entity" name={name} size="md" noTitle />
        <span className="truncate">{display}</span>
        {data?.cost != null && (
          <span className="ml-auto font-normal text-muted-foreground" title="cost analysis">
            ¥{fmtCost(data.cost)}
          </span>
        )}
      </div>
      <div className="truncate text-sm text-muted-foreground">
        {name} ·{" "}
        {data?.machine?.kind ?? (data?.drill ? "mining-drill" : data?.beacon ? "beacon" : "entity")}
      </div>
      <HoverContext>{extraText}</HoverContext>
      {!data ? (
        <div className="mt-1.5 space-y-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-52" />
        </div>
      ) : rows.length ? (
        <div className="mt-1.5 space-y-0.5 text-muted-foreground">{rows}</div>
      ) : (
        <div className="mt-1.5 text-sm italic text-muted-foreground/60">no extra detail</div>
      )}
    </div>
  );
}

/** Wraps a row; shows a floating EntityCard near the cursor on hover. */
export function EntityHover({
  name,
  extraText,
  className,
  children,
}: {
  name: string;
  extraText?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      className={className}
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && typeof document !== "undefined" && (
        <CursorCard pos={pos} z={60}>
          <EntityCard name={name} extraText={extraText} />
        </CursorCard>
      )}
    </span>
  );
}

/** The default rich hover for any game icon: dispatches to the right card by
 * `kind`. `Icon` (in icons.tsx) wraps every sprite in this unless `noHover` is
 * set. The wrapper is layout-neutral (inline-flex, middle-aligned). */
export function GoodHover({
  kind,
  name,
  extraText,
  className,
  children,
}: {
  kind: "item" | "fluid" | "recipe" | "entity" | "technology";
  name: string;
  /** Caller context rendered inside the shared rich card. */
  extraText?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const card =
    kind === "recipe" ? (
      <RecipeCard name={name} extraText={extraText} />
    ) : kind === "technology" ? (
      <TechCard name={name} extraText={extraText} />
    ) : kind === "entity" ? (
      <EntityCard name={name} extraText={extraText} />
    ) : (
      <ItemCard name={name} kind={kind} extraText={extraText} />
    );
  return (
    <CursorHover card={card} className={className} z={60}>
      {children}
    </CursorHover>
  );
}

/** Tech requirement line: icon, name, tightly-stacked science pack icons.
 * Red = required research (assumed unresearched until the game sync lands);
 * pass `researched` to render it as satisfied. */
export function TechLine({
  unlock,
  more = 0,
  researched = false,
}: {
  unlock: { tech: string; display: string | null; science: { name: string; amount: number }[] };
  more?: number;
  researched?: boolean;
}) {
  return (
    <Tooltip
      content={
        (researched ? "researched: " : "requires research: ") +
        (unlock.display ?? unlock.tech) +
        (unlock.science.length
          ? ` (${unlock.science.map((s) => `${s.amount}× ${s.name}`).join(", ")})`
          : "")
      }
    >
      <span
        className={`flex flex-wrap items-center gap-1.5 text-sm ${researched ? "text-success" : "text-destructive/90"}`}
      >
        <Icon kind="technology" name={unlock.tech} size="sm" noTitle />
        <span>{unlock.display ?? unlock.tech}</span>
        <span className="flex items-center -space-x-1">
          {unlock.science.map((s) => (
            <Icon key={s.name} kind="item" name={s.name} size="sm" noTitle />
          ))}
        </span>
        {more > 0 && <span className="text-muted-foreground">+{more} alt</span>}
      </span>
    </Tooltip>
  );
}
