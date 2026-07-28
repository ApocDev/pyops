import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, FlaskConical } from "lucide-react";
import { labOptionsFn, saveScienceBankFn, scienceBlockFn } from "../../server/science";
import type { ScienceBank } from "../../db/schema";
import { Icon } from "../../lib/icons";
import { ModulesChip, ModulesModal } from "../../lib/modules-modal";
import { DeriveFromTechDialog } from "./derive-from-tech-dialog";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { InfoHint } from "#/components/info-hint.tsx";

const perMin = (perSec: number) => perSec * 60;
const fmt = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2));
const fmtW = (w: number) =>
  w >= 1e6 ? `${(w / 1e6).toFixed(2)} MW` : w >= 1e3 ? `${(w / 1e3).toFixed(0)} kW` : `${w} W`;

/** The science-consumer block: one lab bank for the whole factory.
 *
 * Rates are typed per pack — that is the plan, and it is what a mixed research
 * schedule actually looks like. The technology helper only fills them in. Labs
 * are ONE pool: the labs eating automation science are the same ones eating py
 * science 1, so the count follows the total rate rather than the sum of per-pack
 * counts.
 */
export function ScienceBlockView({ blockId }: { blockId: number }) {
  const qc = useQueryClient();
  const [derive, setDerive] = useState(false);
  const [editEffects, setEditEffects] = useState(false);
  const [draft, setDraft] = useState<ScienceBank | null>(null);

  const block = useQuery({ queryKey: ["scienceBlock"], queryFn: () => scienceBlockFn() });
  const labs = useQuery({
    queryKey: ["labOptions"],
    queryFn: () => labOptionsFn(),
    staleTime: 5 * 60_000,
  });
  const save = useMutation({
    mutationFn: (bank: ScienceBank) => saveScienceBankFn({ data: { id: blockId, bank } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["scienceBlock"] }),
  });

  // Adopt the stored bank once, then edit locally so typing stays responsive.
  useEffect(() => {
    if (!draft && block.data?.bank) setDraft(block.data.bank);
  }, [block.data, draft]);

  if (block.isPending || labs.isPending)
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  if (!block.data || !draft)
    return (
      <Callout tone="warning" className="m-4">
        This block has no lab bank.
      </Callout>
    );

  const result = block.data.result;
  const lab = labs.data?.find((l) => l.name === draft.lab);
  const packs = lab?.inputs ?? [];

  const commit = (next: ScienceBank) => {
    setDraft(next);
    save.mutate(next);
  };
  const setRate = (pack: string, perMinute: number) => {
    const next = { ...draft, packs: { ...draft.packs } };
    if (perMinute > 0) next.packs[pack] = perMinute / 60;
    else delete next.packs[pack];
    commit(next);
  };

  return (
    <div className="space-y-4 p-4">
      {/* lab + the pool scalar */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <FieldLabel>Lab</FieldLabel>
          <Select value={draft.lab} onValueChange={(v) => commit({ ...draft, lab: v })}>
            <SelectTrigger className="h-8 w-56" aria-label="Lab">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(labs.data ?? []).map((l) => (
                <SelectItem key={l.name} value={l.name}>
                  {l.display ?? l.name} · speed {l.researchingSpeed}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="space-y-1">
          <FieldLabel className="flex items-center gap-1">
            Lab-seconds per pack
            <InfoHint content="Seconds one lab spends per science pack. Pack rates alone cannot size the pool — 10/5/1 could be one technology's ratio or three mixed — so this supplies the conversion. Deriving from a technology sets it for you." />
          </FieldLabel>
          <Input
            type="number"
            min={0.1}
            step={0.1}
            value={draft.labSecondsPerPack}
            onChange={(e) =>
              commit({
                ...draft,
                labSecondsPerPack: Math.max(0.1, Number(e.target.value) || 0.1),
              })
            }
            className="h-8 w-28"
            aria-label="Lab-seconds per pack"
          />
        </label>

        <div className="space-y-1">
          <FieldLabel>Effects</FieldLabel>
          <ModulesChip
            modules={draft.modules ?? []}
            beacons={draft.beacons ?? []}
            slots={lab?.moduleSlots ?? 0}
            effectsAllowed={(lab?.allowedEffects?.length ?? 1) > 0}
            effects={
              result
                ? {
                    speed: result.speedMult - 1,
                    productivity: result.productivityMult - 1,
                    consumption: 0,
                  }
                : undefined
            }
            onClick={() => setEditEffects(true)}
          />
        </div>

        <Button variant="outline" onClick={() => setDerive(true)} className="ml-auto">
          <Calculator className="size-4" /> Derive from a technology
        </Button>
      </div>

      {/* per-pack rates — the plan itself */}
      <div>
        <FieldLabel className="mb-1 block">Science per minute</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {packs.map((pack) => (
            <label
              key={pack}
              className="flex items-center gap-1.5 border border-border bg-muted/20 px-2 py-1.5"
            >
              <Icon kind="item" name={pack} size="md" />
              <Input
                type="number"
                min={0}
                step={1}
                value={Math.round(perMin(draft.packs[pack] ?? 0) * 100) / 100}
                onChange={(e) => setRate(pack, Math.max(0, Number(e.target.value) || 0))}
                className="h-8 w-24"
                aria-label={`${lab?.inputDisplays[pack] ?? pack} per minute`}
              />
              <span className="text-sm text-muted-foreground">/min</span>
            </label>
          ))}
          {packs.length === 0 && (
            <span className="text-sm text-muted-foreground">
              This lab accepts no science packs.
            </span>
          )}
        </div>
      </div>

      {/* what the bank costs */}
      {result &&
        (() => {
          // what the factory actually hands over, before productivity turns it into
          // the total above
          const drawnPerSec = Object.values(result.packDemand).reduce((sum, r) => sum + r, 0);
          const pct = `${Math.round((result.productivityMult - 1) * 100)}%`;
          return (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Labs"
                value={fmt(result.labs)}
                hint="One pool — every pack shares them."
              />
              <Stat
                label="Total science"
                value={`${fmt(perMin(result.totalPerSec))}/min`}
                // The two figures differ only by productivity, and confusing them is
                // the easy mistake: this is the research you get, not the packs you
                // have to make.
                note={
                  result.productivityMult > 1
                    ? `${fmt(perMin(drawnPerSec))}/min drawn · ${pct} productivity`
                    : "no productivity — drawn as entered"
                }
              />
              <Stat label="Power" value={fmtW(result.totalPowerW)} />
              <Stat
                label="Productivity"
                value={pct}
                note={
                  result.productivityMult > 1
                    ? `${fmt(perMin(result.totalPerSec - drawnPerSec))}/min of science for free`
                    : undefined
                }
                hint="From modules and beacons. Pack demand is divided by it."
              />
            </div>
          );
        })()}

      {result && result.beaconBuildings.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <FieldLabel>Beacon buildings</FieldLabel>
          {result.beaconBuildings.map((b) => (
            <span key={b.beacon} className="flex items-center gap-1">
              <Icon kind="entity" name={b.beacon} size="sm" />
              <span className="font-semibold">{b.count}</span>
            </span>
          ))}
        </div>
      )}

      {result && Object.keys(result.upkeep).length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <FieldLabel className="flex items-center gap-1">
            Upkeep
            <InfoHint content="Consumed to keep the beacons running. The effect only applies while they do, so this is a requirement rather than an optional cost." />
          </FieldLabel>
          {Object.entries(result.upkeep).map(([item, u]) => (
            <span key={item} className="flex items-center gap-1">
              <Icon kind={u.kind as "item" | "fluid"} name={item} size="sm" />
              <span className="font-semibold">{fmt(perMin(u.perSec))}</span>
              <span className="text-muted-foreground">/min</span>
            </span>
          ))}
        </div>
      )}

      {result && result.unsupported.length > 0 && (
        <Callout tone="warning">This lab does not accept: {result.unsupported.join(", ")}</Callout>
      )}

      {result && Object.keys(result.packDemand).length > 0 && (
        <div>
          <FieldLabel className="mb-1 flex items-center gap-1">
            Pinned on the factory
            <InfoHint content="Your rates after productivity, pinned as whole-factory targets. The factory solve sizes producers against them; they can only be changed here." />
          </FieldLabel>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {Object.entries(result.packDemand).map(([pack, perSec]) => (
              <span key={pack} className="flex items-center gap-1">
                <Icon kind="item" name={pack} size="sm" />
                <span className="font-semibold">{fmt(perMin(perSec))}</span>
                <span className="text-muted-foreground">/min</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {editEffects && (
        <ModulesModal
          // No recipe: the bank is a machine loadout. Only the lab's own
          // restrictions apply — in Pyanodons that is the vatbrain category, so
          // this is where a Vatbrain biocomputer gets attached.
          recipe={null}
          recipeDisplay={lab?.display ?? draft.lab}
          title={`Modules — ${lab?.display ?? draft.lab}`}
          machineName={draft.lab}
          modules={draft.modules ?? []}
          beacons={draft.beacons ?? []}
          effects={
            result
              ? {
                  speed: result.speedMult - 1,
                  productivity: result.productivityMult - 1,
                  consumption: 0,
                }
              : undefined
          }
          onChange={(modules, beacons) => commit({ ...draft, modules, beacons })}
          onClose={() => setEditEffects(false)}
        />
      )}

      <DeriveFromTechDialog
        open={derive}
        onClose={() => setDerive(false)}
        onAccept={(rates) =>
          commit({ ...draft, packs: rates.packs, labSecondsPerPack: rates.labSecondsPerPack })
        }
      />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  note,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Secondary figure under the value — used to keep "what you get" and "what
   * the factory hands over" visible together. */
  note?: string;
}) {
  return (
    <div
      className="border border-border bg-muted/20 p-2"
      data-testid={`science-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <FlaskConical className="size-3.5" />
        {label}
        {hint && <InfoHint content={hint} />}
      </div>
      <div className="text-lg font-semibold">{value}</div>
      {note && <div className="text-sm text-muted-foreground">{note}</div>}
    </div>
  );
}
