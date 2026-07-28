import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ratesForTechFn, techCostsFn } from "../../server/science";
import { Icon } from "../../lib/icons";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";
import { FilterInput } from "#/components/filter-input.tsx";
import { EmptyState } from "#/components/empty-state.tsx";

const perMin = (perSec: number) => perSec * 60;
const fmt = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2));

/** Work out pack rates from "research THIS in THIS long".
 *
 * A calculator, not a setting: it writes plain numbers into the bank and no
 * technology is stored, so a plan cannot rot when one is renamed or researched.
 * Minutes rather than a rate because that is how a research target gets said out
 * loud — "silver in half an hour".
 */
export function DeriveFromTechDialog({
  open,
  onClose,
  onAccept,
}: {
  open: boolean;
  onClose: () => void;
  onAccept: (rates: { packs: Record<string, number>; labSecondsPerPack: number }) => void;
}) {
  const [filter, setFilter] = useState("");
  const [tech, setTech] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(30);

  const techs = useQuery({
    queryKey: ["techCosts"],
    queryFn: () => techCostsFn(),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const preview = useQuery({
    queryKey: ["ratesForTech", tech, minutes],
    queryFn: () => ratesForTechFn({ data: { tech: tech!, minutes } }),
    enabled: open && !!tech && minutes > 0,
  });

  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = techs.data ?? [];
    const hit = needle
      ? all.filter(
          (t) =>
            (t.display ?? t.name).toLowerCase().includes(needle) ||
            t.name.toLowerCase().includes(needle),
        )
      : all;
    return hit.slice(0, 80);
  }, [techs.data, filter]);

  const rates = preview.data;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="md:max-w-[44rem]">
        <DialogHeader>
          <DialogTitle>Derive rates from a technology</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <FilterInput
            value={filter}
            onValueChange={setFilter}
            placeholder="Search technologies…"
          />
          <div className="max-h-56 overflow-y-auto border border-border">
            {techs.isPending ? (
              <div className="space-y-1 p-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-7 w-full" />
                ))}
              </div>
            ) : matches.length === 0 ? (
              <EmptyState
                title="No technologies match"
                description="Clear the search, or sync game data if this project has none yet."
              />
            ) : (
              matches.map((t) => (
                <button
                  key={t.name}
                  onClick={() => setTech(t.name)}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent ${
                    tech === t.name ? "bg-accent text-accent-foreground" : ""
                  }`}
                >
                  <Icon kind="technology" name={t.name} size="sm" noHover />
                  <span className="min-w-0 flex-1 truncate">{t.display ?? t.name}</span>
                  <span className="text-muted-foreground">{fmt(t.unitCount)} units</span>
                </button>
              ))
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <FieldLabel className="shrink-0">Finish in</FieldLabel>
            <Input
              type="number"
              min={1}
              value={minutes}
              onChange={(e) => setMinutes(Math.max(1, Math.round(Number(e.target.value) || 1)))}
              className="h-8 w-24"
              aria-label="Minutes to finish the technology"
            />
            <span className="text-muted-foreground">minutes</span>
          </label>

          {tech && (
            <div className="border border-border bg-muted/20 p-2">
              {preview.isPending ? (
                <Skeleton className="h-16 w-full" />
              ) : !rates ? (
                <span className="text-sm text-muted-foreground">
                  This technology has no science cost — nothing to derive.
                </span>
              ) : (
                <>
                  <div className="mb-1 text-sm font-semibold">Rates to use</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {Object.entries(rates.packs).map(([pack, perSec]) => (
                      <span key={pack} className="flex items-center gap-1">
                        <Icon kind="item" name={pack} size="sm" noHover />
                        <span className="font-semibold">{fmt(perMin(perSec))}</span>
                        <span className="text-muted-foreground">/min</span>
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {fmt(perMin(rates.totalPerSec))} science/min total ·{" "}
                    {fmt(rates.labSecondsPerPack)} lab-seconds per pack
                  </div>
                </>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!rates}
            onClick={() => {
              if (!rates) return;
              onAccept({ packs: rates.packs, labSecondsPerPack: rates.labSecondsPerPack });
              onClose();
            }}
          >
            Use these rates
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
