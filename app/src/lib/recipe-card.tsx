import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Flame, Timer } from "lucide-react";
import { itemDetailFn, recipeDetailFn, techDetailFn } from "../server/factorio";
import { Icon, fmtSpoilTime } from "./icons";

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
        {c.temperature != null && <span className="text-sky-400"> @{c.temperature}°</span>}
        {c.kind === "fluid" && (c.minTemp != null || c.maxTemp != null) && (
          <span className="text-sky-400">
            {" "}
            [{c.minTemp ?? ""}…{c.maxTemp ?? ""}°]
          </span>
        )}
        {c.probability != null && c.probability < 1 && (
          <span className="text-amber-400"> p={c.probability}</span>
        )}
      </span>
    </div>
  );
}

export function RecipeCard({ name }: { name: string }) {
  const { data } = useQuery({
    queryKey: ["recipe", name],
    queryFn: () => recipeDetailFn({ data: name }),
    staleTime: 60_000,
  });
  const r = data?.recipe;
  return (
    <div className="w-[26rem] rounded border border-border bg-popover p-3 text-sm text-popover-foreground shadow-xl">
      <div className="flex items-center gap-2 text-base font-semibold">
        <Icon kind="recipe" name={name} size="md" />
        <span className="truncate">{r?.display ?? name}</span>
      </div>
      <div className="mb-2 truncate text-sm text-muted-foreground">{name}</div>
      {!r ? (
        <div className="text-muted-foreground">…</div>
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
export function TechCard({ name }: { name: string }) {
  const { data } = useQuery({
    queryKey: ["tech", name],
    queryFn: () => techDetailFn({ data: name }),
    staleTime: 60_000,
  });
  return (
    <div className="w-[26rem] rounded border border-border bg-popover p-3 text-sm text-popover-foreground shadow-xl">
      <div className="flex items-center gap-2 text-base font-semibold">
        <Icon kind="technology" name={name} size="md" />
        <span className="truncate">{data?.display ?? name}</span>
      </div>
      {!data ? (
        <div className="text-muted-foreground">…</div>
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

/** Wraps a row; shows a floating TechCard near the cursor on hover (portaled). */
export function TechHover({
  name,
  className,
  children,
}: {
  name: string;
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
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: Math.min(pos.x + 16, window.innerWidth - 432),
              top: Math.min(pos.y + 16, window.innerHeight - 360),
              zIndex: 50,
              pointerEvents: "none",
            }}
          >
            <TechCard name={name} />
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Wraps a row; shows a floating RecipeCard near the cursor on hover. Portaled so
 * it escapes scroll/overflow containers. */
export function RecipeHover({
  name,
  className,
  children,
}: {
  name: string;
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
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: Math.min(pos.x + 16, window.innerWidth - 432),
              top: Math.min(pos.y + 16, window.innerHeight - 320),
              zIndex: 50,
              pointerEvents: "none",
            }}
          >
            <RecipeCard name={name} />
          </div>,
          document.body,
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
export function ItemCard({ name, kind }: { name: string; kind: "item" | "fluid" }) {
  const { data } = useQuery({
    queryKey: ["item", name],
    queryFn: () => itemDetailFn({ data: name }),
    staleTime: 60_000,
  });
  const display = data?.item?.display ?? data?.fluid?.display ?? name;
  return (
    <div className="w-96 rounded border border-border bg-popover p-3 text-sm text-popover-foreground shadow-xl">
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
      {!data ? (
        <div className="text-muted-foreground">…</div>
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
              <Timer className="size-3.5 text-amber-400" />
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
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {label} {recipes.length > 0 && `(${recipes.length})`}
      </div>
      {recipes.length === 0 ? (
        <div className="text-xs italic text-muted-foreground/60">{empty}</div>
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

/** Hover wrapper showing an ItemCard near the cursor (portaled, like RecipeHover). */
export function ItemHover({
  name,
  kind,
  className,
  children,
}: {
  name: string;
  kind: "item" | "fluid";
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
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: Math.min(pos.x + 16, window.innerWidth - 400),
              top: Math.max(8, Math.min(pos.y + 16, window.innerHeight - 480)),
              zIndex: 60,
              pointerEvents: "none",
            }}
          >
            <ItemCard name={name} kind={kind} />
          </div>,
          document.body,
        )}
    </span>
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
    <span
      className={`flex flex-wrap items-center gap-1.5 text-sm ${researched ? "text-emerald-300" : "text-red-400/90"}`}
      title={
        (researched ? "researched: " : "requires research: ") +
        (unlock.display ?? unlock.tech) +
        (unlock.science.length
          ? ` (${unlock.science.map((s) => `${s.amount}× ${s.name}`).join(", ")})`
          : "")
      }
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
  );
}
