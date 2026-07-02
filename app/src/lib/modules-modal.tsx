import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Ban, Minus, Plus, RotateCcw, SquarePlus, X } from "lucide-react";
import {
  deleteModulePresetFn,
  listModulePresetsFn,
  moduleInfoFn,
  modulePickerFn,
  saveModulePresetFn,
  type BeaconConfig,
} from "../server/factorio";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { CursorHover } from "./hover";
import { Icon } from "./icons";

/**
 * Module + beacon loadout for one recipe row.
 *
 * Interactions (no select boxes):
 *  - click a module in the palette → fills the next empty slot
 *  - SHIFT-click a module → fill ALL remaining slots with it
 *  - click a filled slot → empties it; CTRL-click a palette module → remove all of it
 *  - beacons: Py AM/FM variants render as a 5×5 matrix per family
 *  - presets save the whole loadout and apply with one click
 */

const pct = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`;
const mult = (x: number | null | undefined) => `${Math.round((x ?? 1) * 100) / 100}×`;
const fmtW = (w: number) =>
  w >= 1e9
    ? `${(w / 1e9).toFixed(2)} GW`
    : w >= 1e6
      ? `${(w / 1e6).toFixed(2)} MW`
      : w >= 1e3
        ? `${(w / 1e3).toFixed(0)} kW`
        : `${w.toFixed(0)} W`;

type ModuleInfo = {
  name: string;
  display: string | null;
  category: string | null;
  tier: number | null;
  effSpeed: number;
  effProductivity: number;
  effConsumption: number;
};

function moduleTitle(m: ModuleInfo): string {
  const fx: string[] = [];
  if (m.effSpeed) fx.push(`${pct(m.effSpeed)} speed`);
  if (m.effProductivity) fx.push(`${pct(m.effProductivity)} productivity`);
  if (m.effConsumption) fx.push(`${pct(m.effConsumption)} energy`);
  return `${m.display ?? m.name}${fx.length ? ` · ${fx.join(" · ")}` : ""}`;
}

export type RowEffects = { speed: number; productivity: number; consumption: number };

/** Compact grid-cell chip: configured module icons (grouped ×n) + a beacon tag.
 * Ghost slot-grid icon when the machine has slots but nothing is configured yet. */
export function ModulesChip({
  modules,
  beacons,
  slots,
  effects,
  auto,
  onClick,
}: {
  modules: string[];
  beacons: BeaconConfig[];
  slots: number;
  effects?: RowEffects;
  auto?: boolean;
  onClick: () => void;
}) {
  if (slots <= 0 && !beacons.length && !modules.length) return null;
  const counts = new Map<string, number>();
  for (const n of modules) counts.set(n, (counts.get(n) ?? 0) + 1);
  const grouped = [...counts.entries()];
  const empty = !modules.length && !beacons.length;
  const button = (
    <button
      onClick={onClick}
      // Empty state keeps a plain caption; a configured loadout shows the rich
      // ModuleLoadoutCard hover (below) instead of a flat "+X% speed" title.
      title={
        empty
          ? auto
            ? "auto-managed — no module is worth it here (payback economy) · click to override"
            : "no modules — click to configure"
          : undefined
      }
      // Raw button on purpose: a compact icon-tile chip living inside a dense
      // grid cell — the Button primitive's h-8 box would break the row density.
      className={`flex items-center gap-1 px-1.5 py-1 text-sm hover:bg-accent ${
        empty
          ? "border border-dashed border-border text-muted-foreground"
          : "bg-muted/50 text-success"
      }`}
    >
      {empty && <SquarePlus className="size-4" />}
      {auto && <span className="text-sm text-info">A</span>}
      {grouped.map(([n, c]) => (
        <span key={n} className="flex items-center">
          <Icon kind="item" name={n} size="sm" noHover />
          {c > 1 && <span className="text-sm">×{c}</span>}
        </span>
      ))}
      {beacons.map((b, i) => (
        <span key={i} className="flex items-center gap-0.5">
          <Icon kind="entity" name={b.beacon} size="sm" noHover />
          {b.modules.map((mn, j) => (
            <Icon key={j} kind="item" name={mn} size="sm" noHover />
          ))}
        </span>
      ))}
    </button>
  );
  if (empty) return button;
  return (
    <CursorHover
      card={<ModuleLoadoutCard modules={modules} beacons={beacons} effects={effects} auto={auto} />}
      z={70}
    >
      {button}
    </CursorHover>
  );
}

/** Per-module effect summary (a single module's own base effect), for the card. */
function moduleEffects(m: {
  effSpeed: number;
  effProductivity: number;
  effConsumption: number;
}): string {
  const fx: string[] = [];
  if (m.effSpeed) fx.push(`${pct(m.effSpeed)} spd`);
  if (m.effProductivity) fx.push(`${pct(m.effProductivity)} prod`);
  if (m.effConsumption) fx.push(`${pct(m.effConsumption)} nrg`);
  return fx.join(" · ");
}

/** Rich hover for a configured module loadout: what each module is and provides,
 * the beacons and their modules, and the row's total speed/prod/energy effect —
 * replacing the old flat "+X% speed · click to edit" native title. */
function ModuleLoadoutCard({
  modules,
  beacons,
  effects,
  auto,
}: {
  modules: string[];
  beacons: BeaconConfig[];
  effects?: RowEffects;
  auto?: boolean;
}) {
  const names = useMemo(
    () => [...new Set([...modules, ...beacons.flatMap((b) => b.modules)])],
    [modules, beacons],
  );
  const { data } = useQuery({
    queryKey: ["moduleInfo", [...names].sort()],
    queryFn: () => moduleInfoFn({ data: names }),
    enabled: names.length > 0,
    staleTime: 60_000,
  });
  const byName = new Map((data ?? []).map((m) => [m.name, m]));
  const counts = new Map<string, number>();
  for (const n of modules) counts.set(n, (counts.get(n) ?? 0) + 1);
  const total: string[] = [];
  if (effects?.speed) total.push(`${pct(effects.speed)} speed`);
  if (effects?.productivity) total.push(`${pct(effects.productivity)} prod`);
  if (effects?.consumption) total.push(`${pct(effects.consumption)} energy`);
  return (
    <div className="w-72 border border-border bg-popover p-3 text-sm text-popover-foreground shadow-xl">
      <div className="flex items-center gap-2 font-semibold">
        Module loadout
        {auto && <span className="bg-info/15 px-1 text-xs font-normal text-info">auto</span>}
      </div>
      {total.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-muted-foreground">
          {total.map((t) => (
            <span key={t}>{t}</span>
          ))}
          <span className="text-xs text-muted-foreground/60">· total for this row</span>
        </div>
      )}
      <div className="mt-2 space-y-1">
        {[...counts.entries()].map(([n, c]) => {
          const m = byName.get(n);
          const fx = m ? moduleEffects(m) : "";
          return (
            <div key={n} className="flex items-center gap-1.5">
              <Icon kind="item" name={n} size="sm" noHover />
              <span className="truncate">
                {c > 1 ? `${c}× ` : ""}
                {m?.display ?? n}
              </span>
              {fx && <span className="ml-auto shrink-0 text-xs text-success/90">{fx}</span>}
            </div>
          );
        })}
      </div>
      {beacons.length > 0 && (
        <div className="mt-2 border-t border-border pt-1.5">
          <FieldLabel className="mb-1 text-muted-foreground/70">beacons</FieldLabel>
          {beacons.map((b, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Icon kind="entity" name={b.beacon} size="sm" noHover />
              <span className="text-muted-foreground">×{b.count}</span>
              <span className="flex items-center gap-0.5">
                {b.modules.map((mn, j) => (
                  <Icon key={j} kind="item" name={mn} size="sm" noHover />
                ))}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {b.modules.map((mn) => byName.get(mn)?.display ?? mn).join(", ")}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 text-xs text-muted-foreground/70">click to edit</div>
    </div>
  );
}

/** One row of module slots: filled slots show the module (click to empty),
 * remaining slots render as dashed placeholders. */
function SlotRow({
  slots,
  modules,
  byName,
  onRemoveAt,
}: {
  slots: number;
  modules: string[];
  byName: Map<string, ModuleInfo>;
  onRemoveAt: (i: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {Array.from({ length: slots }, (_, i) => {
        const name = modules[i];
        return name ? (
          // Raw button on purpose: a sprite-sized slot tile — the Button
          // primitive's fixed heights don't fit the icon-grid density.
          <button
            key={i}
            onClick={() => onRemoveAt(i)}
            title={`${byName.get(name) ? moduleTitle(byName.get(name)!) : name} · click to remove`}
            className="border border-border bg-muted/50 p-0.5 hover:bg-destructive/20"
          >
            <Icon kind="item" name={name} size="md" noTitle />
          </button>
        ) : (
          <span
            key={i}
            className="inline-block border border-dashed border-border p-0.5"
            title="empty slot"
          >
            <span className="block" style={{ width: "var(--icon-md)", height: "var(--icon-md)" }} />
          </span>
        );
      })}
      {slots === 0 && <span className="text-sm text-muted-foreground">no module slots</span>}
    </div>
  );
}

/** Palette of eligible modules. click = fill next slot · shift-click = fill all
 * remaining · ctrl-click = remove all of that module. */
function Palette({
  modules,
  current,
  slots,
  onChange,
}: {
  modules: ModuleInfo[];
  current: string[];
  slots: number;
  onChange: (next: string[]) => void;
}) {
  const byCat = useMemo(() => {
    const g = new Map<string, ModuleInfo[]>();
    for (const m of modules) {
      const k = m.category ?? "other";
      g.set(k, [...(g.get(k) ?? []), m]);
    }
    return [...g.entries()];
  }, [modules]);
  const click = (m: ModuleInfo, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) return onChange(current.filter((n) => n !== m.name));
    if (e.shiftKey) {
      return onChange([...current, ...Array(Math.max(0, slots - current.length)).fill(m.name)]);
    }
    if (current.length < slots) onChange([...current, m.name]);
  };
  if (!modules.length)
    return <div className="text-sm text-muted-foreground">no eligible modules</div>;
  return (
    <div className="space-y-1.5">
      {byCat.map(([cat, mods]) => (
        <div key={cat} className="flex flex-wrap items-center gap-1">
          <span className="w-28 shrink-0 truncate text-sm text-muted-foreground" title={cat}>
            {cat}
          </span>
          {mods.map((m) => (
            // Raw button on purpose: sprite-sized palette tile (see SlotRow).
            <button
              key={m.name}
              onClick={(e) => click(m, e)}
              title={`${moduleTitle(m)}\nclick: add · shift: fill · ctrl: clear`}
              className="border border-border bg-muted/30 p-0.5 hover:bg-accent"
            >
              <Icon kind="item" name={m.name} size="md" noTitle />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Beacon variant picker. Py's (diet-)beacon-AM{a}-FM{f} families render as a
 * matrix (rows = AM, cols = FM); anything else falls back to a flat list. */
function BeaconMatrix({
  beacons,
  current,
  onPick,
}: {
  beacons: {
    name: string;
    display: string | null;
    distributionEffectivity: number | null;
    energyUsageW: number | null;
  }[];
  current: string;
  onPick: (name: string) => void;
}) {
  const families = useMemo(() => {
    const fam = new Map<
      string,
      Map<string, { name: string; display: string | null; de: number | null; w: number | null }>
    >();
    const flat: typeof beacons = [];
    for (const b of beacons) {
      const m = /^(.*beacon)-AM(\d)-FM(\d)$/.exec(b.name);
      if (m) {
        const key = m[1];
        (fam.get(key) ?? fam.set(key, new Map()).get(key)!).set(`${m[2]},${m[3]}`, {
          name: b.name,
          display: b.display,
          de: b.distributionEffectivity,
          w: b.energyUsageW,
        });
      } else flat.push(b);
    }
    return { fam: [...fam.entries()], flat };
  }, [beacons]);
  return (
    <div className="space-y-2">
      {families.fam.map(([family, cells]) => (
        <div key={family}>
          <div className="mb-1 text-sm text-muted-foreground">{family}</div>
          <div className="grid w-fit grid-cols-6 gap-px text-center text-sm">
            <span />
            {[1, 2, 3, 4, 5].map((f) => (
              <span key={f} className="px-1 text-muted-foreground">
                FM{f}
              </span>
            ))}
            {[1, 2, 3, 4, 5].map((a) => (
              <div key={a} className="contents">
                <span className="px-1 py-1 text-muted-foreground">AM{a}</span>
                {[1, 2, 3, 4, 5].map((f) => {
                  const c = cells.get(`${a},${f}`);
                  if (!c) return <span key={f} />;
                  const cur = c.name === current;
                  return (
                    // Raw button on purpose: a 5×5 matrix cell — the Button
                    // primitive's box would blow up the grid density.
                    <button
                      key={f}
                      onClick={() => onPick(c.name)}
                      aria-pressed={cur}
                      title={`${c.display ?? c.name} · ${mult(c.de)} effect · ${c.w != null ? fmtW(c.w) : "?"}`}
                      className={`px-1 py-1 ${
                        cur ? "bg-primary text-primary-foreground" : "bg-muted/40 hover:bg-accent"
                      }`}
                    >
                      {mult(c.de)}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
      {families.flat.map((b) => (
        <Button
          key={b.name}
          variant="toggle"
          size="sm"
          onClick={() => onPick(b.name)}
          aria-pressed={b.name === current}
          className="mr-1"
          title={`${b.display ?? b.name} · ${mult(b.distributionEffectivity)} effect · ${b.energyUsageW != null ? fmtW(b.energyUsageW) : "?"}`}
        >
          {b.display ?? b.name}
        </Button>
      ))}
    </div>
  );
}

export function ModulesModal({
  recipe,
  recipeDisplay,
  machineName,
  modules,
  beacons,
  effects,
  auto,
  onChange,
  onReset,
  onClose,
}: {
  recipe: string;
  recipeDisplay: string;
  machineName: string;
  modules: string[];
  beacons: BeaconConfig[];
  effects?: RowEffects;
  auto?: boolean;
  onChange: (modules: string[], beacons: BeaconConfig[]) => void;
  onReset?: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const picker = useQuery({
    queryKey: ["modulePicker", recipe, machineName],
    queryFn: () => modulePickerFn({ data: { recipe, machine: machineName } }),
  });
  const presets = useQuery({
    queryKey: ["modulePresets"],
    queryFn: () => listModulePresetsFn(),
  });
  const [variantFor, setVariantFor] = useState<number | null>(null); // beacon index choosing a variant

  const data = picker.data;
  const slots = data?.machine.moduleSlots ?? 0;
  const byName = useMemo(() => {
    const m = new Map<string, ModuleInfo>();
    for (const mod of [...(data?.modules ?? []), ...(data?.beaconModules ?? [])])
      m.set(mod.name, mod);
    return m;
  }, [data]);
  const beaconByName = useMemo(
    () => new Map((data?.beacons ?? []).map((b) => [b.name, b])),
    [data],
  );

  const setModules = (next: string[]) => onChange(next.slice(0, slots), beacons);
  const setBeacons = (next: BeaconConfig[]) => onChange(modules, next);
  const setBeaconAt = (i: number, cfg: BeaconConfig) =>
    setBeacons(beacons.map((b, j) => (j === i ? cfg : b)));

  const savePreset = async () => {
    const name = window.prompt("Preset name?")?.trim();
    if (!name) return;
    await saveModulePresetFn({ data: { name, modules, beacons } });
    void qc.invalidateQueries({ queryKey: ["modulePresets"] });
  };
  const deletePreset = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteModulePresetFn({ data: id });
    void qc.invalidateQueries({ queryKey: ["modulePresets"] });
  };

  const fx: string[] = [];
  if (effects?.speed) fx.push(`${pct(effects.speed)} speed`);
  if (effects?.productivity) fx.push(`${pct(effects.productivity)} productivity`);
  if (effects?.consumption) fx.push(`${pct(effects.consumption)} energy`);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="md:max-w-[42rem]">
        <DialogHeader className="pr-10">
          <DialogTitle className="truncate">Modules — {recipeDisplay}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          {picker.isLoading && (
            // approximate the loaded layout: effect badges, slot row, palette rows
            <div className="space-y-4">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}
          {data && (
            <>
              {/* live effect summary */}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {fx.length ? (
                  fx.map((s) => (
                    <Badge key={s} variant="secondary" className="text-success">
                      {s}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">no effects yet</span>
                )}
                {!data.allowProductivity && (
                  <span
                    className="flex items-center gap-1 text-sm text-muted-foreground"
                    title="this recipe does not accept productivity"
                  >
                    <Ban className="size-3.5 shrink-0" /> productivity not allowed
                  </span>
                )}
              </div>

              {/* auto-fill state */}
              {(auto || onReset) && (
                <div className="flex items-center gap-2 text-sm">
                  {auto ? (
                    <span className="text-info" title="chosen by the payback-economy auto-fill">
                      A auto-managed{modules.length === 0 ? " — no module pays back here" : ""} —
                      any edit takes manual control
                    </span>
                  ) : (
                    onReset && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onReset}
                        className="border-dashed text-muted-foreground"
                        title="drop the manual config and let auto-fill choose again"
                      >
                        <RotateCcw className="size-3.5" /> reset to auto
                      </Button>
                    )
                  )}
                </div>
              )}

              {/* presets */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                  Presets
                </span>
                {presets.data?.map((p) => (
                  <Button
                    key={p.id}
                    variant="outline"
                    size="sm"
                    onClick={() => onChange(p.modules.slice(0, slots), p.beacons)}
                    className="group"
                    title={`${p.modules.length} modules · ${p.beacons.length} beacon(s) — click to apply`}
                  >
                    {p.name}
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => deletePreset(p.id, e)}
                      className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                    >
                      <X className="size-3.5" />
                    </span>
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={savePreset}
                  className="border-dashed text-muted-foreground"
                  title="save the current loadout as a preset"
                >
                  + save
                </Button>
              </div>

              {/* machine slots */}
              <div>
                <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                  <Icon
                    kind="item"
                    name={data.machine.name}
                    size="sm"
                    title={data.machine.display ?? data.machine.name}
                  />
                  {data.machine.display ?? data.machine.name} · {modules.length}/{slots} slots
                  {modules.length > 0 && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setModules([])}
                      className="font-normal text-muted-foreground normal-case hover:text-destructive"
                    >
                      clear
                    </Button>
                  )}
                </div>
                <SlotRow
                  slots={slots}
                  modules={modules}
                  byName={byName}
                  onRemoveAt={(i) => setModules(modules.filter((_, j) => j !== i))}
                />
                <div className="mt-2">
                  <Palette
                    modules={data.modules}
                    current={modules}
                    slots={slots}
                    onChange={setModules}
                  />
                </div>
              </div>

              {/* beacons */}
              <div>
                <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                  Beacons
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      const first = data.beacons[0]?.name;
                      if (!first) return;
                      setBeacons([...beacons, { beacon: first, modules: [], count: 1 }]);
                      setVariantFor(beacons.length);
                    }}
                    className="border-dashed font-normal text-muted-foreground normal-case"
                  >
                    + add
                  </Button>
                </div>
                {beacons.length === 0 && (
                  <div className="text-sm text-muted-foreground">
                    none — Py machines take one beacon each; pick AM/FM to set its strength
                  </div>
                )}
                <div className="space-y-3">
                  {beacons.map((cfg, i) => {
                    const b = beaconByName.get(cfg.beacon);
                    const bSlots = b?.moduleSlots ?? 2;
                    const eligible = (b?.modules ?? [])
                      .map((n) => byName.get(n))
                      .filter((x): x is ModuleInfo => !!x);
                    return (
                      <div key={i} className="border border-border p-2">
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          {/* Raw button on purpose: an icon-tile chip (md sprite +
                              stats) — Button's fixed height doesn't fit it. */}
                          <button
                            onClick={() => setVariantFor(variantFor === i ? null : i)}
                            aria-expanded={variantFor === i}
                            className="flex items-center gap-1.5 bg-muted/50 px-1.5 py-1 text-sm hover:bg-accent"
                            title="click to change beacon variant"
                          >
                            <Icon kind="entity" name={cfg.beacon} size="md" noTitle />
                            <span>{b?.display ?? cfg.beacon}</span>
                            <span className="text-sm text-muted-foreground">
                              {mult(b?.distributionEffectivity)}
                              {b?.energyUsageW != null && ` · ${fmtW(b.energyUsageW)}`}
                            </span>
                          </button>
                          {/* per-machine beacon count stepper */}
                          <span className="flex items-center gap-1 text-sm">
                            <Button
                              variant="outline"
                              size="icon-xs"
                              onClick={() =>
                                setBeaconAt(i, { ...cfg, count: Math.max(1, cfg.count - 1) })
                              }
                            >
                              <Minus className="size-3.5" />
                            </Button>
                            <span title="beacons affecting each machine">{cfg.count}</span>
                            <Button
                              variant="outline"
                              size="icon-xs"
                              onClick={() => setBeaconAt(i, { ...cfg, count: cfg.count + 1 })}
                            >
                              <Plus className="size-3.5" />
                            </Button>
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => {
                              setBeacons(beacons.filter((_, j) => j !== i));
                              setVariantFor(null);
                            }}
                            className="ml-auto text-muted-foreground hover:text-destructive"
                            title="remove beacon"
                          >
                            <X className="size-3.5" />
                          </Button>
                        </div>
                        {variantFor === i && (
                          <div className="mb-2 bg-muted/20 p-2">
                            <BeaconMatrix
                              beacons={data.beacons}
                              current={cfg.beacon}
                              onPick={(name) => {
                                setBeaconAt(i, { ...cfg, beacon: name });
                                setVariantFor(null);
                              }}
                            />
                          </div>
                        )}
                        <SlotRow
                          slots={bSlots}
                          modules={cfg.modules}
                          byName={byName}
                          onRemoveAt={(j) =>
                            setBeaconAt(i, {
                              ...cfg,
                              modules: cfg.modules.filter((_, k) => k !== j),
                            })
                          }
                        />
                        <div className="mt-1.5">
                          <Palette
                            modules={eligible}
                            current={cfg.modules}
                            slots={bSlots}
                            onChange={(next) =>
                              setBeaconAt(i, { ...cfg, modules: next.slice(0, bSlots) })
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
