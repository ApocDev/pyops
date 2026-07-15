import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check } from "lucide-react";
import {
  goodInfoFn,
  searchAllFn,
  searchTechsFn,
  setResearchHorizonFn,
  techDisplaysFn,
} from "../server/factorio";
import { researchHorizonSubscription } from "../lib/live-query-options";
import { Icon, IconProvider } from "../lib/icons";
import { TechHover } from "../lib/recipe-card";
import { InfoHint } from "./info-hint";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Input } from "#/components/ui/input.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Segmented } from "#/components/ui/segmented.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";

/** Look up display names for a set of goods (science packs etc.) — memoised by key. */
function useGoodDisplays(names: string[]) {
  const info = useQuery({
    queryKey: ["goodInfo", names],
    queryFn: () => goodInfoFn({ data: names }),
    enabled: names.length > 0,
    staleTime: 60_000,
  });
  return (name: string) => info.data?.[name]?.display ?? name;
}

type SaveArgs = {
  mode?: "now" | "future" | "target";
  packs?: string[];
  researched?: string[];
  target?: string | null;
  miningProductivityBonus?: number | null;
};

const MODE_OPTIONS = [
  { value: "now", label: "Now" },
  { value: "future", label: "Future" },
  { value: "target", label: "Up to target" },
] as const;

/** The planning-horizon control, shared by Settings and the header dialog. It owns
 * its own query/mutation so it can be dropped in anywhere. Changing it re-solves
 * blocks and refreshes recipe availability everywhere. */
