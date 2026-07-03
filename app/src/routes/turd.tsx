import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Plus } from "lucide-react";
import { listTurdUpgradesFn, setTurdSelectionFn, turdSyncStatusFn } from "../server/factorio";
import { Icon, IconProvider } from "../lib/icons";
import { RecipeDiffHover, RecipeHover } from "../lib/recipe-card";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card } from "#/components/ui/card.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { FilterEmptyState } from "#/components/filter-empty-state.tsx";
import { FilterInput } from "#/components/filter-input.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { useFilteredList } from "../lib/use-filtered-list";
import { useState } from "react";

export const Route = createFileRoute("/turd")({
  component: () => (
    <IconProvider>
      <TurdPage />
    </IconProvider>
  ),
});

const pct = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`;

function timeAgo(iso: string): string {
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago`;
}

type TurdChange = {
  from: string | null;
  fromDisplay: string | null;
  to: string;
  toDisplay: string;
  buildsBuilding: boolean;
};
/** A choice's always-on module effects, applied to swap-recipe throughput. */
type RateBonus = { speed: number; prod: number };
type SubTech = {
  name: string;
  display: string;
  description: string;
  changes: TurdChange[];
  modules: { effSpeed: number; effProductivity: number; effConsumption: number }[];
};

/** The always-on module effects a choice grants (summarized from the lowest tier).
 * Recipe changes are shown explicitly below, not folded into a bare count. Each
 * effect is color-coded by kind so speed/productivity/energy stand out. */
type Effect = { label: string; className: string };
function subEffectSummary(s: Pick<SubTech, "modules">): Effect[] {
  const out: Effect[] = [];
  const m = s.modules[0];
  const suffix = s.modules.length > 1 ? " (mk01)" : "";
  if (m) {
    if (m.effSpeed)
      out.push({
        label: `${pct(m.effSpeed)} speed${suffix}`,
        className: "border-info/40 bg-info/15 text-info",
      });
    if (m.effProductivity)
      out.push({
        label: `${pct(m.effProductivity)} productivity${suffix}`,
        className: "border-success/40 bg-success/15 text-success",
      });
    if (m.effConsumption)
      out.push({
        label: `${pct(m.effConsumption)} energy${suffix}`,
        className: "border-warning/40 bg-warning/15 text-warning",
      });
  }
  return out;
}

/** One recipe change a choice makes — a swap (old→new, hover for the full diff) or
 * a brand-new unlock (hover for the recipe). This is what "5 recipes" now expands
 * to: exactly which recipes, and what actually changes. */
function ChangeRow({ change: c, moduleBonus }: { change: TurdChange; moduleBonus?: RateBonus }) {
  if (c.from) {
    // the module boosts recipes the affected building RUNS — not a recipe that just
    // builds a building, so skip the bonus there (its rate stays pure recipe math)
    const bonus = c.buildsBuilding ? undefined : moduleBonus;
    return (
      <RecipeDiffHover
        a={c.from}
        b={c.to}
        bonus={bonus}
        className="flex min-w-0 cursor-help items-center gap-1.5"
      >
        <Icon kind="recipe" name={c.from} size="sm" noTitle />
        <span className="truncate text-muted-foreground line-through">{c.fromDisplay}</span>
        <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
        <Icon kind="recipe" name={c.to} size="sm" noTitle />
        <span className="truncate">{c.toDisplay}</span>
      </RecipeDiffHover>
    );
  }
  return (
    <RecipeHover name={c.to} className="flex min-w-0 cursor-help items-center gap-1.5">
      <Plus className="size-3 shrink-0 text-success" />
      <Icon kind="recipe" name={c.to} size="sm" noHover />
      <span className="truncate">{c.toDisplay}</span>
      <span className="shrink-0 text-xs text-muted-foreground">new</span>
    </RecipeHover>
  );
}

/** The expandable body under a choice: its flavor description and the concrete
 * recipe changes it makes. */
