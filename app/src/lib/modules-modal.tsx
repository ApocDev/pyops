import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Ban, Minus, Plus, RotateCcw, SquarePlus, X } from "lucide-react";
import {
  deleteModulePresetFn,
  listModulePresetsFn,
  modulePickerFn,
  saveModulePresetFn,
  type BeaconConfig,
} from "../server/factorio";
import { Badge } from "#/components/ui/badge.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
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
  const fx: string[] = [];
  if (effects?.speed) fx.push(`${pct(effects.speed)} speed`);
  if (effects?.productivity) fx.push(`${pct(effects.productivity)} prod`);
  if (effects?.consumption) fx.push(`${pct(effects.consumption)} energy`);
  const empty = !modules.length && !beacons.length;
  return (
    <button
      onClick={onClick}
      title={
        empty
          ? auto
            ? "auto-managed — no module is worth it here (payback economy) · click to override"
            : "no modules — click to configure"
          : `${auto ? "auto-filled (payback economy) · " : ""}${fx.join(" · ") || "modules"} · click to edit`
      }
      className={`flex items-center gap-1 rounded px-1.5 py-1 text-sm hover:bg-accent ${
        empty
          ? "border border-dashed border-border text-muted-foreground"
          : "bg-muted/50 text-emerald-300"
      }`}
    >
      {empty && <SquarePlus className="size-4" />}
      {auto && (
        <span className="text-sm text-sky-300" title="auto-managed — open to override">
          A
        </span>
      )}
      {grouped.map(([n, c]) => (
        <span key={n} className="flex items-center">
          <Icon kind="item" name={n} size="sm" noTitle />
          {c > 1 && <span className="text-sm">×{c}</span>}
        </span>
      ))}
      {beacons.map((b, i) => (
        <span key={i} className="flex items-center gap-0.5" title={`${b.count}× ${b.beacon}`}>
          <Icon kind="entity" name={b.beacon} size="sm" noTitle />
          {b.modules.map((mn, j) => (
            <Icon key={j} kind="item" name={mn} size="sm" noTitle />
          ))}
        </span>
      ))}
    </button>
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
          <button
            key={i}
            onClick={() => onRemoveAt(i)}
            title={`${byName.get(name) ? moduleTitle(byName.get(name)!) : name} · click to remove`}
            className="rounded border border-border bg-muted/50 p-0.5 hover:bg-destructive/20"
          >
            <Icon kind="item" name={name} size="md" noTitle />
          </button>
        ) : (
          <span
            key={i}
            className="inline-block rounded border border-dashed border-border p-0.5"
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
            <button
              key={m.name}
              onClick={(e) => click(m, e)}
              title={`${moduleTitle(m)}\nclick: add · shift: fill · ctrl: clear`}
              className="rounded border border-border bg-muted/30 p-0.5 hover:bg-accent"
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
                    <button
                      key={f}
                      onClick={() => onPick(c.name)}
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
        <button
          key={b.name}
          onClick={() => onPick(b.name)}
          className={`mr-1 rounded border border-border px-2 py-1 text-sm ${b.name === current ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          title={`${b.display ?? b.name} · ${mult(b.distributionEffectivity)} effect · ${b.energyUsageW != null ? fmtW(b.energyUsageW) : "?"}`}
        >
          {b.display ?? b.name}
        </button>
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
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/55 p-10"
      onClick={onClose}
    >
      <Card
        className="max-h-[85vh] w-[42rem] overflow-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader className="justify-between">
          <CardTitle className="normal-case">Modules — {recipeDisplay}</CardTitle>
          <button className="text-muted-foreground hover:text-foreground" onClick={onClose}>
            <X className="size-4" />
          </button>
        </CardHeader>
        <div className="space-y-4 p-3">
          {picker.isLoading && <div className="text-muted-foreground">…</div>}
          {data && (
            <>
              {/* live effect summary */}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {fx.length ? (
                  fx.map((s) => (
                    <Badge key={s} variant="secondary" className="text-emerald-300">
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
                    <span className="text-sky-300" title="chosen by the payback-economy auto-fill">
                      A auto-managed{modules.length === 0 ? " — no module pays back here" : ""} —
                      any edit takes manual control
                    </span>
                  ) : (
                    onReset && (
                      <button
                        onClick={onReset}
                        className="flex items-center gap-1 rounded border border-dashed border-border px-1.5 py-0.5 text-muted-foreground hover:bg-accent"
                        title="drop the manual config and let auto-fill choose again"
                      >
                        <RotateCcw className="size-3.5" /> reset to auto
                      </button>
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
                  <button
                    key={p.id}
                    onClick={() => onChange(p.modules.slice(0, slots), p.beacons)}
                    className="group flex items-center gap-1 rounded border border-border bg-muted/30 px-1.5 py-0.5 text-sm hover:bg-accent"
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
                  </button>
                ))}
                <button
                  onClick={savePreset}
                  className="rounded border border-dashed border-border px-1.5 py-0.5 text-sm text-muted-foreground hover:bg-accent"
                  title="save the current loadout as a preset"
                >
                  + save
                </button>
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
                    <button
                      onClick={() => setModules([])}
                      className="text-muted-foreground normal-case hover:text-destructive"
                    >
                      clear
                    </button>
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
                  <button
                    onClick={() => {
                      const first = data.beacons[0]?.name;
                      if (!first) return;
                      setBeacons([...beacons, { beacon: first, modules: [], count: 1 }]);
                      setVariantFor(beacons.length);
                    }}
                    className="rounded border border-dashed border-border px-1.5 normal-case text-muted-foreground hover:bg-accent"
                  >
                    + add
                  </button>
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
                      <div key={i} className="rounded border border-border p-2">
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => setVariantFor(variantFor === i ? null : i)}
                            className="flex items-center gap-1.5 rounded bg-muted/50 px-1.5 py-1 text-sm hover:bg-accent"
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
                            <button
                              onClick={() =>
                                setBeaconAt(i, { ...cfg, count: Math.max(1, cfg.count - 1) })
                              }
                              className="flex items-center rounded border border-border px-1.5 py-1 hover:bg-accent"
                            >
                              <Minus className="size-3.5" />
                            </button>
                            <span title="beacons affecting each machine">{cfg.count}</span>
                            <button
                              onClick={() => setBeaconAt(i, { ...cfg, count: cfg.count + 1 })}
                              className="flex items-center rounded border border-border px-1.5 py-1 hover:bg-accent"
                            >
                              <Plus className="size-3.5" />
                            </button>
                          </span>
                          <button
                            onClick={() => {
                              setBeacons(beacons.filter((_, j) => j !== i));
                              setVariantFor(null);
                            }}
                            className="ml-auto text-muted-foreground hover:text-destructive"
                            title="remove beacon"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                        {variantFor === i && (
                          <div className="mb-2 rounded bg-muted/20 p-2">
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
      </Card>
    </div>
  );
}
