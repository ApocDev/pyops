import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActiveEditorRefContext } from "./block";
import {
  blocksForGoodFn,
  bridgeShowBlockFn,
  goodInfoFn,
  itemWeightsFn,
  loadBlockFn,
  logisticsContextFn,
  machineOptionsFn,
  recipeCandidatesFn,
  saveBlockFn,
  searchAllFn,
  solveBlockFn,
} from "../server/factorio";
import type { BeaconConfig } from "../server/factorio";
import {
  type ResolvedLogistics,
  launchesForRate,
  resolveLogistics,
  rowLogistics,
} from "../lib/logistics";
import { bridgeLocateFn } from "../server/bridge/fns";
import { tasksForBlockFn } from "../server/tasks.ts";
import type { Disposition } from "../solver/block";
import { Icon, IconProvider } from "../lib/icons";
import { ModulesChip, ModulesModal } from "../lib/modules-modal";
import { Copy, Gamepad2, Rocket } from "lucide-react";
import { ItemHover, RecipeHover, TechLine } from "../lib/recipe-card";
import { Badge } from "#/components/ui/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";
import { Input } from "#/components/ui/input.tsx";

export const Route = createFileRoute("/block/$id")({ component: BlockRoute });

// Remount the editor per id (key) so each block is a fresh instance: load on
// mount, auto-save on edit, flush on unmount — no cross-block state to untangle.
function BlockRoute() {
  const { id } = Route.useParams();
  return (
    <IconProvider>
      <Block key={id} blockId={Number(id)} />
    </IconProvider>
  );
}
const head =
  "px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border";

/** Reverse view of task→block links: the planner tasks that reference this
 * block, each linking back to it on the tasks page. Hidden when none. */
