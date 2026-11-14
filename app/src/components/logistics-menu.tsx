import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { setLogisticsPrefsFn } from "../server/factorio";
import { logisticsContextSubscription } from "../lib/live-query-options";
import {
  type InserterBelt,
  type InserterProto,
  type LogisticsPrefs,
  MAX_BELT_STACK,
  beltItemsPerSecond,
  inserterHandStack,
  inserterThroughput,
  resolveLogistics,
} from "../lib/logistics";
import { resolveRobots, robotTrip } from "../lib/robots";
import { formatQty } from "../lib/format";
import { Icon, IconProvider } from "../lib/icons";
import { InfoHint } from "./info-hint";
import { LogisticsHelpButton } from "./logistics-help";
import { RobotDistanceInput } from "./robot-distance-input";
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
  const ctx = useQuery(logisticsContextSubscription);
  const d = ctx.data;
  const beltName = d
    ? (d.options.belts.find((b) => b.name === d.prefs.belt)?.name ?? d.prefs.belt)
    : null;
  const moverName = d?.prefs.mover ?? null;
  const robotName =
    d?.prefs.showRobots && d.options.robots.length
      ? (d.options.robots.find((r) => r.name === d.prefs.robot) ?? d.options.robots[0]).name
      : null;
  const enabled = d
    ? d.prefs.showBelts || d.prefs.showInserters || d.prefs.showRockets || d.prefs.showRobots
    : false;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="h-full gap-1.5 px-3 font-normal text-muted-foreground hover:bg-muted/50"
          title="Logistics — belts, inserters, robots and rockets needed per row"
        >
          <IconProvider>
            <span className="flex items-center gap-1.5">
              {moverName && <Icon kind="entity" name={moverName} size="sm" noTitle />}
              {beltName && <Icon kind="entity" name={beltName} size="sm" noTitle />}
              {robotName && <Icon kind="entity" name={robotName} size="sm" noTitle />}
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
  const ctx = useQuery(logisticsContextSubscription);
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
  // per-inserter rates off and onto the selected belt (a row's inputs and outputs)
  const inserterTip = (i: InserterProto) => {
    const hand = inserterHandStack(i, effBonuses);
    const rate = (end: InserterBelt["end"]) =>
      resolved.belt
        ? fmt(
            inserterThroughput(i, hand, {
              end,
              speed: resolved.belt.speed,
              placedStack: resolved.placedStack,
            }),
          )
        : "?";
    return `${i.display ?? i.name} (${i.name}) · hand ${hand} · ≈${rate("pickup")}/s belt → machine · ≈${rate("drop")}/s machine → belt${i.bulk ? " · bulk" : ""}`;
  };
  const robots = resolveRobots(d.options, d.prefs, d.robotBonuses);
  // one robot's rate at the factory distance, with the selected roboport's charging
  const robotTip = (r: (typeof d.options.robots)[number]) =>
    `${r.display ?? r.name} (${r.name}) · ≈${fmt(robotTrip(r, d.robotBonuses, d.prefs.robotDistance, robots?.roboport).itemsPerSecond)}/s per robot at ${fmt(d.prefs.robotDistance)} tiles`;
  const bonusParts = [
    d.robotBonuses.speed > 0 && `+${fmt(d.robotBonuses.speed * 100)}% speed`,
    d.robotBonuses.storage > 0 && `+${fmt(d.robotBonuses.storage)} cargo`,
  ].filter(Boolean);
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
            {robots && (
              <label className="flex items-center gap-2">
                <Switch
                  checked={d.prefs.showRobots}
                  onCheckedChange={(v) => save.mutate({ showRobots: v })}
                />
                <span className="text-foreground">Robots</span>
              </label>
            )}
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
            <InfoHint content="The device moving items in and out of each building. Hover an option for its per-device rate off the belt (inputs) and onto it (outputs)." />
          </FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {d.options.inserters.map((i) => (
              <Button
                key={i.name}
                variant="toggle"
                aria-pressed={d.prefs.moverKind === "inserter" && d.prefs.mover === i.name}
                onClick={() => save.mutate({ mover: i.name, moverKind: "inserter" })}
                title={inserterTip(i)}
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
                placeholder="Auto"
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
          Belt stack <b className="text-foreground">×{resolved.placedStack}</b>
          {d.prefs.overrideStack != null && <span> (override)</span>}
          {handStack != null && (
            <>
              {" · "}hand <b className="text-foreground">×{handStack}</b>
            </>
          )}
          {" · "}
          {d.bonuses.belt === 0 && d.bonuses.inserter === 0 && d.bonuses.bulkInserter === 0 ? (
            "No stacking research yet"
          ) : (
            <>
              Research belt +{d.bonuses.belt} · inserter +{d.bonuses.inserter} · bulk +
              {d.bonuses.bulkInserter}
            </>
          )}
        </div>

        {robots && (
          <div className="space-y-1.5 border-t border-border pt-3">
            <FieldLabel className="flex items-center gap-1.5">
              Robots
              <InfoHint content="Logistic robots to move each import and export: full loads, out and back over the trip distance, plus detours to charge at the selected roboport. A block can set its own distance." />
            </FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {d.options.robots.map((r) => (
                <Button
                  key={r.name}
                  variant="toggle"
                  aria-pressed={robots.robot.name === r.name}
                  onClick={() => save.mutate({ robot: r.name })}
                  title={robotTip(r)}
                >
                  <Icon kind="entity" name={r.name} size="sm" noHover />
                  <span>{r.display ?? r.name}</span>
                </Button>
              ))}
            </div>
            {d.options.roboports.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {d.options.roboports.map((p) => (
                  <Button
                    key={p.name}
                    variant="toggle"
                    aria-pressed={robots.roboport?.name === p.name}
                    onClick={() => save.mutate({ roboport: p.name })}
                    title={`${p.display ?? p.name} (${p.name}) · charges at ${fmt(p.chargingEnergyW / 1000)} kW`}
                  >
                    <Icon kind="entity" name={p.name} size="sm" noHover />
                    <span>{p.display ?? p.name}</span>
                  </Button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 text-sm">
              <span className="text-foreground">Trip distance</span>
              <RobotDistanceInput
                label="Robot trip distance"
                value={d.prefs.robotDistance}
                onCommit={(robotDistance) => save.mutate({ robotDistance })}
              />
              {bonusParts.length > 0 && (
                <span className="text-muted-foreground">{bonusParts.join(" · ")}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </IconProvider>
  );
}
