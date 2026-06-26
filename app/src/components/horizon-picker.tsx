import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { Input } from "#/components/ui/input.tsx";

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
  if (!d) return null;
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
            <button
              key={m}
              onClick={() => save.mutate({ mode: m })}
              className={`rounded border px-3 py-1 text-sm ${
                d.mode === m
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {d.syncedAt && (
          <div className="text-xs text-emerald-300">
            ✓ live: {d.syncedCount} techs synced from the game
            {d.mode !== "now" && (
              <span className="text-muted-foreground"> — switch to Now to plan against it</span>
            )}
          </div>
        )}

        {d.mode === "now" && (
          <>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                science packs you produce (recipes needing only these count as available)
              </div>
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
        <div className="space-y-2 rounded border border-primary/40 bg-primary/5 p-2.5 text-sm">
          <div className="flex items-center gap-2">
            <Icon kind="item" name={target} size="lg" title={targetDisplay ?? target} />
            <div className="truncate font-semibold text-foreground" title={targetDisplay ?? target}>
              {targetDisplay ?? target}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">unlocked by</span>
            {targetTech ? (
              <TechHover name={targetTech} className="flex items-center gap-1.5">
                <Icon
                  kind="technology"
                  name={targetTech}
                  size="sm"
                  title={targetTechDisplay ?? targetTech}
                />
                <span className="text-foreground underline decoration-dotted">
                  {targetTechDisplay ?? targetTech}
                </span>
              </TechHover>
            ) : (
              <span className="text-amber-300">
                no unlocking tech — start-craftable or unreachable
              </span>
            )}
          </div>
          {packs.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                science packs allowed up to this tier ({packs.length})
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {packs.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
                    title={packName(p)}
                  >
                    <Icon kind="item" name={p} size="sm" title={packName(p)} />
                    {packName(p)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
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
        <div className="max-h-52 overflow-auto rounded border border-border">
          {results.data.map((g) => (
            <button
              key={`${g.kind}:${g.name}`}
              title={g.display ?? g.name}
              onClick={() => {
                onPick(g.name);
                setTerm("");
              }}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <Icon
                kind={g.kind === "fluid" ? "fluid" : "item"}
                name={g.name}
                size="md"
                title={g.display ?? g.name}
              />
              <span className="truncate">{g.display ?? g.name}</span>
              <span className="ml-auto shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground uppercase">
                {g.kind}
              </span>
            </button>
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
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        completed research (explicit — supplements the science-pack horizon)
      </div>
      <Input
        value={term}
        placeholder="search a tech to mark researched…"
        onChange={(e) => setTerm(e.target.value)}
        className="mt-1 w-72"
      />
      {term.trim().length >= 2 && results.data && results.data.length > 0 && (
        <div className="mt-1 max-h-44 overflow-auto rounded border border-border">
          {results.data.map((t) => (
            <TechHover key={t.name} name={t.name} className="block">
              <button
                onClick={() => toggle(t.name)}
                title={t.display ?? t.name}
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-muted"
              >
                <input type="checkbox" readOnly checked={researched.includes(t.name)} />
                <Icon kind="technology" name={t.name} size="sm" title={t.display ?? t.name} />
                <span>{t.display ?? t.name}</span>
              </button>
            </TechHover>
          ))}
        </div>
      )}
      {researched.length > 0 && (
        <div className="mt-2 flex max-h-56 flex-wrap gap-1.5 overflow-auto rounded border border-border p-2">
          {[...researched]
            .sort((a, b) => (dmap.get(a) ?? a).localeCompare(dmap.get(b) ?? b))
            .map((n) => (
              <TechHover
                key={n}
                name={n}
                className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-sm"
              >
                <Icon kind="technology" name={n} size="sm" title={dmap.get(n) ?? n} />
                {dmap.get(n) ?? n}
                <button
                  onClick={() => toggle(n)}
                  className="text-muted-foreground hover:text-destructive"
                  title="remove"
                >
                  ×
                </button>
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