function BlockTasks({ blockId }: { blockId: number }) {
  const tasks = useQuery({
    queryKey: ["tasks-for-block", blockId],
    queryFn: () => tasksForBlockFn({ data: blockId }),
  });
  const list = tasks.data ?? [];
  if (list.length === 0) return null;
  return (
    <Card className="mb-4">
      <div className={head}>Tasks ({list.length})</div>
      <CardContent className="space-y-0.5 py-2">
        {list.map((t) => {
          const total = t.stepTotal + t.childTotal;
          const done = t.stepDone + t.childDone;
          return (
            <Link
              key={t.id}
              to="/tasks"
              search={{ tab: "tasks", t: t.id }}
              className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted"
            >
              <span
                className={`size-2 shrink-0 rounded-full ${t.done ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
              />
              <span
                className={`min-w-0 flex-1 truncate ${t.done ? "text-muted-foreground line-through" : ""}`}
              >
                {t.title || "Untitled task"}
              </span>
              {total > 0 && (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {done}/{total}
                </span>
              )}
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
const rowBtn = "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-muted";
const craftableStyle = "border border-dashed border-amber-400/60 bg-amber-500/10 text-amber-200";
const num = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2));
// goal-rate display: enough precision to be exact, trailing zeros trimmed
const fmtRate = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return "0";
  const s = Math.abs(n) >= 1000 ? n.toFixed(0) : n.toFixed(4);
  return s.replace(/\.?0+$/, "");
};

/** A rate shown as plain text ("1.0623/s") that turns into an input on click;
 * commits on blur/Enter, reverts on Escape. Read-only mode just renders the text. */
function EditableRate({
  value,
  readOnly,
  onChange,
}: {
  value: number;
  readOnly?: boolean;
  onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (!editing) {
    return (
      <button
        onClick={() => {
          if (readOnly) return;
          setDraft(String(value));
          setEditing(true);
        }}
        title={readOnly ? "sized by a locked input" : "click to edit the goal rate"}
        className={`tabular-nums ${readOnly ? "text-muted-foreground" : "hover:text-sky-300"}`}
      >
        {fmtRate(value)}
        <span className="text-muted-foreground">/s</span>
      </button>
    );
  }
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n >= 0) onChange(n);
    setEditing(false);
  };
  return (
    <input
      autoFocus
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className="w-16 rounded border border-sky-400/60 bg-muted px-1 py-0.5 text-center text-sm"
    />
  );
}
const fmtW = (w: number) =>
  w >= 1e9
    ? `${(w / 1e9).toFixed(2)} GW`
    : w >= 1e6
      ? `${(w / 1e6).toFixed(2)} MW`
      : w >= 1e3
        ? `${(w / 1e3).toFixed(0)} kW`
        : `${w.toFixed(0)} W`;
const fmtJ = (j: number) =>
  j >= 1e9
    ? `${(j / 1e9).toFixed(1)} GJ`
    : j >= 1e6
      ? `${(j / 1e6).toFixed(1)} MJ`
      : j >= 1e3
        ? `${(j / 1e3).toFixed(0)} kJ`
        : `${j.toFixed(0)} J`;
// compact YAFC-style cell chip: icon + number, clickable
const cellChip = "flex items-center gap-1 rounded bg-muted/50 px-1.5 py-1 text-sm hover:bg-accent";
// io amounts: integers stay clean ("50", "1000"), long numbers humanize ("1.2k")
const fmtAmt = (n: number) => {
  const r = Math.round(n * 100) / 100;
  const plain = String(r);
  if (plain.length <= 5) return plain;
  for (const [div, suf] of [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ] as const) {
    if (Math.abs(r) >= div) return `${Math.round((r / div) * 10) / 10}${suf}`;
  }
  return plain;
};
// cost-analysis values span 0.001 … 500k — compact but readable
const fmtCost = (c: number) =>
  c >= 1e6
    ? `${(c / 1e6).toFixed(1)}M`
    : c >= 1e3
      ? `${(c / 1e3).toFixed(1)}k`
      : c >= 10
        ? c.toFixed(0)
        : c.toFixed(2);

/** A block item's role under the current solve — drives the chip colour so it's
 * obvious which flows are linked internally vs. need a recipe vs. spill out. */
type Link = "target" | "import" | "export" | "linked";
const linkStyle: Record<Link, string> = {
  target: "bg-blue-500/20 ring-1 ring-blue-400/40 text-blue-200",
  import: "bg-amber-500/20 ring-1 ring-amber-400/40 text-amber-200", // nothing in-block makes it
  export: "bg-violet-500/20 ring-1 ring-violet-400/40 text-violet-200", // surplus, nothing consumes it
  linked: "bg-emerald-500/15 ring-1 ring-emerald-400/30 text-emerald-200", // produced AND consumed in-block
};

/** Disposition override cycle (alt/right-click) + how the small tag reads. */
const DISP_CYCLE = ["auto", "import", "export", "balance"] as const;
const dispTag: Record<Disposition, { label: string; cls: string }> = {
  import: { label: "→ import", cls: "bg-amber-500/30 text-amber-200" },
  export: { label: "→ export", cls: "bg-violet-500/30 text-violet-200" },
  balance: { label: "= balance", cls: "bg-emerald-500/30 text-emerald-200" },
};

/** Clickable ingredient/product pill: icon + rate, tinted by link state. Click
 * opens the recipe picker (produce for an input, consume for an output).
 * A craftable import (a recipe exists to make it) gets a dashed ring + "＋" so
 * it reads as "you could make this in-block"; a raw import is solid.
 * Alt-click / right-click cycles the solver disposition; when overridden, a
 * small tag shows the forced state (click the tag to clear back to auto). */
function ItemChip({
  name,
  kind,
  display,
  rate,
  link,
  craftable,
  disp,
  onClick,
  onCycleDisp,
  onClearDisp,
  onContext,
}: {
  name: string;
  kind: string;
  display?: string | null;
  rate?: number;
  link: Link;
  craftable?: boolean;
  disp?: Disposition;
  onClick: () => void;
  onCycleDisp?: () => void;
  onClearDisp?: () => void;
  onContext?: (e: { clientX: number; clientY: number }) => void;
}) {
  const craftableImport = link === "import" && craftable;
  const cls = craftableImport ? craftableStyle : linkStyle[link];
  const why = craftableImport
    ? "craftable — click to add a producer"
    : link === "import"
      ? "raw input — supply externally"
      : link;
  return (
    <span className="inline-flex items-center gap-1">
      <ItemHover
        name={name}
        kind={kind as "item" | "fluid"}
        className="inline-flex"
        // the rich card (cost, produced-by / used-in) replaces the old native title;
        // role is the chip colour, rate is shown on the chip, alt-click hint is in the legend
      >
        <button
          onClick={(e) => {
            if (e.altKey && onCycleDisp) return onCycleDisp();
            onClick();
          }}
          onContextMenu={(e) => {
            if (!onContext) return;
            e.preventDefault();
            onContext(e);
          }}
          aria-label={`${display ?? name}${rate != null ? ` ${num(rate)}/s` : ""} · ${why}`}
          className={`flex items-center gap-1 rounded px-1.5 py-1 text-sm hover:brightness-95 ${cls} ${
            disp ? "ring-2 ring-sky-400/60" : ""
          }`}
        >
          <Icon kind={kind as "item" | "fluid"} name={name} size="md" noTitle />
          {rate != null && <span>{num(rate)}</span>}
          {craftableImport && <span className="font-bold text-amber-300">＋</span>}
        </button>
      </ItemHover>
      {disp && (
        <button
          onClick={onClearDisp}
          title="forced disposition — click to clear back to auto"
          className={`rounded px-1 py-0.5 text-sm ${dispTag[disp].cls} hover:brightness-110`}
        >
          {dispTag[disp].label}
        </button>
      )}
    </span>
  );
}

const fmtCount = (n: number) =>
  !Number.isFinite(n)
    ? "∞"
    : n === 0
      ? "0"
      : n < 0.01
        ? "<0.01"
        : n >= 10
          ? n.toFixed(0)
          : n >= 1
            ? n.toFixed(1)
            : n.toFixed(2);

/** Compact per-item logistics readout under a chip: belts to carry the row's whole
 * flow of this item, devices (inserters/loaders) to move it in/out of ONE building,
 * and — when rockets are on — rocket launches/min. Devices are omitted on
 * building-less rows; `launch` is omitted unless the rocket toggle is on. */
function LogiTag({
  resolved,
  rate,
  machineCount,
  showBelts,
  showInserters,
  launch,
}: {
  resolved: ResolvedLogistics;
  rate: number;
  machineCount: number;
  showBelts: boolean;
  showInserters: boolean;
  launch?: { perMin: number; defaulted: boolean } | null;
}) {
  if (!(rate > 1e-9)) return null;
  const r = rowLogistics(resolved, rate, machineCount);
  if (!r) return null;
  const beltOn = showBelts;
  const insOn = showInserters && machineCount > 1e-9; // per-building → rows only
  const rocketOn = !!launch;
  if (!beltOn && !insOn && !rocketOn) return null;
  const beltName = resolved.belt?.name;
  const beltDisp = resolved.belt?.display ?? beltName;
  const moverName =
    resolved.moverKind === "loader" ? resolved.loader?.name : resolved.inserter?.name;
  const moverDisp =
    (resolved.moverKind === "loader" ? resolved.loader?.display : resolved.inserter?.display) ??
    moverName;
  const title = [
    beltOn && `≈${fmtCount(r.belts)} × ${beltDisp}`,
    insOn && `≈${fmtCount(r.devices)} × ${moverDisp} per building`,
    rocketOn &&
      `≈${fmtCount(launch.perMin)} rocket launches/min${launch.defaulted ? " (default item weight — not set in data)" : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="flex items-center gap-2.5 pl-1 text-xs text-muted-foreground" title={title}>
      {beltOn && beltName && (
        <span className="inline-flex items-center gap-1.5">
          <Icon kind="entity" name={beltName} size="sm" noTitle />
          <span className="tabular-nums">{fmtCount(r.belts)}</span>
        </span>
      )}
      {insOn && moverName && (
        <span className="inline-flex items-center gap-1.5">
          <Icon kind="entity" name={moverName} size="sm" noTitle />
          <span className="tabular-nums">{fmtCount(r.devices)}</span>
        </span>
      )}
      {rocketOn && (
        <span
          className={`inline-flex items-center gap-1.5 ${launch.defaulted ? "opacity-60" : ""}`}
        >
          <Rocket className="size-3.5" />
          <span className="tabular-nums">{fmtCount(launch.perMin)}/m</span>
        </span>
      )}
    </span>
  );
}

/** One row in the chip right-click context menu. */
function CtxBtn({
  children,
  onClick,
  active,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center px-3 py-1 text-left text-sm hover:bg-muted ${active ? "text-sky-300" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

function Block({ blockId }: { blockId: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [target, setTarget] = useState("");
  const [rate, setRate] = useState(1);
  const [extraGoals, setExtraGoals] = useState<string[]>([]); // extra co-product goals (primary)
  // goal-item picker dialog: null = closed, {} = adding a new goal, {replace} = changing that goal's item
  const [goalPicker, setGoalPicker] = useState<null | { replace?: string }>(null);
  // right-click menu on a goal cell (change item / make primary / remove)
  const [goalMenu, setGoalMenu] = useState<{ x: number; y: number; name: string } | null>(null);
  // right-click context menu on a good chip (explicit actions instead of cycling)
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    name: string;
    kind: string;
    link: Link;
  } | null>(null);
  const locate = useMutation({
    mutationFn: (d: { name: string; kind: "item" | "fluid" }) => bridgeLocateFn({ data: d }),
  });
  // Which other blocks already make the good under the context menu — so an import
  // can jump to its producer, or spin up a new block to supply it.
  const ctxProducers = useQuery({
    queryKey: ["blocksForGood", ctxMenu?.name],
    queryFn: () => blocksForGoodFn({ data: ctxMenu!.name }),
    enabled: !!ctxMenu,
    staleTime: 0,
  });
  const [lockedInput, setLockedInput] = useState<string | null>(null); // import pinned to size the block
  const [lockedRate, setLockedRate] = useState(0); // the rate that import is pinned to
  const [recipes, setRecipes] = useState<string[]>([]);
  const [disp, setDisp] = useState<Record<string, Disposition>>({});
  const [machineSel, setMachineSel] = useState<Record<string, string>>({}); // recipe → machine
  const [fuelSel, setFuelSel] = useState<Record<string, string>>({}); // recipe → fuel
  const [moduleSel, setModuleSel] = useState<Record<string, string[]>>({}); // recipe → modules
  const [beaconSel, setBeaconSel] = useState<Record<string, BeaconConfig[]>>({}); // recipe → beacons
  const [search, setSearch] = useState("");
  const [pickFor, setPickFor] = useState<{ name: string; mode: "produce" | "consume" } | null>(
    null,
  );
  const [pickMachineFor, setPickMachineFor] = useState<string | null>(null); // recipe whose machine we're choosing
  const [pickFuelFor, setPickFuelFor] = useState<string | null>(null); // recipe whose fuel we're choosing
  const [pickModulesFor, setPickModulesFor] = useState<string | null>(null); // recipe whose modules we're editing
  const [blockName, setBlockName] = useState("");
  // Until the user names a block themselves, its name tracks the primary goal's
  // display. `nameCustom` flips true once they type a name (back to false if they
  // clear it); `customDecided` makes the post-hydrate decision run only once.
  const [nameCustom, setNameCustom] = useState(false);
  const customDecided = useRef(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  // Load this block on mount (the editor is keyed by id, so this runs once per
  // block). Auto-save stays suppressed until `hydrated` flips.
  const loaded = useQuery({
    queryKey: ["block", blockId],
    queryFn: () => loadBlockFn({ data: blockId }),
    enabled: Number.isFinite(blockId),
    // never hydrate from a stale cache entry: drop it on unmount so reopening
    // always fetches the freshly-saved doc (otherwise a re-opened block can show
    // — and then auto-save — the old state it was first loaded with)
    gcTime: 0,
    staleTime: 0,
  });
  const hydrated = useRef(false);
  // becomes true ONLY when a user-edit handler fires (markEdited); the auto-save
  // is gated on it so hydration / refetch / state-settling never persists.
  const dirty = useRef(false);
  const markEdited = () => {
    dirty.current = true;
  };
  useEffect(() => {
    if (hydrated.current || !loaded.data) return;
    hydrated.current = true;
    const d = loaded.data.data;
    setTarget(d.target ?? "");
    setRate(d.rate ?? 1);
    setExtraGoals(d.extraGoals ?? []);
    setRecipes(d.recipes ?? []);
    setDisp((d.dispositions ?? {}) as Record<string, Disposition>);
    setMachineSel(d.machines ?? {});
    setFuelSel(d.fuels ?? {});
    setModuleSel(d.modules ?? {});
    setBeaconSel((d.beacons ?? {}) as Record<string, BeaconConfig[]>);
    setBlockName(loaded.data.name);
  }, [loaded.data]);

  const copySetup = () => {
    void navigator.clipboard?.writeText(
      JSON.stringify(
        { target, rate, recipes, disp, machineSel, fuelSel, moduleSel, beaconSel },
        null,
        2,
      ),
    );
  };
  // Push this block to the game as an in-game build sheet (buildings clickable for
  // a configured blueprint). Saves first so the mod renders the current solve.
  const showInGame = useMutation({
    mutationFn: async () => {
      await persist();
      return bridgeShowBlockFn({ data: blockId });
    },
  });
  const pickMachine = (recipe: string, m: string) => {
    markEdited();
    setMachineSel((s) => ({ ...s, [recipe]: m }));
  };
  const pickFuel = (recipe: string, f: string) => {
    markEdited();
    setFuelSel((s) => ({ ...s, [recipe]: f }));
  };
  const setDispFor = (name: string, d: Disposition | "auto") => {
    markEdited();
    setDisp((m) => {
      const next = { ...m };
      if (d === "auto") delete next[name];
      else next[name] = d;
      return next;
    });
  };
  const cycleDispFor = (name: string) => {
    const i = DISP_CYCLE.indexOf(disp[name] ?? "auto");
    setDispFor(name, DISP_CYCLE[(i + 1) % DISP_CYCLE.length]);
  };
  // Goals: the primary target (sizing anchor + rate) plus unpinned co-products.
  // The first goal picked becomes the primary; the rest are co-products.
  const addGoal = (name: string) => {
    markEdited();
    if (!target) setTarget(name);
    else if (name !== target && !extraGoals.includes(name)) setExtraGoals((gs) => [...gs, name]);
  };
  const removeGoal = (name: string) => {
    markEdited();
    if (name === target) {
      // primary removed: promote the first co-product (if any) to keep the invariant
      const [next, ...rest] = extraGoals;
      setTarget(next ?? "");
      setExtraGoals(rest);
    } else {
      setExtraGoals((gs) => gs.filter((x) => x !== name));
    }
  };
  // Spin up a fresh block that produces `name` (e.g. to supply an import), sized
  // to the rate this block needs, and open it. Recipes are left for the user to
  // pick — same starting point as "New block", but pre-seeded with the goal.
  const createSupplier = async (name: string, rate: number) => {
    const res2 = await saveBlockFn({
      data: { data: { target: name, rate: rate > 0 ? +rate.toFixed(4) : 1, recipes: [] } },
    });
    void qc.invalidateQueries({ queryKey: ["blocks"] });
    void navigate({ to: "/block/$id", params: { id: String(res2.id) } });
  };
  // Swap a goal's item in place (keeps primary vs co-product role).
  const changeGoalItem = (from: string, to: string) => {
    markEdited();
    if (to === from) return;
    if (from === target) {
      setExtraGoals((gs) => gs.filter((x) => x !== to)); // avoid a dup if `to` was a co-product
      setTarget(to);
    } else {
      setExtraGoals((gs) =>
        gs
          .map((x) => (x === from ? to : x))
          .filter((x, i, a) => x !== target && a.indexOf(x) === i),
      );
    }
  };
  // The goal-picker dialog routes to add / change depending on how it was opened.
  const pickGoalItem = (name: string) => {
    if (goalPicker?.replace) changeGoalItem(goalPicker.replace, name);
    else addGoal(name);
    setSearch("");
    setGoalPicker(null);
  };
  // Promote a co-product to the primary (sizing) goal; the old primary becomes one.
  const makePrimary = (name: string) => {
    markEdited();
    setExtraGoals((gs) => [target, ...gs.filter((x) => x !== name)]);
    setTarget(name);
  };

  const hasDisp = Object.keys(disp).length > 0;
  // prune empty module/beacon entries so they don't bloat the saved doc
  // module entries are kept even when EMPTY: an explicit [] means "no modules"
  // and suppresses auto-fill for that row ("reset to auto" deletes the key)
  const modulesUsed = moduleSel;
  const beaconsUsed = Object.fromEntries(Object.entries(beaconSel).filter(([, v]) => v.length));
  const solveInput = {
    target,
    rate,
    recipes,
    ...(extraGoals.length ? { extraGoals } : {}),
    ...(hasDisp ? { dispositions: disp } : {}),
    ...(Object.keys(machineSel).length ? { machines: machineSel } : {}),
    ...(Object.keys(fuelSel).length ? { fuels: fuelSel } : {}),
    ...(Object.keys(modulesUsed).length ? { modules: modulesUsed } : {}),
    ...(Object.keys(beaconsUsed).length ? { beacons: beaconsUsed } : {}),
  };
  const items = useQuery({
    queryKey: ["bsearch", search],
    queryFn: () => searchAllFn({ data: search }),
    enabled: search.trim().length > 0,
  });
  // kind + display for the goal cells, so a fluid goal (e.g. crude-oil) icons
  // correctly even before any recipe makes it appear in the solve's flows, and so
  // the block can auto-name itself from its primary goal pre-solve.
  const goalNames = target ? [target, ...extraGoals] : [];
  const goalInfo = useQuery({
    queryKey: ["goalInfo", goalNames],
    queryFn: () => goodInfoFn({ data: goalNames }),
    enabled: goalNames.length > 0,
  });
  // Auto-name the block after its primary goal until the user names it themselves.
  // The first run after hydrate decides whether the loaded name was custom; after
  // that, the name follows the primary goal whenever it changes (unless custom).
  useEffect(() => {
    if (!hydrated.current || !target) return;
    const info = goalInfo.data?.[target];
    if (!info) return; // wait until we know the goal's display name
    const auto = info.display;
    if (!customDecided.current) {
      customDecided.current = true;
      const stored = blockName.trim();
      const wasCustom = !!stored && stored !== auto && stored !== "New block";
      setNameCustom(wasCustom);
      if (wasCustom) return;
    }
    if (!nameCustom && blockName !== auto) {
      markEdited();
      setBlockName(auto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, goalInfo.data, nameCustom, blockName]);
  const solve = useQuery({
    queryKey: [
      "solve",
      target,
      rate,
      extraGoals,
      recipes,
      disp,
      machineSel,
      fuelSel,
      moduleSel,
      beaconSel,
    ],
    queryFn: () => solveBlockFn({ data: solveInput }),
    enabled: !!target,
    // keep the last result while a re-solve is in flight — otherwise every edit
    // briefly unmounts everything derived from `res` (incl. open modals)
    placeholderData: keepPreviousData,
  });
  // Auto-save (debounced) to the DB, plus a flush on unmount so switching blocks
  // never drops edits. `latest` holds the newest state for the timeout / flush.
  // CRITICAL: we only ever save when `dirty` is set, and `dirty` is set ONLY by
  // real user-edit handlers (markEdited) — never by hydration or state settling.
  // Hydrating a block (incl. from a fresh refetch) must not trigger a write, or
  // re-opening a block would clobber it with whatever it loaded.
  const latest = useRef({ solveInput, blockName });
  latest.current = { solveInput, blockName };
  const persist = () => {
    dirty.current = false;
    setSaveState("saving");
    return saveBlockFn({
      data: {
        id: blockId,
        name: latest.current.blockName.trim() || undefined,
        data: latest.current.solveInput,
      },
    })
      .then(() => {
        setSaveState("saved");
        void qc.invalidateQueries({ queryKey: ["blocks"] });
      })
      .catch(() => {
        dirty.current = true; // failed — stay dirty so a later edit retries
        setSaveState("idle");
      });
  };
  useEffect(() => {
    if (!hydrated.current || !dirty.current) return;
    const t = setTimeout(persist, 700);
    return () => clearTimeout(t);
  }, [target, rate, recipes, disp, machineSel, fuelSel, moduleSel, beaconSel, blockName]);
  useEffect(
    () => () => {
      if (hydrated.current && dirty.current) void persist();
    },
    [],
  );

  // Report this (active) block's live emptiness so closing its tab can discard an
  // untouched "New block" without racing the unmount auto-save above. Cleared on
  // unmount so a stale reading can't outlive the editor.
  const activeEditorRef = useContext(ActiveEditorRefContext);
  const isEmpty = !target && recipes.length === 0 && extraGoals.length === 0;
  useEffect(() => {
    if (activeEditorRef) activeEditorRef.current = { id: blockId, empty: isEmpty };
  });
  useEffect(
    () => () => {
      if (activeEditorRef && activeEditorRef.current?.id === blockId)
        activeEditorRef.current = null;
    },
    [activeEditorRef, blockId],
  );

  const picker = useQuery({
    queryKey: ["pick", pickFor?.name, pickFor?.mode],
    queryFn: () => recipeCandidatesFn({ data: { name: pickFor!.name, mode: pickFor!.mode } }),
    enabled: !!pickFor,
  });
  const machineOpts = useQuery({
    queryKey: ["machineOpts", pickMachineFor],
    queryFn: () => machineOptionsFn({ data: pickMachineFor! }),
    enabled: !!pickMachineFor,
  });
  // Per-row belts & inserters readout (#21). Fetched once; the math runs client-side
  // (resolveLogistics) so changing belt/inserter tier from the header is instant.
  const logistics = useQuery({
    queryKey: ["logisticsContext"],
    queryFn: () => logisticsContextFn(),
    refetchInterval: 5000,
  });
  const logiPrefs = logistics.data?.prefs;
  const logiAny =
    !!logiPrefs && (logiPrefs.showBelts || logiPrefs.showInserters || logiPrefs.showRockets);
  const logiResolved = logiAny && logistics.data ? resolveLogistics(logistics.data) : null;
  const showBelts = !!logiPrefs?.showBelts;
  const showInserters = !!logiPrefs?.showInserters;

  const add = (name: string) => {
    markEdited();
    setRecipes((rs) => (rs.includes(name) ? rs : [...rs, name]));
    setPickFor(null);
  };
  const drop = (name: string) => {
    markEdited();
    setRecipes((rs) => rs.filter((r) => r !== name));
  };
  const res = solve.data;

  // "Size by input": locking an import makes the Goal read-only and drives the
  // block's size from that input's rate instead. The solve is linear in the target,
  // so target = desired × rate / currentImportRate. This effect re-applies the lock
  // whenever the solve changes (e.g. recipes edited), keeping the pinned input at its
  // rate; it's guarded so it converges (back-solving makes the import == desired).
  useEffect(() => {
    if (!lockedInput || !res) return;
    const imp = res.imports.find((f) => f.name === lockedInput);
    if (!imp) {
      setLockedInput(null); // the pinned input is no longer consumed — drop the lock
      return;
    }
    if (imp.rate > 0 && rate > 0 && Math.abs(imp.rate - lockedRate) > 1e-3) {
      markEdited();
      setRate((r) => +((lockedRate * r) / imp.rate).toFixed(4));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, lockedInput, lockedRate]);

  const freed = new Set(res?.autoFreed ?? []);
  const statusColor =
    res?.status === "solved"
      ? "text-emerald-400"
      : res?.status === "infeasible"
        ? "text-destructive"
        : "text-amber-400";

  // Per-item link state from the solve, so each chip can show whether it's the
  // goal, an unmade input (import), a surplus (export), or balanced in-block.
  const importSet = new Set(res?.imports.map((f) => f.name));
  const exportSet = new Set(res?.exports.map((f) => f.name));
  // good → kind (item|fluid), gathered from every flow/recipe in the solve so goal
  // icons render correctly even for fluid goals (the target isn't in imports/exports).
  const kindMap = new Map<string, string>();
  for (const r of res?.rows ?? []) {
    for (const p of r.products) kindMap.set(p.name, p.kind);
    for (const c of r.ingredients) kindMap.set(c.name, c.kind);
  }
  for (const f of [...(res?.imports ?? []), ...(res?.exports ?? []), ...(res?.extraOutputs ?? [])])
    kindMap.set(f.name, f.kind);
  const kindOf = (name: string) =>
    (kindMap.get(name) ?? goalInfo.data?.[name]?.kind ?? "item") as "item" | "fluid";

  // Rocket launches/min (#22) — opt-in, niche. Fetch weights for every item shown,
  // then `launchInfo` turns a flow rate into launches/min (default weight if unset).
  const rocketOn = !!logiResolved && !!logistics.data?.prefs.showRockets;
  const itemNames = useMemo(() => {
    const s = new Set<string>();
    const addItem = (name: string, kind: string) => kind === "item" && s.add(name);
    for (const row of res?.rows ?? []) {
      for (const c of row.ingredients) addItem(c.name, c.kind);
      for (const c of row.products) addItem(c.name, c.kind);
    }
    for (const f of [...(res?.imports ?? []), ...(res?.exports ?? [])]) addItem(f.name, f.kind);
    for (const g of goalNames) if (kindOf(g) === "item") s.add(g);
    return [...s].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, goalNames.join(",")]);
  const weightsQ = useQuery({
    queryKey: ["itemWeights", itemNames],
    queryFn: () => itemWeightsFn({ data: itemNames }),
    enabled: rocketOn && itemNames.length > 0,
    staleTime: 60_000,
  });
  const launchInfo = (name: string, rate: number) => {
    if (!rocketOn || !logistics.data) return null;
    const raw = weightsQ.data?.[name];
    const weight = raw ?? logistics.data.defaultItemWeight;
    return {
      perMin: launchesForRate(rate, weight, logistics.data.rocketLiftWeight),
      defaulted: raw == null,
    };
  };

  const producible = new Set(res?.producible ?? []); // imports a recipe could make in-block
  const fuelSet = new Set(res?.fuelItems ?? []); // items consumed as fuel (folded into the balance)
  const linkOf = (name: string): Link =>
    name === target
      ? "target"
      : importSet.has(name)
        ? "import"
        : exportSet.has(name)
          ? "export"
          : "linked";
  const makeFor = (name: string) => setPickFor({ name, mode: "produce" });
  const useFor = (name: string) => setPickFor({ name, mode: "consume" });

  const GRID = "grid items-center gap-4 px-3 py-3.5";
  const COLS = {
    gridTemplateColumns: "minmax(170px,1.1fr) minmax(240px,1.2fr) 1.4fr 1.4fr",
  } as const;

  return (
    <div className="p-4 font-mono text-base text-foreground">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={blockName}
          onChange={(e) => {
            markEdited();
            const v = e.target.value;
            setBlockName(v);
            // typing a name pins it; clearing it resumes auto-naming from the goal
            customDecided.current = true;
            setNameCustom(v.trim().length > 0);
          }}
          placeholder="auto-named from goal…"
          className="w-56 font-semibold"
        />
        <span className="w-14 text-xs text-muted-foreground">
          {saveState === "saving" ? "saving…" : saveState === "saved" ? "saved ✓" : ""}
        </span>
        <button
          onClick={copySetup}
          title="Copy setup — copy this block's recipe/module setup to the clipboard"
          className="flex size-7 items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Copy className="size-4" />
        </button>
        <button
          onClick={() => showInGame.mutate()}
          disabled={showInGame.isPending}
          title="Open in game — show this block as an in-game build sheet; click a building there for a configured blueprint (needs the bridge)"
          className="flex size-7 items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
        >
          <Gamepad2 className={`size-4 ${showInGame.isPending ? "animate-pulse" : ""}`} />
        </button>
        {showInGame.data && !showInGame.data.sent && (
          <span className="text-xs text-amber-300">game not connected</span>
        )}
        {showInGame.data?.sent && (
          <span className="text-xs text-emerald-300">opened in game ✓</span>
        )}
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Legend cls={linkStyle.target} label="goal" />
          <Legend cls={linkStyle.linked} label="linked" />
          <Legend cls={linkStyle.import} label="raw in" />
          <Legend cls={craftableStyle} label="craftable" />
          <Legend cls={linkStyle.export} label="export" />
          <span
            className="text-muted-foreground/70"
            title="right-click any item for actions (make a goal, lock as sizing input, force import/export/balance, locate in game). Alt-click quick-cycles the disposition."
          >
            · right-click = menu
          </span>
        </span>
        <HelpButton title="What is a block?">
          <p>
            A block is <span className="text-foreground">one production unit you design</span>: pick
            the recipes to make a goal good, and the solver works out how many of each building you
            need (fractional counts and all).
          </p>
          <p>
            <span className="text-foreground">How it solves.</span> You pin a goal output and its
            rate. Every good in the block is then one of:{" "}
            <span className="text-foreground">balanced</span> (made and used inside the block),{" "}
            <span className="text-foreground">imported</span> (brought in from outside or another
            block), or <span className="text-foreground">exported</span> (surplus that leaves). The
            solver sets each recipe&apos;s run-rate to satisfy that — it&apos;s a linear system, and
            it handles Py&apos;s cyclic recipe chains.
          </p>
          <p>
            <span className="text-foreground">You drive it, not an optimizer.</span> You choose the
            recipes and how to split a good between competing ones; PyOps just solves the system you
            describe. <span className="text-foreground">Right-click</span> any item to make it a
            goal, lock it as a sizing input, or force import / export / balance — the colored legend
            shows each item&apos;s current disposition.
          </p>
          <div>
            <div className="font-semibold text-foreground">Toolbar (top-right)</div>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                the <span className="text-foreground">copy</span> icon copies this block&apos;s
                recipe/module setup to the clipboard;
              </li>
              <li>
                the <span className="text-foreground">game</span> icon shows this block as an
                in-game build sheet — click a building there for a configured blueprint.
              </li>
            </ul>
          </div>
          <p>
            Per-machine <span className="text-foreground">modules / beacons</span> are tuned in the
            block body to cut building count. The Cybersyn request-combinator generator now lives in
            the in-game mod panel.
          </p>
        </HelpButton>
      </div>

      {/* Broken-block banner: a referenced recipe/good no longer exists in the
          current data, so the block is NOT solved (showing wrong numbers would be
          worse). The block + its last-good cache are preserved untouched. */}
      {res?.broken && (
        <div className="mb-4 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <div className="font-semibold text-destructive">
            ⚠ This block references prototypes that no longer exist in the current data — it
            won&apos;t be solved.
          </div>
          <p className="mt-1 text-muted-foreground">
            The block is preserved exactly as saved (its last solved numbers are kept). Re-enable
            the mod or re-import the data dump to restore it — pure renames are applied
            automatically on import.
          </p>
          {res.missing.recipes.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">missing recipe:</span>
              {res.missing.recipes.map((n) => (
                <code key={n} className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">
                  {n}
                </code>
              ))}
            </div>
          )}
          {res.missing.goods.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">missing good:</span>
              {res.missing.goods.map((n) => (
                <code key={n} className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">
                  {n}
                </code>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Goal + block summary */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Goal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Goals as compact stacked cells (icon over amount) so many fit — e.g. a
                flora block with lots of co-products. Click a goal's icon to add a recipe
                that makes it (like the Imports chips). The primary goal carries the rate
                (the sizing anchor, read-only when an input is locked); co-products are
                unpinned and show their solved rate. */}
            <div className="flex flex-wrap gap-2">
              {(target ? [target, ...extraGoals] : []).map((g) => {
                const isPrimary = g === target;
                const out = isPrimary ? null : res?.extraOutputs?.find((f) => f.name === g);
                const kind = kindOf(g);
                const goalMissing = res?.missing?.goods.includes(g) ?? false;
                return (
                  <div
                    key={g}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setGoalMenu({ x: e.clientX, y: e.clientY, name: g });
                    }}
                    className={`group relative flex min-w-16 flex-col items-center gap-0.5 rounded px-2 py-1 ${
                      goalMissing
                        ? "bg-destructive/10 ring-1 ring-destructive/40"
                        : isPrimary
                          ? "bg-blue-500/10 ring-1 ring-blue-400/30"
                          : "bg-emerald-500/5"
                    }`}
                    title={
                      goalMissing
                        ? `${g} — no longer exists in the current data`
                        : `${res?.display?.[g] ?? g}${isPrimary ? " — primary goal (sizing)" : " — co-product goal"} · right-click for options`
                    }
                  >
                    {/* remove (co-products) / make-primary (on hover) */}
                    {!isPrimary && (
                      <div className="absolute -top-1 right-0 flex gap-0.5 opacity-0 group-hover:opacity-100">
                        <button
                          onClick={() => makePrimary(g)}
                          title="make this the primary (sizing) goal"
                          className="rounded bg-background px-0.5 text-[10px] text-blue-300 hover:text-blue-200"
                        >
                          ★
                        </button>
                        <button
                          onClick={() => removeGoal(g)}
                          title="remove this goal"
                          className="rounded bg-background px-0.5 text-[10px] text-muted-foreground hover:text-destructive"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => (isPrimary && rate < 0 ? useFor(g) : makeFor(g))}
                      title="click to add a recipe that makes this goal (right-click to change the item)"
                    >
                      <Icon kind={kind} name={g} size="lg" title={res?.display?.[g] ?? g} />
                    </button>
                    {goalMissing ? (
                      <span className="text-xs font-semibold text-destructive">⚠ gone</span>
                    ) : isPrimary ? (
                      <span className="text-sm">
                        <EditableRate
                          value={rate}
                          readOnly={!!lockedInput}
                          onChange={(v) => {
                            markEdited();
                            setRate(v);
                          }}
                        />
                      </span>
                    ) : (
                      <span className="text-sm text-emerald-200 tabular-nums">
                        {out ? (
                          <>
                            {fmtRate(out.rate)}
                            <span className="text-muted-foreground">/s</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                    )}
                    {logiResolved && kind === "item" && !goalMissing && (
                      <LogiTag
                        resolved={logiResolved}
                        rate={Math.abs(isPrimary ? rate : (out?.rate ?? 0))}
                        machineCount={0}
                        showBelts={showBelts}
                        showInserters={showInserters}
                        launch={launchInfo(g, Math.abs(isPrimary ? rate : (out?.rate ?? 0)))}
                      />
                    )}
                  </div>
                );
              })}
              {/* add a goal */}
              <button
                onClick={() => {
                  setSearch("");
                  setGoalPicker({});
                }}
                title="add a goal product"
                className="flex min-w-16 flex-col items-center justify-center gap-0.5 rounded border border-dashed border-border px-2 py-1 text-muted-foreground hover:text-foreground"
              >
                <span className="text-2xl leading-none">+</span>
                <span className="text-xs">goal</span>
              </button>
            </div>
            {!target && (
              <div className="text-sm text-muted-foreground">
                Pick a goal product to size this block.
              </div>
            )}
            {lockedInput && (
              <div className="text-xs text-sky-300">
                🔒 sized by input — edit the locked rate in Imports, or unlock it there
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="justify-between">
            <CardTitle>Block balance</CardTitle>
            {res && (
              <span className={statusColor}>
                {res.status}
                {res.message ? ` — ${res.message}` : ""}
              </span>
            )}
          </CardHeader>
          {/* Active disposition overrides — ALWAYS shown when any exist, even if the
              solve is infeasible and the item's chip is hidden, so a forced override
              (e.g. an input cycled to export) can never soft-lock the block. */}
          {hasDisp && (
            <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded border border-sky-400/30 bg-sky-500/10 px-2 py-1.5 text-xs">
              <span className="text-sky-300">forced overrides:</span>
              {Object.entries(disp).map(([name, d]) => (
                <button
                  key={name}
                  onClick={() => setDispFor(name, "auto")}
                  title="click to clear this override (back to auto)"
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${dispTag[d].cls} hover:brightness-110`}
                >
                  <Icon kind="item" name={name} size="sm" title={res?.display?.[name] ?? name} />
                  {res?.display?.[name] ?? name} {dispTag[d].label} ✕
                </button>
              ))}
              <button
                onClick={() => {
                  markEdited();
                  setDisp({});
                }}
                title="clear all forced overrides"
                className="text-muted-foreground underline hover:text-foreground"
              >
                clear all
              </button>
            </div>
          )}
          {res?.status === "infeasible" ? (
            <div className="m-3 rounded border border-destructive/30 bg-destructive/10 p-3 text-xs">
              <div className="mb-2 font-semibold text-destructive">
                Chain runs backward — a loop has no raw feed. Recipes in red below would run in
                reverse.
              </div>
              {res.stuckItems?.length ? (
                <>
                  <div className="mb-1 text-muted-foreground">
                    Starved loop items — click one to add a recipe that feeds it:
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-2">
                    {res.stuckItems.map((n) => (
                      <ItemChip
                        key={n}
                        name={n}
                        kind="item"
                        display={res.display?.[n]}
                        link="import"
                        craftable={producible.has(n)}
                        onClick={() => makeFor(n)}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">
                  Mark a cycling item as <span className="font-semibold">import</span>, or add a
                  recipe that supplies the loop.
                </div>
              )}
            </div>
          ) : (
            <>
              {res && res.tempWarnings?.length > 0 && (
                <div className="border-b border-border px-3 py-2 text-xs text-amber-300">
                  {res.tempWarnings.map((w) => (
                    <div
                      key={`${w.recipe}-${w.item}`}
                      title="the solver links fluids by name — check your heat chain"
                    >
                      ⚠ {res.display?.[w.recipe] ?? w.recipe} needs{" "}
                      {res.display?.[w.item] ?? w.item} at {w.needs}, but this block makes it at{" "}
                      {w.got.join("°, ")}°
                    </div>
                  ))}
                </div>
              )}
              {res &&
                (res.power.totalW > 0 || res.power.heatW > 0 || res.power.fuel.length > 0) && (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border px-3 py-2 text-sm">
                    {res.power.totalW > 0 && (
                      <span className="text-sky-300">
                        ⚡ {fmtW(res.power.totalW)}{" "}
                        <span className="text-muted-foreground">electric</span>
                      </span>
                    )}
                    {res.power.heatW > 0 && (
                      <span
                        className="text-orange-300"
                        title="Heat-powered buildings (Py hard mode). Heat doesn't travel far (~15 tiles), so a heat source — e.g. a py-heat-exchanger — must be built LOCAL to this block."
                      >
                        ♨ {fmtW(res.power.heatW)}{" "}
                        <span className="text-muted-foreground">heat · local source needed</span>
                      </span>
                    )}
                    {res.power.fuel.length > 0 && (
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-muted-foreground">🔥 burning</span>
                        {res.power.fuel.map((f) => (
                          <span
                            key={f.name}
                            className="flex items-center gap-1 text-amber-300"
                            title={`${f.display ?? f.name} burned across all machines (total before byproducts — see imports for the net)`}
                          >
                            <Icon
                              kind={f.kind as "item" | "fluid"}
                              name={f.name}
                              size="sm"
                              noTitle
                            />
                            {num(f.perSec)}/s{" "}
                            <span className="text-muted-foreground">{f.display ?? f.name}</span>
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                )}
              <div className="grid grid-cols-2 gap-4 p-3">
                <div>
                  <div className="mb-1 text-xs font-semibold text-amber-400">
                    Imports — bring these in{" "}
                    <span className="font-normal text-muted-foreground">
                      (dashed ＋ = craftable in-block)
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-2">
                    {res?.imports.length ? (
                      res.imports.map((f) => (
                        <span key={f.name} className="group flex flex-col items-start gap-1.5">
                          <span className="inline-flex items-center gap-1.5">
                            <ItemChip
                              name={f.name}
                              kind={f.kind}
                              display={res.display?.[f.name]}
                              rate={f.rate}
                              link="import"
                              craftable={producible.has(f.name)}
                              disp={disp[f.name]}
                              onClick={() => makeFor(f.name)}
                              onCycleDisp={() => cycleDispFor(f.name)}
                              onClearDisp={() => setDispFor(f.name, "auto")}
                              onContext={(e) =>
                                setCtxMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  name: f.name,
                                  kind: f.kind,
                                  link: "import",
                                })
                              }
                            />
                            {/* lock this input to drive the block's size (Goal goes read-only) */}
                            {lockedInput === f.name ? (
                              <input
                                type="number"
                                value={lockedRate}
                                step="0.01"
                                min="0"
                                autoFocus
                                onChange={(e) => setLockedRate(Number(e.target.value) || 0)}
                                title="locked rate — the block is sized to consume this much of this input"
                                className="w-16 rounded border border-sky-400/60 bg-muted px-1 py-0.5 text-sm"
                              />
                            ) : null}
                            <button
                              onClick={() => {
                                if (lockedInput === f.name) setLockedInput(null);
                                else {
                                  setLockedInput(f.name);
                                  setLockedRate(+f.rate.toFixed(4));
                                }
                              }}
                              title={
                                lockedInput === f.name
                                  ? "unlock — the Goal rate is editable again"
                                  : "lock this input: size the whole block by its rate (Goal becomes read-only)"
                              }
                              className={`rounded px-0.5 text-sm ${
                                lockedInput === f.name
                                  ? "text-sky-300"
                                  : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                              }`}
                            >
                              {lockedInput === f.name ? "🔒" : "🔓"}
                            </button>
                            {fuelSet.has(f.name) && (
                              <span title="this import is (partly) burned as fuel">🔥</span>
                            )}
                            {freed.has(f.name) && !disp[f.name] && (
                              <button
                                title="recycle loop won't self-close — auto-sourced here. Click to pin it as an import (resolves the relaxed solve)."
                                onClick={() => setDispFor(f.name, "import")}
                                className="rounded bg-amber-500/25 px-1.5 py-0.5 text-sm text-amber-200 hover:brightness-110"
                              >
                                loop · pin import
                              </button>
                            )}
                          </span>
                          {logiResolved && f.kind === "item" && (
                            <LogiTag
                              resolved={logiResolved}
                              rate={f.rate}
                              machineCount={0}
                              showBelts={showBelts}
                              showInserters={showInserters}
                              launch={launchInfo(f.name, f.rate)}
                            />
                          )}
                        </span>
                      ))
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-violet-400">
                    Exports — surplus, nothing consumes these
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-2">
                    {res?.exports.length ? (
                      res.exports.map((f) => (
                        <span key={f.name} className="flex flex-col items-start gap-1.5">
                          <span className="inline-flex items-center gap-1.5">
                            <ItemChip
                              name={f.name}
                              kind={f.kind}
                              display={res.display?.[f.name]}
                              rate={f.rate}
                              link="export"
                              disp={disp[f.name]}
                              onClick={() => useFor(f.name)}
                              onCycleDisp={() => cycleDispFor(f.name)}
                              onClearDisp={() => setDispFor(f.name, "auto")}
                              onContext={(e) =>
                                setCtxMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  name: f.name,
                                  kind: f.kind,
                                  link: "export",
                                })
                              }
                            />
                            {fuelSet.has(f.name) && (
                              <span title="surplus after burning some as fuel">🔥</span>
                            )}
                            {freed.has(f.name) && !disp[f.name] && (
                              <button
                                title="recycle loop won't self-close — auto-sunk here. Click to pin it as an export (resolves the relaxed solve)."
                                onClick={() => setDispFor(f.name, "export")}
                                className="rounded bg-amber-500/25 px-1.5 py-0.5 text-sm text-amber-200 hover:brightness-110"
                              >
                                loop · pin export
                              </button>
                            )}
                          </span>
                          {logiResolved && f.kind === "item" && (
                            <LogiTag
                              resolved={logiResolved}
                              rate={f.rate}
                              machineCount={0}
                              showBelts={showBelts}
                              showInserters={showInserters}
                              launch={launchInfo(f.name, f.rate)}
                            />
                          )}
                        </span>
                      ))
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      <BlockTasks blockId={blockId} />

      {/* Recipe grid: each row's I/O at the solved rate. Click any item to add a
          recipe that makes it (ingredient) or consumes it (product). */}
      <Card>
        <div className={`${head} ${GRID}`} style={COLS}>
          <span>Recipe ({recipes.length})</span>
          <span>Machines</span>
          <span>Ingredients ↓ (click to add a producer)</span>
          <span>Products ↑ (click to add a consumer)</span>
        </div>
        {recipes.length === 0 && (
          <div className="px-3 py-2 text-muted-foreground">
            none — pick a recipe for the goal above
          </div>
        )}
        {recipes.map((name) => {
          const row = res?.rows?.find((r) => r.recipe === name);
          const neg = (row?.rate ?? 0) < -1e-6; // running backward — can't physically happen
          // a recipe that no longer exists in the data: show it as a labelled
          // placeholder row (preserved, not silently dropped) rather than solving.
          const missingRecipe = res?.missing?.recipes.includes(name) ?? false;
          if (missingRecipe) {
            return (
              <div
                key={name}
                className={`${GRID} border-t border-border bg-destructive/10`}
                style={COLS}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Icon kind="recipe" name={name} size="md" noTitle />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono" title={name}>
                      {name}
                    </span>
                    <span className="text-xs font-semibold text-destructive">
                      ⚠ no longer exists
                    </span>
                  </span>
                  <button
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => drop(name)}
                    title="remove this missing recipe from the block"
                  >
                    ✕
                  </button>
                </div>
                <div className="col-span-3 text-sm text-muted-foreground">
                  this recipe isn&apos;t in the current data — re-enable its mod or re-import to
                  restore it, or remove it
                </div>
              </div>
            );
          }
          return (
            <div
              key={name}
              className={`${GRID} border-t border-border ${neg ? "bg-destructive/10" : ""}`}
              style={COLS}
            >
              <RecipeHover name={name} className="flex min-w-0 items-center gap-2">
                <Icon kind="recipe" name={name} size="md" noTitle />
                <span className="min-w-0 flex-1">
                  <span className="block truncate" title={res?.display?.[name] ?? name}>
                    {res?.display?.[name] ?? name}
                  </span>
                  {row && (
                    <span
                      className={`text-xs ${neg ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                    >
                      {neg && "⚠ backward "}
                      {num(row.rate)}/s
                    </span>
                  )}
                </span>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => drop(name)}
                  title="remove"
                >
                  ✕
                </button>
              </RecipeHover>
              <div className="flex flex-wrap items-center gap-2">
                {row?.machine ? (
                  <>
                    {/* building: icon + count; hover = name/speed, click = picker */}
                    <button
                      onClick={() => setPickMachineFor(name)}
                      title={`${row.machine.display ?? row.machine.name} · ${num(row.machine.craftingSpeed ?? 1)}× speed · click to change building`}
                      className={cellChip}
                    >
                      <Icon kind="item" name={row.machine.name} size="md" noTitle />
                      <span className="font-semibold text-foreground">
                        {num(row.machine.count)}
                      </span>
                    </button>
                    {/* electricity, when the machine draws power */}
                    {row.machine.energySource === "electric" && (
                      <span
                        title="electric power draw"
                        className="flex items-center gap-1 rounded bg-muted/50 px-1.5 py-1 text-sm text-sky-300"
                      >
                        ⚡ {fmtW(row.machine.powerW)}
                      </span>
                    )}
                    {row.machine.energySource === "heat" && (
                      <span
                        title="heat-powered — fed by an upstream reactor"
                        className="flex items-center gap-1 rounded bg-muted/50 px-1.5 py-1 text-sm"
                      >
                        ♨ heat
                      </span>
                    )}
                    {/* fuel: icon + rate; click = fuel picker */}
                    {row.fuel && (
                      <button
                        onClick={() => setPickFuelFor(name)}
                        title={`${row.fuel.display ?? row.fuel.name} · ${num(row.fuel.perSec)}/s · click to change fuel`}
                        className={`${cellChip} text-amber-300`}
                      >
                        <Icon
                          kind={row.fuel.kind as "item" | "fluid"}
                          name={row.fuel.name}
                          size="md"
                          noTitle
                        />
                        <span className="font-semibold">{num(row.fuel.perSec)}</span>
                      </button>
                    )}
                    {/* burnt result (ash, depleted cell): produced 1:1 from burning */}
                    {row.fuel?.burnt && (
                      <span
                        title={`${row.fuel.burnt.display ?? row.fuel.burnt.name} — produced by burning`}
                        className="flex items-center gap-1 rounded bg-muted/50 px-1.5 py-1 text-sm text-muted-foreground"
                      >
                        →<Icon kind="item" name={row.fuel.burnt.name} size="md" noTitle />
                        <span>{num(row.fuel.burnt.perSec)}</span>
                      </span>
                    )}
                    {/* modules + beacons: configured loadout (or ghost ⊞), click to edit */}
                    <ModulesChip
                      modules={row.modules}
                      beacons={row.beacons}
                      slots={row.machine.moduleSlots ?? 0}
                      effects={row.effects}
                      auto={row.autoModules}
                      onClick={() => setPickModulesFor(name)}
                    />
                    {/* TURD: hidden modules the selected upgrades insert (no slot cost) */}
                    {row.turdModules.length > 0 && (
                      <Link
                        to="/turd"
                        title={`TURD: ${row.turdModules.map((m) => m.display ?? m.name).join(", ")} — applied by your selected upgrades`}
                        className="flex items-center gap-1 rounded bg-fuchsia-500/15 px-1.5 py-1 text-sm text-fuchsia-300 ring-1 ring-fuchsia-400/40 hover:brightness-110"
                      >
                        ⚗
                        {row.turdModules.map((m) => (
                          <Icon key={m.name} kind="item" name={m.name} size="sm" noTitle />
                        ))}
                      </Link>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-3">
                {row?.ingredients.map((c) => (
                  <div key={c.name} className="flex flex-col items-start gap-1.5">
                    <ItemChip
                      name={c.name}
                      kind={c.kind}
                      display={c.display}
                      rate={c.rate}
                      link={linkOf(c.name)}
                      craftable={producible.has(c.name)}
                      disp={disp[c.name]}
                      onClick={() => makeFor(c.name)}
                      onCycleDisp={() => cycleDispFor(c.name)}
                      onClearDisp={() => setDispFor(c.name, "auto")}
                    />
                    {logiResolved && c.kind === "item" && (
                      <LogiTag
                        resolved={logiResolved}
                        rate={c.rate}
                        machineCount={row.machine?.count ?? 0}
                        showBelts={showBelts}
                        showInserters={showInserters}
                        launch={launchInfo(c.name, c.rate)}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-3">
                {row?.products.map((c) => (
                  <div key={c.name} className="flex flex-col items-start gap-1.5">
                    <ItemChip
                      name={c.name}
                      kind={c.kind}
                      display={c.display}
                      rate={c.rate}
                      link={linkOf(c.name)}
                      disp={disp[c.name]}
                      onClick={() => useFor(c.name)}
                      onCycleDisp={() => cycleDispFor(c.name)}
                      onClearDisp={() => setDispFor(c.name, "auto")}
                    />
                    {logiResolved && c.kind === "item" && (
                      <LogiTag
                        resolved={logiResolved}
                        rate={c.rate}
                        machineCount={row.machine?.count ?? 0}
                        showBelts={showBelts}
                        showInserters={showInserters}
                        launch={launchInfo(c.name, c.rate)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </Card>

      {/* Goal-item picker — choose what product a goal is (add a new one, or change
          an existing goal's item). Searches items AND fluids. */}
      {goalPicker && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/55 p-10"
          onClick={() => {
            setGoalPicker(null);
            setSearch("");
          }}
        >
          <Card className="w-[34rem] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="justify-between">
              <CardTitle className="normal-case">
                {goalPicker.replace
                  ? `Change goal — ${res?.display?.[goalPicker.replace] ?? goalPicker.replace}`
                  : "Add a goal product"}
              </CardTitle>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setGoalPicker(null);
                  setSearch("");
                }}
              >
                ✕
              </button>
            </CardHeader>
            <div className="space-y-2 p-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                placeholder="search an item or fluid…"
                className="w-full rounded border border-input bg-muted px-2 py-1.5 text-sm placeholder:text-muted-foreground"
              />
              <div className="max-h-[55vh] overflow-auto rounded border border-border">
                {items.isLoading && <div className="px-3 py-2 text-muted-foreground">…</div>}
                {!search.trim() ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    type to search for a product…
                  </div>
                ) : items.data?.length ? (
                  items.data.map((it) => (
                    <button
                      key={`${it.kind}:${it.name}`}
                      className={rowBtn}
                      onClick={() => pickGoalItem(it.name)}
                      title={it.display ?? it.name}
                    >
                      <Icon kind={it.kind as "item" | "fluid"} name={it.name} size="md" noTitle />
                      <span className="truncate">{it.display ?? it.name}</span>
                    </button>
                  ))
                ) : (
                  !items.isLoading && (
                    <div className="px-3 py-2 text-muted-foreground">no matches</div>
                  )
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Goal context menu — right-click a goal cell: change item, make primary, remove */}
      {goalMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setGoalMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setGoalMenu(null);
            }}
          />
          <div
            className="fixed z-50 min-w-48 overflow-hidden rounded-md border border-border bg-background py-1 shadow-xl"
            style={{ left: goalMenu.x, top: goalMenu.y }}
          >
            <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
              <Icon
                kind={kindOf(goalMenu.name)}
                name={goalMenu.name}
                size="sm"
                title={res?.display?.[goalMenu.name] ?? goalMenu.name}
              />
              <span className="truncate">{res?.display?.[goalMenu.name] ?? goalMenu.name}</span>
            </div>
            <CtxBtn
              onClick={() => {
                setSearch("");
                setGoalPicker({ replace: goalMenu.name });
                setGoalMenu(null);
              }}
            >
              ✎ Change item
            </CtxBtn>
            {goalMenu.name !== target && (
              <CtxBtn
                onClick={() => {
                  makePrimary(goalMenu.name);
                  setGoalMenu(null);
                }}
              >
                ★ Make primary (sizing) goal
              </CtxBtn>
            )}
            <div className="my-1 border-t border-border" />
            <CtxBtn
              onClick={() => {
                removeGoal(goalMenu.name);
                setGoalMenu(null);
              }}
            >
              ✕ Remove goal
            </CtxBtn>
          </div>
        </>
      )}

      {/* Recipe picker — floats over everything, dismissable */}
      {pickFor && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/55 p-10"
          onClick={() => setPickFor(null)}
        >
          <Card className="w-[42rem] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="justify-between">
              <CardTitle className="normal-case">
                {pickFor.mode === "consume" ? "Recipes that consume" : "Recipes that make"}{" "}
                {res?.display?.[pickFor.name] ?? pickFor.name}
              </CardTitle>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setPickFor(null)}
              >
                ✕
              </button>
            </CardHeader>
            <div className="max-h-[60vh] overflow-auto p-2">
              {picker.isLoading && <div className="px-2 py-1 text-muted-foreground">…</div>}
              {picker.data?.length
                ? picker.data.map((r) => {
                    const added = recipes.includes(r.name);
                    return (
                      <button
                        key={r.name}
                        className={`flex w-full items-start gap-3 rounded px-3 py-2.5 text-left hover:bg-muted ${
                          r.enabled || r.turd?.turdSelected ? "" : "opacity-70"
                        }`}
                        onClick={() => add(r.name)}
                        disabled={added}
                      >
                        <Icon kind="recipe" name={r.name} size="lg" noTitle />
                        <span className="min-w-0 flex-1 space-y-1">
                          {/* full name — wraps instead of truncating */}
                          <span className="flex items-baseline gap-3">
                            <span className="text-base">{r.display ?? r.name}</span>
                            <span className="ml-auto flex shrink-0 items-center gap-2">
                              {r.cost != null && (
                                <span
                                  className="text-sm text-muted-foreground"
                                  title="estimated cost per craft (cost analysis) — sorted cheapest first"
                                >
                                  ¥{fmtCost(r.cost)}
                                </span>
                              )}
                              {added && (
                                <span className="text-sm text-muted-foreground">added</span>
                              )}
                            </span>
                          </span>
                          {/* io at a glance — hover any icon for the item card */}
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            {r.ingredients.map((c, i) => (
                              <ItemHover
                                key={`i${i}`}
                                name={c.name}
                                kind={c.kind as "item" | "fluid"}
                                className="flex items-center gap-1"
                              >
                                <Icon
                                  kind={c.kind as "item" | "fluid"}
                                  name={c.name}
                                  size="sm"
                                  noTitle
                                />
                                <span className="text-sm text-muted-foreground">
                                  {fmtAmt(c.amount)}
                                </span>
                              </ItemHover>
                            ))}
                            <span className="text-muted-foreground">→</span>
                            {r.products.map((c, i) => (
                              <ItemHover
                                key={`p${i}`}
                                name={c.name}
                                kind={c.kind as "item" | "fluid"}
                                className="flex items-center gap-1"
                              >
                                <Icon
                                  kind={c.kind as "item" | "fluid"}
                                  name={c.name}
                                  size="sm"
                                  noTitle
                                />
                                <span className="text-sm text-muted-foreground">
                                  {fmtAmt(c.amount)}
                                </span>
                              </ItemHover>
                            ))}
                          </span>
                          {/* availability: TURD choice / not-yet-researched tech (red) /
                              nothing unlocks it (dark gray) */}
                          {r.superseded ? (
                            <span
                              className="flex flex-wrap items-center gap-1.5 text-sm text-zinc-500"
                              title={`your ${r.superseded.masterDisplay ?? "TURD"} choice "${r.superseded.subDisplay}" replaced this recipe with "${r.superseded.newDisplay}" — the base version no longer exists in-game`}
                            >
                              <Icon
                                kind="technology"
                                name={r.superseded.subTech}
                                size="sm"
                                noTitle
                              />
                              ⚗ replaced by {r.superseded.newDisplay}
                              <span className="text-zinc-600">
                                ({r.superseded.masterDisplay ?? "TURD"} › {r.superseded.subDisplay})
                              </span>
                            </span>
                          ) : (
                            !r.enabled &&
                            (r.turd ? (
                              <span
                                className={`flex flex-wrap items-center gap-1.5 text-sm ${r.turd.turdSelected ? "text-emerald-300" : "text-fuchsia-300"}`}
                                title={
                                  r.turd.turdSelected
                                    ? "granted by your selected TURD choice"
                                    : `requires the "${r.turd.display}" choice under "${r.turd.masterDisplay ?? "TURD"}" — pick it on the TURD page (or in-game TURD explorer)`
                                }
                              >
                                <Icon kind="technology" name={r.turd.tech} size="sm" noTitle />⚗{" "}
                                {r.turd.masterDisplay ? `${r.turd.masterDisplay} › ` : ""}
                                {r.turd.display}
                                {r.turd.turdSelected && " ✓"}
                              </span>
                            ) : r.unlocks.length ? (
                              <TechLine
                                unlock={r.unlocks[0]}
                                more={r.unlocks.length - 1}
                                researched={r.avail.research === "available"}
                              />
                            ) : (
                              <span
                                className="text-sm text-zinc-500"
                                title="no technology unlocks this recipe"
                              >
                                🔒 locked
                              </span>
                            ))
                          )}
                        </span>
                      </button>
                    );
                  })
                : !picker.isLoading && (
                    <div className="px-2 py-1 text-muted-foreground">
                      {pickFor.mode === "consume"
                        ? "nothing consumes this in the data"
                        : "no recipes make this — it's a raw input"}
                    </div>
                  )}
            </div>
          </Card>
        </div>
      )}

      {/* Building picker — choose which machine runs a recipe (speed / power / tier) */}
      {pickMachineFor && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/55 p-10"
          onClick={() => setPickMachineFor(null)}
        >
          <Card className="w-[36rem] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="justify-between">
              <CardTitle className="normal-case">
                Building for {res?.display?.[pickMachineFor] ?? pickMachineFor}
              </CardTitle>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setPickMachineFor(null)}
              >
                ✕
              </button>
            </CardHeader>
            <div className="max-h-[60vh] overflow-auto p-2">
              {machineOpts.isLoading && <div className="px-2 py-1 text-muted-foreground">…</div>}
              {machineOpts.data
                ?.slice()
                .sort((a, b) => (a.craftingSpeed ?? 0) - (b.craftingSpeed ?? 0))
                .map((m) => {
                  const cur =
                    res?.rows?.find((r) => r.recipe === pickMachineFor)?.machine?.name === m.name;
                  return (
                    <button
                      key={m.name}
                      className={`${rowBtn} w-full items-start ${cur ? "bg-accent" : ""} ${m.availableNow ? "" : "opacity-55"}`}
                      onClick={() => {
                        pickMachine(pickMachineFor, m.name);
                        setPickMachineFor(null);
                      }}
                    >
                      <Icon kind="item" name={m.name} size="md" noTitle />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-foreground">{m.display ?? m.name}</span>
                          <Badge variant="secondary">{m.craftingSpeed}× speed</Badge>
                          {m.energySource === "electric" && (
                            <span className="text-xs text-sky-300">
                              ⚡ {fmtW(m.energyUsageW ?? 0)}
                            </span>
                          )}
                          {(m.energySource === "burner" || m.energySource === "fluid") && (
                            <span className="text-xs text-amber-300">
                              🔥 {fmtW(m.energyUsageW ?? 0)}
                            </span>
                          )}
                          {m.energySource === "heat" && <span className="text-xs">♨ heat</span>}
                          {m.moduleSlots > 0 && (
                            <span className="text-xs text-muted-foreground">{m.moduleSlots}⊞</span>
                          )}
                          {cur && <span className="text-xs text-primary">· current</span>}
                        </span>
                        <span className="block truncate text-xs">
                          {m.availableNow ? (
                            <span className="text-emerald-300/80">
                              {m.startEnabled
                                ? "✓ available from start"
                                : `✓ unlocked${
                                    m.unlockedBy.length
                                      ? ` · ${m.unlockedBy.map((u) => u.display ?? u.tech).join(", ")}`
                                      : ""
                                  }`}
                            </span>
                          ) : (
                            <span className="text-amber-300/90">
                              🔒 needs{" "}
                              {m.unlockedBy.length
                                ? m.unlockedBy.map((u) => u.display ?? u.tech).join(", ")
                                : "research"}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  );
                })}
            </div>
          </Card>
        </div>
      )}

      {/* Modules & beacons — per-recipe loadout, applied through the solver */}
      {pickModulesFor &&
        (() => {
          const mr = res?.rows?.find((r) => r.recipe === pickModulesFor);
          if (!mr?.machine) return null;
          return (
            <ModulesModal
              recipe={pickModulesFor}
              recipeDisplay={res?.display?.[pickModulesFor] ?? pickModulesFor}
              machineName={mr.machine.name}
              modules={moduleSel[pickModulesFor] ?? (mr.autoModules ? mr.modules : [])}
              beacons={beaconSel[pickModulesFor] ?? []}
              effects={mr.effects}
              auto={mr.autoModules && moduleSel[pickModulesFor] === undefined}
              onChange={(mods, bcns) => {
                markEdited();
                setModuleSel((s) => ({ ...s, [pickModulesFor]: mods }));
                setBeaconSel((s) => ({ ...s, [pickModulesFor]: bcns }));
              }}
              onReset={() => {
                markEdited();
                setModuleSel((s) => {
                  const n = { ...s };
                  delete n[pickModulesFor];
                  return n;
                });
              }}
              onClose={() => setPickModulesFor(null)}
            />
          );
        })()}

      {/* Fuel picker — choose what a burner burns (energy value shown to compare) */}
      {pickFuelFor &&
        (() => {
          const fr = res?.rows?.find((r) => r.recipe === pickFuelFor);
          return (
            <div
              className="fixed inset-0 z-40 flex items-start justify-center bg-black/55 p-10"
              onClick={() => setPickFuelFor(null)}
            >
              <Card className="w-[30rem] shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <CardHeader className="justify-between">
                  <CardTitle className="normal-case">
                    Fuel for {res?.display?.[pickFuelFor] ?? pickFuelFor}
                  </CardTitle>
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setPickFuelFor(null)}
                  >
                    ✕
                  </button>
                </CardHeader>
                <div className="max-h-[60vh] overflow-auto p-2">
                  {fr?.availableFuels.map((f) => {
                    const cur = fr.fuel?.chosen === f.name;
                    return (
                      <button
                        key={f.name}
                        className={`${rowBtn} w-full ${cur ? "bg-accent" : ""}`}
                        onClick={() => {
                          pickFuel(pickFuelFor, f.name);
                          setPickFuelFor(null);
                        }}
                      >
                        <Icon kind={f.kind as "item" | "fluid"} name={f.name} size="md" noTitle />
                        <span className="truncate text-foreground">{f.display ?? f.name}</span>
                        {f.fuelValueJ != null && (
                          <Badge variant="secondary" className="ml-auto">
                            {fmtJ(f.fuelValueJ)}
                            {f.kind === "fluid" ? "/unit" : ""}
                          </Badge>
                        )}
                        {cur && <span className="text-xs text-primary">current</span>}
                      </button>
                    );
                  })}
                  {!fr?.availableFuels.length && (
                    <div className="px-2 py-1 text-muted-foreground">
                      no fuels for this machine's categories
                    </div>
                  )}
                </div>
              </Card>
            </div>
          );
        })()}

      {/* right-click context menu for a good — explicit actions (safer than cycling) */}
      {ctxMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu(null);
            }}
          />
          <div
            className="fixed z-50 min-w-52 overflow-hidden rounded-md border border-border bg-background py-1 shadow-xl"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
              <Icon
                kind={ctxMenu.kind as "item" | "fluid"}
                name={ctxMenu.name}
                size="sm"
                title={res?.display?.[ctxMenu.name] ?? ctxMenu.name}
              />
              <span className="truncate">{res?.display?.[ctxMenu.name] ?? ctxMenu.name}</span>
            </div>
            {ctxMenu.link === "export" && (
              <CtxBtn
                onClick={() => {
                  addGoal(ctxMenu.name);
                  setCtxMenu(null);
                }}
              >
                ★ Make a goal
              </CtxBtn>
            )}
            {ctxMenu.link === "import" && (
              <>
                <CtxBtn
                  active={lockedInput === ctxMenu.name}
                  onClick={() => {
                    if (lockedInput === ctxMenu.name) setLockedInput(null);
                    else {
                      const imp = res?.imports.find((f) => f.name === ctxMenu.name);
                      setLockedInput(ctxMenu.name);
                      setLockedRate(imp ? +imp.rate.toFixed(4) : 0);
                    }
                    setCtxMenu(null);
                  }}
                >
                  {lockedInput === ctxMenu.name
                    ? "🔓 Unlock sizing"
                    : "🔒 Size block by this input"}
                </CtxBtn>
                <CtxBtn
                  onClick={() => {
                    const imp = res?.imports.find((f) => f.name === ctxMenu.name);
                    void createSupplier(ctxMenu.name, imp?.rate ?? 0);
                    setCtxMenu(null);
                  }}
                >
                  ＋ Create block to make this
                </CtxBtn>
              </>
            )}
            {/* Jump to other blocks that already produce this good (skip self). */}
            {(() => {
              const producers = (ctxProducers.data?.producers ?? []).filter(
                (p) => p.blockId !== blockId,
              );
              if (!producers.length) return null;
              return (
                <>
                  <div className="my-1 border-t border-border" />
                  <div className="px-3 pb-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    produced in
                  </div>
                  {producers.map((p) => (
                    <CtxBtn
                      key={p.blockId}
                      className="gap-1.5"
                      onClick={() => {
                        void navigate({
                          to: "/block/$id",
                          params: { id: String(p.blockId) },
                        });
                        setCtxMenu(null);
                      }}
                    >
                      {p.iconKind && p.iconName ? (
                        <Icon
                          kind={p.iconKind as "item" | "fluid" | "recipe"}
                          name={p.iconName}
                          size="sm"
                        />
                      ) : null}
                      <span className="truncate">{p.blockName}</span>
                      <span className="ml-auto text-muted-foreground">
                        {p.role === "byproduct" ? "byproduct " : ""}
                        {num(p.rate)}/s
                      </span>
                    </CtxBtn>
                  ))}
                </>
              );
            })()}
            <div className="my-1 border-t border-border" />
            <div className="px-3 pb-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              disposition
            </div>
            {(["auto", "import", "export", "balance"] as const).map((d) => {
              const active = (disp[ctxMenu.name] ?? "auto") === d;
              const labels = {
                auto: "Auto (solver decides)",
                import: "Force import",
                export: "Force export",
                balance: "Force balance",
              };
              return (
                <CtxBtn
                  key={d}
                  active={active}
                  onClick={() => {
                    setDispFor(ctxMenu.name, d);
                    setCtxMenu(null);
                  }}
                >
                  {active ? "● " : "   "}
                  {labels[d]}
                </CtxBtn>
              );
            })}
            <div className="my-1 border-t border-border" />
            <CtxBtn
              onClick={() => {
                locate.mutate({ name: ctxMenu.name, kind: ctxMenu.kind as "item" | "fluid" });
                setCtxMenu(null);
              }}
            >
              🔍 Locate in game
            </CtxBtn>
          </div>
        </>
      )}
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${cls}`} />
      {label}
    </span>
  );
}
