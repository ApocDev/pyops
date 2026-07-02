import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check } from "lucide-react";
import {
  goodInfoFn,
  researchHorizonFn,
  searchAllFn,
  searchTechsFn,
  setResearchHorizonFn,
  techDisplaysFn,
} from "../server/factorio";
import { Icon, IconProvider } from "../lib/icons";
import { TechHover } from "../lib/recipe-card";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Input } from "#/components/ui/input.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
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
};

/** The planning-horizon control, shared by Settings and the header dialog. It owns
 * its own query/mutation so it can be dropped in anywhere. Changing it re-solves
 * blocks and refreshes recipe availability everywhere. */
export function HorizonPicker() {
  const qc = useQueryClient();
  const h = useQuery({
    queryKey: ["researchHorizon"],
    queryFn: () => researchHorizonFn(),
    refetchInterval: 4000,
  });
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
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          What can the planner use? <b>Now</b> — only recipes reachable with the science packs you
          produce and your current TURD choices. <b>Future</b> — anything, flagging what to unlock.{" "}
          <b>Up to target</b> — everything unlocked by a target good's tech and its prerequisites,
          and nothing beyond (plan ahead to a goal without reaching for far-future tech). Applies
          everywhere: blocks, the picker, and the assistant.
        </p>
        <div className="flex gap-2">
          {(
            [
              ["now", "Now"],
              ["future", "Future"],
              ["target", "Up to target"],
            ] as const
          ).map(([m, label]) => (
            <Button
              key={m}
              variant="toggle"
              aria-pressed={d.mode === m}
              onClick={() => save.mutate({ mode: m })}
            >
              {label}
            </Button>
          ))}
        </div>

        {d.syncedAt && (
          <div className="flex items-center gap-1.5 text-sm text-success">
            <Check className="size-3.5 shrink-0" /> live: {d.syncedCount} techs synced from the game
            {d.mode !== "now" && (
              <span className="text-muted-foreground"> — switch to Now to plan against it</span>
            )}
          </div>
        )}

        {d.mode === "now" && (
          <>
            <div>
              <FieldLabel>
                science packs you produce (recipes needing only these count as available)
              </FieldLabel>
              <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
                {d.allPacks.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm" title={packName(p)}>
                    <input
                      type="checkbox"
                      checked={d.packs.includes(p)}
                      onChange={() => togglePack(p)}
                    />
                    <Icon kind="item" name={p} size="sm" title={packName(p)} />
                    <span>{packName(p)}</span>
                  </label>
                ))}
              </div>
            </div>
            <ResearchedPicker
              researched={d.researched}
              onSave={(r) => save.mutate({ researched: r })}
            />
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
    <div className="space-y-2">
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
              <span className="text-muted-foreground">unlocked by</span>
              {targetTech ? (
                <TechHover name={targetTech} className="flex items-center gap-1.5">
                  <Icon kind="technology" name={targetTech} size="sm" noHover />
                  <span className="text-foreground underline decoration-dotted">
                    {targetTechDisplay ?? targetTech}
                  </span>
                </TechHover>
              ) : (
                <span className="text-warning">
                  no unlocking tech — start-craftable or unreachable
                </span>
              )}
            </div>
            {packs.length > 0 && (
              <div>
                <FieldLabel>science packs allowed up to this tier ({packs.length})</FieldLabel>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {packs.map((p) => (
                    <Badge key={p} title={packName(p)}>
                      <Icon kind="item" name={p} size="sm" title={packName(p)} />
                      {packName(p)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Callout>
      ) : (
        <div className="text-sm text-muted-foreground">
          Pick the good you're building toward — the planner allows tech up to (and including) what
          unlocks it.
        </div>
      )}
      <Input
        value={term}
        placeholder="search a target item/fluid…"
        onChange={(e) => setTerm(e.target.value)}
        className="w-72"
      />
      {term.trim().length > 0 && results.data && results.data.length > 0 && (
        <div className="max-h-52 overflow-auto border border-border">
          {results.data.map((g) => (
            <Button
              key={`${g.kind}:${g.name}`}
              variant="ghost"
              title={g.display ?? g.name}
              onClick={() => {
                onPick(g.name);
                setTerm("");
              }}
              className="h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal"
            >
              <Icon
                kind={g.kind === "fluid" ? "fluid" : "item"}
                name={g.name}
                size="md"
                title={g.display ?? g.name}
              />
              <span className="truncate">{g.display ?? g.name}</span>
              <span className="ml-auto shrink-0 bg-muted px-1 text-xs text-muted-foreground uppercase">
                {g.kind}
              </span>
            </Button>
          ))}
        </div>
      )}
    </div>
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
    <div>
      <FieldLabel>completed research (explicit — supplements the science-pack horizon)</FieldLabel>
      <Input
        value={term}
        placeholder="search a tech to mark researched…"
        onChange={(e) => setTerm(e.target.value)}
        className="mt-1 w-72"
      />
      {term.trim().length >= 2 && results.data && results.data.length > 0 && (
        <div className="mt-1 max-h-44 overflow-auto border border-border">
          {results.data.map((t) => (
            <TechHover key={t.name} name={t.name} className="block">
              <Button
                variant="ghost"
                onClick={() => toggle(t.name)}
                title={t.display ?? t.name}
                className="h-auto w-full justify-start gap-2 px-2 py-1 font-normal"
              >
                <input type="checkbox" readOnly checked={researched.includes(t.name)} />
                <Icon kind="technology" name={t.name} size="sm" noHover />
                <span>{t.display ?? t.name}</span>
              </Button>
            </TechHover>
          ))}
        </div>
      )}
      {researched.length > 0 && (
        <div className="mt-2 flex max-h-56 flex-wrap gap-1.5 overflow-auto border border-border p-2">
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
                  title="remove"
                >
                  ×
                </Button>
              </TechHover>
            ))}
        </div>
      )}
    </div>
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
