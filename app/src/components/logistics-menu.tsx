import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { logisticsContextFn, setLogisticsPrefsFn } from "../server/factorio";
import {
  type LogisticsPrefs,
  MAX_BELT_STACK,
  beltItemsPerSecond,
  inserterHandStack,
  inserterThroughput,
  resolveLogistics,
} from "../lib/logistics";
import { formatQty } from "../lib/format";
import { Icon, IconProvider } from "../lib/icons";
import { InfoHint } from "./info-hint";
import { LogisticsHelpButton } from "./logistics-help";
import { Button } from "#/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";

/** Header control for the global logistics display: pick the belt + inserter/loader
 * to size against, toggle stacking, and turn the per-row belt/inserter readout on
 * or off. Mirrors the Horizon menu — owns its own query/mutation. */
export function LogisticsMenu() {
  const [open, setOpen] = useState(false);
  const ctx = useQuery({
    queryKey: ["logisticsContext"],
    queryFn: () => logisticsContextFn(),
  });
  const d = ctx.data;
  const beltName = d
    ? (d.options.belts.find((b) => b.name === d.prefs.belt)?.name ?? d.prefs.belt)
    : null;
  const moverName = d?.prefs.mover ?? null;
  const enabled = d ? d.prefs.showBelts || d.prefs.showInserters || d.prefs.showRockets : false;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="h-full gap-1.5 px-3 font-normal text-muted-foreground hover:bg-muted/50"
          title="Logistics — belts, inserters & rockets needed per row"
        >
          <IconProvider>
            <span className="flex items-center gap-1.5">
              {moverName && <Icon kind="entity" name={moverName} size="sm" noTitle />}
              {beltName && <Icon kind="entity" name={beltName} size="sm" noTitle />}
            </span>
          </IconProvider>
          <span className={enabled ? "text-foreground" : ""}>
            Logistics{d && !enabled ? ": off" : ""}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="md:max-w-[36rem]">
        <DialogHeader>
          <DialogTitle>Logistics throughput</DialogTitle>
          <LogisticsHelpButton className="mr-7 ml-auto" />
        </DialogHeader>
        <DialogBody>
          <LogisticsPicker />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** The logistics control body — belt/mover pickers + stacking. Reusable. */
export function LogisticsPicker() {
  const qc = useQueryClient();
  const ctx = useQuery({
    queryKey: ["logisticsContext"],
    queryFn: () => logisticsContextFn(),
  });
  const save = useMutation({
    mutationFn: (p: Partial<LogisticsPrefs>) => setLogisticsPrefsFn({ data: p }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["logisticsContext"] }),
  });
  const d = ctx.data;
  if (!d)
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  const resolved = resolveLogistics(d);
  const handStack = resolved.moverKind === "inserter" ? resolved.handStack : null;
  // throughput-per-option for the hover tooltips, at the current stacking
  const fmt = formatQty; // adaptive precision (#74)
  const effBonuses = d.prefs.stacking ? d.bonuses : { belt: 0, inserter: 0, bulkInserter: 0 };
  const beltTip = (name: string, disp: string | null, speed: number) =>
    `${disp ?? name} (${name}) · ${fmt(beltItemsPerSecond(speed, resolved.placedStack))}/s on a full belt`;

  return (
    <IconProvider>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <FieldLabel className="flex items-center gap-1.5">
            Show on block rows
            <InfoHint content="Per-row belt / feeder / rocket counts at the planned rate — a quick feasibility check." />
          </FieldLabel>
          <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              <Switch
                checked={d.prefs.showBelts}
                onCheckedChange={(v) => save.mutate({ showBelts: v })}
              />
              <span className="text-foreground">Belts</span>
            </label>
            <label className="flex items-center gap-2">
              <Switch
                checked={d.prefs.showInserters}
                onCheckedChange={(v) => save.mutate({ showInserters: v })}
              />
              <span className="text-foreground">Inserters / loaders</span>
            </label>
            <Tooltip content="Rocket launches/min to move each good (floor(1,000,000 / item weight) per rocket)">
              <label className="flex items-center gap-2">
                <Switch
                  checked={d.prefs.showRockets}
                  onCheckedChange={(v) => save.mutate({ showRockets: v })}
                />
                <span className="text-foreground">Rockets</span>
              </label>
            </Tooltip>
          </div>
        </div>

        <div className="space-y-1.5 border-t border-border pt-3">
          <FieldLabel className="flex items-center gap-1.5">
            Belt
            <InfoHint content="The belt tier rows are sized against. Hover an option for its full-belt throughput." />
          </FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {d.options.belts.map((b) => (
              <Button
                key={b.name}
                variant="toggle"
                aria-pressed={d.prefs.belt === b.name}
                onClick={() => save.mutate({ belt: b.name })}
                title={beltTip(b.name, b.display, b.speed)}
              >
                <Icon kind="entity" name={b.name} size="sm" noHover />
                <span>{b.display ?? b.name}</span>
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5 border-t border-border pt-3">
          <FieldLabel className="flex items-center gap-1.5">
            Inserter / loader
            <InfoHint content="The device feeding each building. Hover an option for its per-device rate into a machine." />
          </FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {d.options.inserters.map((i) => (
              <Button
                key={i.name}
                variant="toggle"
                aria-pressed={d.prefs.moverKind === "inserter" && d.prefs.mover === i.name}
                onClick={() => save.mutate({ mover: i.name, moverKind: "inserter" })}
                title={`${i.display ?? i.name} (${i.name}) · ≈${fmt(
                  inserterThroughput(i, inserterHandStack(i, effBonuses)),
                )}/s into a machine${i.bulk ? " · bulk" : ""}`}
              >
                <Icon kind="entity" name={i.name} size="sm" noHover />
                <span>{i.display ?? i.name}</span>
              </Button>
            ))}
            {d.options.loaders.map((l) => (
              <Button
                key={l.name}
                variant="toggle"
                aria-pressed={d.prefs.moverKind === "loader" && d.prefs.mover === l.name}
                onClick={() => save.mutate({ mover: l.name, moverKind: "loader" })}
                title={beltTip(l.name, l.display, l.speed)}
              >
                <Icon kind="entity" name={l.name} size="sm" noHover />
                <span>{l.display ?? l.name}</span>
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={d.prefs.stacking}
              onCheckedChange={(v) => save.mutate({ stacking: v })}
            />
            <span className="text-foreground">Use stacking research</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Belt stack
            <Tooltip
              content={`Override the placed belt-stack size (1–${MAX_BELT_STACK}); blank = follow research`}
            >
              <Input
                value={d.prefs.overrideStack ?? ""}
                placeholder="auto"
                inputMode="numeric"
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  const n = raw === "" ? null : Number(raw);
                  save.mutate({ overrideStack: n != null && Number.isFinite(n) ? n : null });
                }}
                className="h-7 w-16"
              />
            </Tooltip>
          </label>
        </div>

        <div className="border border-border bg-muted/30 p-2 text-sm text-muted-foreground">
          belt stack <b className="text-foreground">×{resolved.placedStack}</b>
          {d.prefs.overrideStack != null && <span> (override)</span>}
          {handStack != null && (
            <>
              {" · "}hand <b className="text-foreground">×{handStack}</b>
            </>
          )}
          {" · "}
          {d.bonuses.belt === 0 && d.bonuses.inserter === 0 && d.bonuses.bulkInserter === 0 ? (
            "no stacking research yet"
          ) : (
            <>
              research belt +{d.bonuses.belt} · inserter +{d.bonuses.inserter} · bulk +
              {d.bonuses.bulkInserter}
            </>
          )}
        </div>
      </div>
    </IconProvider>
  );
}
