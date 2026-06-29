import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { listTurdUpgradesFn, setTurdSelectionFn, turdSyncStatusFn } from "../server/factorio";
import { Icon, IconProvider } from "../lib/icons";
import { Badge } from "#/components/ui/badge.tsx";
import { Card } from "#/components/ui/card.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";
import { Input } from "#/components/ui/input.tsx";
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

function subEffectSummary(s: {
  modules: { effSpeed: number; effProductivity: number; effConsumption: number }[];
  unlocks: string[];
}): string[] {
  const out: string[] = [];
  // per-tier modules share the intent; summarize from the lowest tier
  const m = s.modules[0];
  if (m) {
    if (m.effSpeed) out.push(`${pct(m.effSpeed)} speed${s.modules.length > 1 ? " (mk01)" : ""}`);
    if (m.effProductivity) out.push(`${pct(m.effProductivity)} productivity`);
    if (m.effConsumption) out.push(`${pct(m.effConsumption)} energy`);
  }
  if (s.unlocks.length) out.push(`${s.unlocks.length} recipe${s.unlocks.length > 1 ? "s" : ""}`);
  return out;
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

  const list = (upgrades.data ?? []).filter(
    (u) =>
      u.display.toLowerCase().includes(search.toLowerCase()) ||
      u.subTechs.some((s) => s.display.toLowerCase().includes(search.toLowerCase())),
  );
  const chosen = (upgrades.data ?? []).filter((u) => u.selected).length;

  return (
    <div className="p-4 font-mono text-foreground">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold">TURD upgrades</h1>
        <span className="text-sm text-muted-foreground">
          {chosen}/{upgrades.data?.length ?? 0} chosen
        </span>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="filter upgrades…"
          className="w-64"
        />
        {select.isPending && <span className="text-sm text-amber-300">re-solving blocks…</span>}
        {select.data && !select.isPending && (
          <span className="text-sm text-muted-foreground">
            re-solved {select.data.resolved} block(s)
          </span>
        )}
        {sync.data?.syncedAt && (
          <span
            className="inline-flex items-center gap-1 text-sm text-emerald-300"
            title={`pushed from the game ${timeAgo(sync.data.syncedAt)}`}
          >
            <Check className="size-3.5" /> live: {sync.data.syncedCount ?? 0} synced (
            {timeAgo(sync.data.syncedAt)})
            {sync.data.unknown.length > 0 && (
              <span
                className="ml-1 text-amber-300"
                title={sync.data.unknown.map((u) => `${u.master} → ${u.sub}`).join("\n")}
              >
                · {sync.data.unknown.length} unmatched
              </span>
            )}
          </span>
        )}
        <div className="ml-auto">
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
        </div>
      </div>

      {upgrades.isLoading && <div className="text-muted-foreground">loading…</div>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {list.map((u) => (
          <Card key={u.name} className="p-3">
            <div className="mb-2 flex items-center gap-2">
              <Icon kind="technology" name={u.name} size="md" title={u.display} />
              <span className="font-semibold">{u.display}</span>
              <span className="ml-auto flex items-center gap-1">
                {u.science.map((s) => (
                  <Icon key={s.name} kind="item" name={s.name} size="sm" title={s.display} />
                ))}
              </span>
            </div>
            <div className="space-y-1.5">
              {u.subTechs.map((s) => {
                const sel = u.selected === s.name;
                return (
                  <button
                    key={s.name}
                    disabled={select.isPending}
                    onClick={() =>
                      select.mutate({ masterTech: u.name, subTech: sel ? null : s.name })
                    }
                    title={sel ? "selected — click to clear" : "click to select this upgrade path"}
                    className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-sm ${
                      sel
                        ? "border-emerald-400/60 bg-emerald-500/15"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <Icon kind="technology" name={s.name} size="md" title={s.display} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${sel ? "text-emerald-200" : ""}`}>
                        {s.display}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {subEffectSummary(s).map((fx) => (
                          <Badge key={fx} variant="secondary" className="text-xs">
                            {fx}
                          </Badge>
                        ))}
                      </span>
                    </span>
                    {sel && <Check className="size-4 shrink-0 text-emerald-300" />}
                  </button>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