export function HorizonPicker() {
  const qc = useQueryClient();
  const h = useQuery(researchHorizonSubscription);
  const save = useMutation({
    mutationFn: (d: SaveArgs) => setResearchHorizonFn({ data: d }),
    onSuccess: () => {
      // availability changed — refresh the horizon and everything derived from it
      for (const key of ["researchHorizon", "solve", "pick", "machineOpts"]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
  const packName = useGoodDisplays(h.data?.allPacks ?? []);
  const d = h.data;
  if (!d)
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  const togglePack = (p: string) =>
    save.mutate({ packs: d.packs.includes(p) ? d.packs.filter((x) => x !== p) : [...d.packs, p] });

  return (
    <IconProvider>
      <div className="space-y-4">
        <Segmented
          aria-label="Planning horizon mode"
          value={d.mode}
          onValueChange={(m) => save.mutate({ mode: m })}
          options={MODE_OPTIONS}
        />

        {d.syncedAt && (
          <div className="flex items-center gap-1.5 text-sm text-success">
            <Check className="size-3.5 shrink-0" /> Live · {d.syncedCount} techs synced
            {d.mode !== "now" && (
              <InfoHint content="Synced research only applies in Now mode." className="ml-0.5" />
            )}
          </div>
        )}

        {d.mode === "now" && (
          <>
            <section className="space-y-1.5 border-t border-border pt-3">
              <FieldLabel className="flex items-center gap-1.5">
                Science packs you produce
                <InfoHint content="A recipe counts as available when every science pack its research needs is ticked here." />
              </FieldLabel>
              <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-2">
                {d.allPacks.map((p) => (
                  <label key={p} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={d.packs.includes(p)} onCheckedChange={() => togglePack(p)} />
                    <Icon kind="item" name={p} size="sm" />
                    <span className="truncate">{packName(p)}</span>
                  </label>
                ))}
              </div>
            </section>
            <ResearchedPicker
              researched={d.researched}
              onSave={(r) => save.mutate({ researched: r })}
            />
            <section className="space-y-1.5 border-t border-border pt-3">
              <FieldLabel className="flex items-center gap-1.5">
                Mining productivity bonus
                <InfoHint content="Flat percent bonus applied to mining recipes. Leave blank to derive it from researched techs." />
              </FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  key={`mining-${d.miningProductivityBonus ?? "unset"}`}
                  aria-label="Mining productivity bonus percent"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={
                    d.miningProductivityBonus == null
                      ? ""
                      : formatPercent(d.miningProductivityBonus)
                  }
                  placeholder="Auto"
                  onBlur={(e) => {
                    const raw = e.currentTarget.value.trim();
                    if (raw === "") {
                      save.mutate({ miningProductivityBonus: null });
                      return;
                    }
                    const pct = Number(raw);
                    if (!Number.isFinite(pct) || pct < 0) {
                      e.currentTarget.value =
                        d.miningProductivityBonus == null
                          ? ""
                          : formatPercent(d.miningProductivityBonus);
                      return;
                    }
                    save.mutate({ miningProductivityBonus: pct / 100 });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <div className="text-sm text-muted-foreground">
                Mining:{" "}
                {d.miningProductivityBonus == null
                  ? "Auto"
                  : `+${formatPercent(d.miningProductivityBonus)}%`}{" "}
                · Recipe bonuses:{" "}
                {d.recipeProductivityBonusCount == null
                  ? "Auto"
                  : `${d.recipeProductivityBonusCount} synced`}
              </div>
            </section>
          </>
        )}

        {d.mode === "target" && (
          <TargetPicker
            target={d.target}
            targetDisplay={d.targetDisplay}
            targetTech={d.targetTech}
            targetTechDisplay={d.targetTechDisplay}
            packs={d.packs}
            onPick={(good) => save.mutate({ target: good })}
          />
        )}
      </div>
    </IconProvider>
  );
}

function formatPercent(value: number): string {
  return (Math.round(value * 1000) / 10).toString();
}

/** Search a good to plan up to; the resolved unlocking tech is shown so you can
 * confirm which tech gates it. */
function TargetPicker({
  target,
  targetDisplay,
  targetTech,
  targetTechDisplay,
  packs,
  onPick,
}: {
  target: string | null;
  targetDisplay: string | null;
  targetTech: string | null;
  targetTechDisplay: string | null;
  packs: string[];
  onPick: (good: string) => void;
}) {
  const [term, setTerm] = useState("");
  const results = useQuery({
    queryKey: ["bsearch", term],
    queryFn: () => searchAllFn({ data: term }),
    enabled: term.trim().length > 0,
  });
  const packName = useGoodDisplays(packs);

  return (
    <section className="space-y-2 border-t border-border pt-3">
      {target ? (
        <Callout tone="primary" icon={null} className="bg-primary/5 p-2.5">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Icon kind="item" name={target} size="lg" title={targetDisplay ?? target} />
              <div
                className="truncate font-semibold text-foreground"
                title={targetDisplay ?? target}
              >
                {targetDisplay ?? target}
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">Unlocked by</span>
              {targetTech ? (
                <TechHover name={targetTech} className="flex items-center gap-1.5">
                  <Icon kind="technology" name={targetTech} size="sm" noHover />
                  <span className="text-foreground underline decoration-dotted">
                    {targetTechDisplay ?? targetTech}
                  </span>
                </TechHover>
              ) : (
                <span className="text-warning">
                  No unlocking tech — start-craftable or unreachable
                </span>
              )}
            </div>
            {packs.length > 0 && (
              <div>
                <FieldLabel>Science packs allowed up to this tier ({packs.length})</FieldLabel>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {packs.map((p) => (
                    <Badge key={p}>
                      <Icon kind="item" name={p} size="sm" />
                      {packName(p)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Callout>
      ) : (
        <div className="text-sm text-muted-foreground">Pick the good you're building toward.</div>
      )}
      <Input
        value={term}
        placeholder="Search a target item/fluid…"
        onChange={(e) => setTerm(e.target.value)}
        className="w-72"
      />
      {term.trim().length > 0 && results.data && results.data.length > 0 && (
        <div className="max-h-52 overflow-auto border border-border">
          {results.data.map((g) => (
            <Button
              key={`${g.kind}:${g.name}`}
              variant="ghost"
              onClick={() => {
                onPick(g.name);
                setTerm("");
              }}
              className="h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal"
            >
              <Icon kind={g.kind === "fluid" ? "fluid" : "item"} name={g.name} size="md" />
              <span className="truncate">{g.display ?? g.name}</span>
              <span className="ml-auto shrink-0 bg-muted px-1 text-xs text-muted-foreground">
                {g.kind === "fluid" ? "Fluid" : "Item"}
              </span>
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

/** Explicit completed-research list — supplements the science-pack horizon in Now mode. */
function ResearchedPicker({
  researched,
  onSave,
}: {
  researched: string[];
  onSave: (r: string[]) => void;
}) {
  const [term, setTerm] = useState("");
  const results = useQuery({
    queryKey: ["techSearch", term],
    queryFn: () => searchTechsFn({ data: term }),
    enabled: term.trim().length >= 2,
  });
  const displays = useQuery({
    queryKey: ["techDisplays", researched],
    queryFn: () => techDisplaysFn({ data: researched }),
    enabled: researched.length > 0,
  });
  const dmap = new Map(displays.data ?? []);
  const toggle = (name: string) =>
    onSave(
      researched.includes(name) ? researched.filter((x) => x !== name) : [...researched, name],
    );

  return (
    <section className="space-y-1.5 border-t border-border pt-3">
      <FieldLabel className="flex items-center gap-1.5">
        Completed research
        <InfoHint content="Explicitly-marked techs, on top of what the science packs above already unlock." />
      </FieldLabel>
      <Input
        value={term}
        placeholder="Search a tech to mark researched…"
        onChange={(e) => setTerm(e.target.value)}
        className="w-72"
      />
      {term.trim().length >= 2 && results.data && results.data.length > 0 && (
        <div className="max-h-44 overflow-auto border border-border">
          {results.data.map((t) => (
            <TechHover key={t.name} name={t.name} className="block">
              <Button
                variant="ghost"
                onClick={() => toggle(t.name)}
                title={t.display ?? t.name}
                className="h-auto w-full justify-start gap-2 px-2 py-1 font-normal"
              >
                <Checkbox
                  tabIndex={-1}
                  checked={researched.includes(t.name)}
                  className="pointer-events-none"
                />
                <Icon kind="technology" name={t.name} size="sm" noHover />
                <span>{t.display ?? t.name}</span>
              </Button>
            </TechHover>
          ))}
        </div>
      )}
      {researched.length > 0 && (
        <div className="flex max-h-56 flex-wrap gap-1.5 overflow-auto border border-border p-2">
          {[...researched]
            .sort((a, b) => (dmap.get(a) ?? a).localeCompare(dmap.get(b) ?? b))
            .map((n) => (
              <TechHover
                key={n}
                name={n}
                className="inline-flex items-center gap-1 bg-muted px-2 py-0.5 text-sm"
              >
                <Icon kind="technology" name={n} size="sm" noHover />
                {dmap.get(n) ?? n}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => toggle(n)}
                  className="size-5 text-muted-foreground hover:bg-transparent hover:text-destructive"
                  title="Remove"
                >
                  ×
                </Button>
              </TechHover>
            ))}
        </div>
      )}
    </section>
  );
}

/** A one-line summary of the current horizon for the header button. */
export function horizonLabel(d: {
  mode: "now" | "future" | "target";
  target: string | null;
  targetDisplay: string | null;
}): string {
  if (d.mode === "now") return "Now";
  if (d.mode === "future") return "Future";
  return d.target ? `→ ${d.targetDisplay ?? d.target}` : "→ pick target";
}
