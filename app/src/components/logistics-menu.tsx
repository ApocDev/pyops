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
import { Icon, IconProvider } from "../lib/icons";
import { Switch } from "#/components/ui/switch.tsx";
import { Input } from "#/components/ui/input.tsx";

const item =
  "flex items-center gap-1.5 px-3 h-full text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50";

/** Header control for the global logistics display: pick the belt + inserter/loader
 * to size against, toggle stacking, and turn the per-row belt/inserter readout on
 * or off. Mirrors the Horizon menu — owns its own query/mutation. */
export function LogisticsMenu() {
  const [open, setOpen] = useState(false);
  const ctx = useQuery({
    queryKey: ["logisticsContext"],
    queryFn: () => logisticsContextFn(),
    refetchInterval: 5000,
  });
  const d = ctx.data;
  const beltName = d
    ? (d.options.belts.find((b) => b.name === d.prefs.belt)?.name ?? d.prefs.belt)
    : null;
  const moverName = d?.prefs.mover ?? null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={item}
        title="Logistics — belts & inserters needed per row"
      >
        <IconProvider>
          <span className="flex items-center gap-1.5">
            {moverName && <Icon kind="entity" name={moverName} size="sm" noTitle />}
            {beltName && <Icon kind="entity" name={beltName} size="sm" noTitle />}
          </span>
        </IconProvider>
        <span className={d?.prefs.enabled ? "text-foreground" : ""}>
          Logistics{d && !d.prefs.enabled ? ": off" : ""}
        </span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 p-10 font-mono"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-[36rem] rounded-lg border border-border bg-card p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Logistics throughput</h2>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>
            <LogisticsPicker />
          </div>
        </div>
      )}
    </>
  );
}

const tier = "flex items-center gap-1.5 rounded border px-2 py-1 text-sm transition-colors";
const tierOn = "border-primary text-primary";
const tierOff = "border-border text-muted-foreground hover:bg-muted";

/** The logistics control body — belt/mover pickers + stacking. Reusable. */
export function LogisticsPicker() {
  const qc = useQueryClient();
  const ctx = useQuery({
    queryKey: ["logisticsContext"],
    queryFn: () => logisticsContextFn(),
    refetchInterval: 5000,
  });
  const save = useMutation({
    mutationFn: (p: Partial<LogisticsPrefs>) => setLogisticsPrefsFn({ data: p }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["logisticsContext"] }),
  });
  const d = ctx.data;
  if (!d) return null;
  const resolved = resolveLogistics(d);
  const handStack = resolved.moverKind === "inserter" ? resolved.handStack : null;
  // throughput-per-option for the hover tooltips, at the current stacking
  const fmt = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1));
  const effBonuses = d.prefs.stacking ? d.bonuses : { belt: 0, inserter: 0, bulkInserter: 0 };
  const beltTip = (name: string, disp: string | null, speed: number) =>
    `${disp ?? name} (${name}) · ${fmt(beltItemsPerSecond(speed, resolved.placedStack))}/s on a full belt`;

  return (
    <IconProvider>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Show how many <b>belts</b> carry each item across a row, and how many{" "}
          <b>inserters or loaders</b> feed one building at the planned rate — sized against your
          current research. A quick feasibility check (when inserters get silly, reach for loaders).
        </p>

        <label className="flex items-center gap-2 text-sm">
          <Switch checked={d.prefs.enabled} onCheckedChange={(v) => save.mutate({ enabled: v })} />
          <span className="text-foreground">Show belts &amp; inserters on block rows</span>
        </label>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Belt</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {d.options.belts.map((b) => (
              <button
                key={b.name}
                onClick={() => save.mutate({ belt: b.name })}
                className={`${tier} ${d.prefs.belt === b.name ? tierOn : tierOff}`}
                title={beltTip(b.name, b.display, b.speed)}
              >
                <Icon kind="entity" name={b.name} size="sm" noTitle />
                <span>{b.display ?? b.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Inserter / loader (devices to feed a building)
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {d.options.inserters.map((i) => (
              <button
                key={i.name}
                onClick={() => save.mutate({ mover: i.name, moverKind: "inserter" })}
                className={`${tier} ${
                  d.prefs.moverKind === "inserter" && d.prefs.mover === i.name ? tierOn : tierOff
                }`}
                title={`${i.display ?? i.name} (${i.name}) · ≈${fmt(
                  inserterThroughput(i, inserterHandStack(i, effBonuses)),
                )}/s into a machine${i.bulk ? " · bulk" : ""}`}
              >
                <Icon kind="entity" name={i.name} size="sm" noTitle />
                <span>{i.display ?? i.name}</span>
              </button>
            ))}
            {d.options.loaders.map((l) => (
              <button
                key={l.name}
                onClick={() => save.mutate({ mover: l.name, moverKind: "loader" })}
                className={`${tier} ${
                  d.prefs.moverKind === "loader" && d.prefs.mover === l.name ? tierOn : tierOff
                }`}
                title={beltTip(l.name, l.display, l.speed)}
              >
                <Icon kind="entity" name={l.name} size="sm" noTitle />
                <span>{l.display ?? l.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={d.prefs.stacking}
              onCheckedChange={(v) => save.mutate({ stacking: v })}
            />
            <span className="text-foreground">Use stacking research</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Belt stack
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
              title={`Override the placed belt-stack size (1–${MAX_BELT_STACK}); blank = follow research`}
            />
          </label>
          <label
            className="flex items-center gap-2 text-sm"
            title="Also show rocket launches/min to move each good (floor(1,000,000 / item weight) per rocket)"
          >
            <Switch
              checked={d.prefs.showRockets}
              onCheckedChange={(v) => save.mutate({ showRockets: v })}
            />
            <span className="text-foreground">Rocket launches</span>
          </label>
        </div>

        <div className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
          Effective now: belt stack <b className="text-foreground">×{resolved.placedStack}</b>
          {d.prefs.overrideStack != null && <span> (override)</span>}
          {handStack != null && (
            <>
              {" · "}inserter hand <b className="text-foreground">×{handStack}</b>
            </>
          )}
          {" · "}research: belt +{d.bonuses.belt}, inserter +{d.bonuses.inserter}, bulk +
          {d.bonuses.bulkInserter}.
          <span className="text-muted-foreground/70">
            {" "}
            Stack sizes follow the Horizon's research; the override applies to belts only.
          </span>
        </div>
      </div>
    </IconProvider>
  );
}