function ChoiceDetails({ s }: { s: SubTech }) {
  if (!s.description && s.changes.length === 0) return null;
  // the choice's always-on module (lowest tier) boosts the recipes it runs in the
  // affected buildings; ChangeRow applies it to each swap that isn't a building recipe
  const m = s.modules[0];
  const moduleBonus: RateBonus | undefined = m
    ? { speed: m.effSpeed, prod: m.effProductivity }
    : undefined;
  return (
    <div className="space-y-1.5 border-t border-border/50 px-2 py-1.5">
      {s.description && (
        <p className="text-sm leading-relaxed text-muted-foreground">{s.description}</p>
      )}
      {s.changes.length > 0 && (
        <div className="flex flex-col gap-1 text-sm">
          {s.changes.map((c) => (
            <ChangeRow key={c.to} change={c} moduleBonus={moduleBonus} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Pyanodon TURD board: one selectable sub-tech per master upgrade. Click a
 * choice to select it (re-solves every cached block); click again to clear. */
function TurdPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const upgrades = useQuery({ queryKey: ["turd"], queryFn: () => listTurdUpgradesFn() });
  const sync = useQuery({
    queryKey: ["turd-sync"],
    queryFn: () => turdSyncStatusFn(),
    refetchInterval: 4000,
  });
  const select = useMutation({
    mutationFn: (d: { masterTech: string; subTech: string | null }) =>
      setTurdSelectionFn({ data: d }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["turd"] });
      void qc.invalidateQueries({ queryKey: ["solve"] });
      void qc.invalidateQueries({ queryKey: ["blocks"] });
    },
  });

  // a master matches when it or any of its branches does; internal tech names
  // are the hidden fallback (useful when pasting a raw name from a doc/issue)
  const list = useFilteredList(upgrades.data ?? [], search, {
    display: (u) => [u.display, ...u.subTechs.map((s) => s.display)],
    internal: (u) => [u.name, ...u.subTechs.map((s) => s.name)],
  });
  const chosen = (upgrades.data ?? []).filter((u) => u.selected).length;

  return (
    <div className="p-4 font-mono text-foreground">
      <PageHeader
        title="TURD upgrades"
        description={`${chosen}/${upgrades.data?.length ?? 0} chosen`}
        actions={
          <HelpButton title="What are TURD upgrades?">
            <p>
              <span className="text-foreground">TURD</span> is Pyanodons&apos; recipe-upgrade
              system: certain technologies offer a{" "}
              <span className="text-foreground">one-time choice</span> between mutually-exclusive
              recipe branches. Picking one swaps in its (usually better or quite different) recipes
              — and it&apos;s effectively permanent, so it&apos;s a real planning decision.
            </p>
            <p>
              This page lists every TURD master and its options. Your actual in-game picks{" "}
              <span className="text-foreground">sync from the mod</span> (the{" "}
              <Check className="inline size-3.5" /> live badge); choosing one here re-solves every
              block that uses an affected recipe.
            </p>
            <div>
              <div className="font-semibold text-foreground">How PyOps treats it</div>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>
                  Planning <span className="text-foreground">&quot;Now&quot;</span> uses only
                  recipes you can build today — a branch you haven&apos;t picked is excluded until
                  you pick it.
                </li>
                <li>
                  Unpicked branches surface as{" "}
                  <span className="text-foreground">available upgrades</span> to consider, never
                  auto-applied — PyOps reflects your choices, it doesn&apos;t make them for you.
                </li>
              </ul>
            </div>
          </HelpButton>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <FilterInput
            value={search}
            onValueChange={setSearch}
            placeholder="filter upgrades…"
            className="w-64"
          />
          {select.isPending && <span className="text-sm text-warning">re-solving blocks…</span>}
          {select.data && !select.isPending && (
            <span className="text-sm text-muted-foreground">
              re-solved {select.data.resolved} block(s)
            </span>
          )}
          {sync.data?.syncedAt && (
            <span
              className="inline-flex items-center gap-1 text-sm text-success"
              title={`pushed from the game ${timeAgo(sync.data.syncedAt)}`}
            >
              <Check className="size-3.5" /> live: {sync.data.syncedCount ?? 0} synced (
              {timeAgo(sync.data.syncedAt)})
              {sync.data.unknown.length > 0 && (
                <span
                  className="ml-1 text-warning"
                  title={sync.data.unknown.map((u) => `${u.master} → ${u.sub}`).join("\n")}
                >
                  · {sync.data.unknown.length} unmatched
                </span>
              )}
            </span>
          )}
        </div>
      </PageHeader>

      {upgrades.isLoading && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      )}

      {!upgrades.isLoading && (upgrades.data?.length ?? 0) === 0 && (
        <EmptyState
          title="No TURD upgrades in this dataset"
          description="TURD is a Pyanodons mechanic — sync a mod set that includes it (e.g. pyalienlife) and its upgrades appear here. (This tab is hidden from the nav when there's no TURD data.)"
        />
      )}

      {!upgrades.isLoading && (upgrades.data?.length ?? 0) > 0 && list.length === 0 && (
        <FilterEmptyState query={search} onClear={() => setSearch("")} />
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {list.map((u) => (
          <Card key={u.name} className="p-3">
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <Icon kind="technology" name={u.name} size="md" title={u.display} />
              <span className="font-semibold">{u.display}</span>
              <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
                {u.science.map((s) => (
                  <Icon key={s.name} kind="item" name={s.name} size="sm" title={s.display} />
                ))}
              </span>
            </div>
            {u.description && (
              <p className="mb-2 text-sm leading-relaxed text-muted-foreground">{u.description}</p>
            )}
            <div className="space-y-1.5">
              {u.subTechs.map((s) => {
                const sel = u.selected === s.name;
                return (
                  <div
                    key={s.name}
                    className={`overflow-hidden border ${
                      sel ? "border-success/60 bg-success/10" : "border-border"
                    }`}
                  >
                    <Button
                      variant="ghost"
                      disabled={select.isPending}
                      aria-pressed={sel}
                      onClick={() =>
                        select.mutate({ masterTech: u.name, subTech: sel ? null : s.name })
                      }
                      title={
                        sel ? "selected — click to clear" : "click to select this upgrade path"
                      }
                      className={`h-auto w-full justify-start gap-2 px-2 py-1.5 text-left font-normal whitespace-normal ${
                        sel ? "hover:bg-transparent" : ""
                      }`}
                    >
                      <Icon kind="technology" name={s.name} size="md" title={s.display} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate ${sel ? "text-success" : ""}`}>
                          {s.display}
                        </span>
                        <span className="flex flex-wrap gap-1">
                          {subEffectSummary(s).map((fx) => (
                            <Badge
                              key={fx.label}
                              variant="outline"
                              className={fx.className}
                              title="Always-on module effect inserted into this upgrade's affected buildings — it boosts the recipes those buildings run, not the recipe swaps shown below."
                            >
                              {fx.label}
                            </Badge>
                          ))}
                        </span>
                      </span>
                      {sel && <Check className="size-4 shrink-0 text-success" />}
                    </Button>
                    <ChoiceDetails s={s} />
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
