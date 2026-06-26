import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  aiConfigFn,
  dataStatusFn,
  exclusionsFn,
  fuelListFn,
  plannerSettingsFn,
  recomputeCostsFn,
  setAiConfigFn,
  setExclusionsFn,
  setPlannerSettingsFn,
  startDataSyncFn,
  syncStateFn,
} from "../server/factorio";
import { BridgeCard } from "../components/bridge-card";
import { HorizonPicker } from "../components/horizon-picker";
import { CompanionModCard } from "../components/companion-mod-card";
import { Badge } from "#/components/ui/badge.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";

const TABS = [
  { id: "planning", label: "Planning" },
  { id: "data", label: "Game data" },
  { id: "link", label: "In-game link" },
] as const;
type TabId = (typeof TABS)[number]["id"];
const isTabId = (v: unknown): v is TabId => TABS.some((t) => t.id === v);

export const Route = createFileRoute("/settings")({
  validateSearch: (s: Record<string, unknown>): { tab?: TabId } =>
    isTabId(s.tab) ? { tab: s.tab } : {},
  component: SettingsPage,
});

/** Settings, organized as vertical tabs. Day-to-day planning settings lead;
 * one-time setup (game-data sync, companion mod / bridge) sits behind its own
 * tabs. The active tab lives in the URL so it's linkable and survives reloads. */
function SettingsPage() {
  const { tab = "planning" } = Route.useSearch();
  const navigate = useNavigate();
  const select = (id: TabId) =>
    void navigate({ to: "/settings", search: id === "planning" ? {} : { tab: id } });
  const cols = "columns-1 gap-4 xl:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid";

  return (
    <div className="flex h-full font-mono text-sm text-foreground">
      <aside className="w-40 shrink-0 border-r border-border p-2">
        <h1 className="mb-2 px-2 py-1 text-base font-bold">Settings</h1>
        <nav className="space-y-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => select(t.id)}
              className={`block w-full rounded px-2 py-1.5 text-left ${
                tab === t.id
                  ? "bg-muted font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 overflow-auto p-4">
        {tab === "planning" && (
          <div className={cols}>
            <PlannerCard />
            <AssistantCard />
            <HorizonCard />
            <ExclusionsCard />
          </div>
        )}
        {tab === "data" && <GameDataTab />}
        {tab === "link" && (
          <div className={cols}>
            <CompanionModCard />
            <BridgeCard />
          </div>
        )}
      </div>
    </div>
  );
}

const RUNNING = new Set([
  "helper-mod",
  "dump-data",
  "dump-locale",
  "dump-icons",
  "import",
  "atlas",
  "costs",
]);

/** Game-data sync: dump → import → atlas, all server-side. */
function GameDataTab() {
  const qc = useQueryClient();
  const [icons, setIcons] = useState(false);

  const status = useQuery({ queryKey: ["dataStatus"], queryFn: () => dataStatusFn() });
  const sync = useQuery({
    queryKey: ["syncState"],
    queryFn: () => syncStateFn(),
    refetchInterval: (q) => (RUNNING.has(q.state.data?.phase ?? "") ? 1500 : false),
  });
  const start = useMutation({
    mutationFn: () => startDataSyncFn({ data: { icons } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["syncState"] }),
  });

  const s = sync.data;
  const running = RUNNING.has(s?.phase ?? "");
  // when a run finishes, refresh the status card (and everything data-derived)
  const phase = s?.phase;
  useEffect(() => {
    if (phase === "done") void qc.invalidateQueries();
  }, [phase, qc]);

  return (
    <div className="columns-1 gap-4 xl:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
      <Card>
        <CardHeader className="justify-between">
          <CardTitle>Reference data</CardTitle>
          {status.data?.stale && (
            <Badge variant="destructive" title="the enabled mod set changed since the last sync">
              stale — mod list changed
            </Badge>
          )}
        </CardHeader>
        <div className="space-y-1 px-3 pb-3">
          {status.data && (
            <>
              <div>
                {status.data.stats.recipes.toLocaleString()} recipes ·{" "}
                {status.data.stats.items.toLocaleString()} items · {status.data.stats.fluids} fluids
                · {status.data.stats.craftingMachines} machines
              </div>
              <div className="text-xs text-muted-foreground">
                imported from {status.data.meta.imported_from ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                synced {status.data.meta.synced_at ?? "manually (no sync recorded)"} · fingerprint{" "}
                {status.data.meta.data_fingerprint ?? "—"}
                {status.data.currentFingerprint &&
                  ` · current mod list ${status.data.currentFingerprint}`}
              </div>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sync</CardTitle>
        </CardHeader>
        <div className="space-y-3 px-3 pb-3">
          <p className="text-xs text-muted-foreground">
            Runs{" "}
            <span className="text-foreground">factorio --dump-data / --dump-prototype-locale</span>{" "}
            with the pyops-dump helper enabled (TURD integration), imports into sqlite, and stamps
            the mod-list fingerprint. The helper is always disabled again afterwards.
          </p>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={icons} onChange={(e) => setIcons(e.target.checked)} />
            also re-dump icon sprites + rebuild the atlas
            <span className="text-muted-foreground">
              (loads the FULL game — Steam may ask for launch confirmation)
            </span>
          </label>
          <button
            onClick={() => start.mutate()}
            disabled={running}
            className="rounded bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
          >
            {running ? "syncing…" : "Sync game data"}
          </button>
        </div>
      </Card>

      {s != null && s.phase !== "idle" && (
        <Card>
          <CardHeader className="justify-between">
            <CardTitle>Last run</CardTitle>
            <span
              className={
                s.phase === "done"
                  ? "text-emerald-400"
                  : s.phase === "error"
                    ? "text-destructive"
                    : "text-amber-300"
              }
            >
              {s.phase}
            </span>
          </CardHeader>
          <div className="px-3 pb-3">
            <pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap text-muted-foreground">
              {s.log.join("\n")}
            </pre>
            {s.error && <div className="mt-2 text-xs text-destructive">{s.error}</div>}
          </div>
        </Card>
      )}
    </div>
  );
}

const PAYBACK_PRESETS = [
  { label: "off", value: 0 },
  { label: "10 min", value: 600 },
  { label: "1 h", value: 3600 },
  { label: "4 h", value: 14400 },
  { label: "12 h", value: 43200 },
];

/** Module auto-fill settings (YAFC's "fill modules with payback time"): rows
 * without a manual module config get the most economical module, judged by
 * the cost analysis. Short payback favors speed, long favors productivity. */
function PlannerCard() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["plannerSettings"], queryFn: () => plannerSettingsFn() });
  const fuels = useQuery({ queryKey: ["fuelList"], queryFn: () => fuelListFn() });
  const save = useMutation({
    mutationFn: (d: {
      autofillPayback: number;
      fillMiners: boolean;
      spoilImportCutoffSec?: number;
      machineTier?: "lowest" | "highest";
      defaultFuel?: string;
    }) => setPlannerSettingsFn({ data: d }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["plannerSettings"] });
      void qc.invalidateQueries({ queryKey: ["solve"] });
      void qc.invalidateQueries({ queryKey: ["blocks"] });
    },
  });
  const recompute = useMutation({
    mutationFn: () => recomputeCostsFn(),
    onSuccess: () => void qc.invalidateQueries(),
  });
  const s = settings.data;
  if (!s) return null;

  return (
    <Card>
      <CardHeader className="justify-between">
        <CardTitle>Module auto-fill</CardTitle>
        {!s.costsComputed && (
          <button
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
            className="text-sm text-sky-400 underline"
          >
            {recompute.isPending ? "computing cost analysis…" : "compute cost analysis first"}
          </button>
        )}
      </CardHeader>
      <div className="space-y-3 px-3 pb-3">
        <p className="text-sm text-muted-foreground">
          Rows without manual modules get the most economical one (by cost analysis), filled in
          every slot. The payback window is how long a module has to earn its own cost — short
          favors speed, long favors productivity. Manual configs always win.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span>payback</span>
          <Input
            type="number"
            value={s.autofillPayback}
            min={0}
            step={60}
            onChange={(e) =>
              save.mutate({
                autofillPayback: Number(e.target.value) || 0,
                fillMiners: s.fillMiners,
              })
            }
            className="w-28"
          />
          <span className="text-muted-foreground">s</span>
          {PAYBACK_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => save.mutate({ autofillPayback: p.value, fillMiners: s.fillMiners })}
              className={`rounded border px-2 py-0.5 text-sm ${
                s.autofillPayback === p.value
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={s.fillMiners}
            onChange={(e) =>
              save.mutate({ autofillPayback: s.autofillPayback, fillMiners: e.target.checked })
            }
          />
          also fill mining drills
        </label>

        <div className="border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span>spoilage import cutoff</span>
            <Input
              type="number"
              value={s.spoilImportCutoffSec}
              min={0}
              step={30}
              onChange={(e) =>
                save.mutate({
                  autofillPayback: s.autofillPayback,
                  fillMiners: s.fillMiners,
                  spoilImportCutoffSec: Number(e.target.value) || 0,
                })
              }
              className="w-28"
            />
            <span className="text-muted-foreground">s</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            When the planner drafts, a good that spoils faster than this is forced to be built
            locally (can't survive transport between blocks). Slower spoilers may be imported.
          </p>
        </div>

        <div className="border-t border-border pt-3">
          <div className="mb-2 text-sm font-semibold">Planning defaults</div>
          {/* default building tier */}
          <div className="flex flex-wrap items-center gap-2">
            <span>default building</span>
            {(["lowest", "highest"] as const).map((t) => (
              <button
                key={t}
                onClick={() =>
                  save.mutate({
                    autofillPayback: s.autofillPayback,
                    fillMiners: s.fillMiners,
                    machineTier: t,
                  })
                }
                className={`rounded border px-2 py-0.5 text-sm ${
                  s.machineTier === t
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {t === "lowest" ? "lowest tier" : "highest tier"}
              </button>
            ))}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Which building to pick when you haven't chosen one per recipe.{" "}
            <span className="font-semibold">Lowest tier</span> suits an early playthrough (what you
            can build now); <span className="font-semibold">highest tier</span> is the fastest
            endgame machine. (Per-recipe overrides in the block editor always win.)
          </p>

          {/* default fuel */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span>default fuel</span>
            <select
              value={s.defaultFuel}
              onChange={(e) =>
                save.mutate({
                  autofillPayback: s.autofillPayback,
                  fillMiners: s.fillMiners,
                  defaultFuel: e.target.value,
                })
              }
              className="h-8 rounded border border-border bg-background px-2 text-sm outline-none focus:border-primary"
            >
              <option value="">auto (cheapest available)</option>
              {(fuels.data ?? []).map((f) => (
                <option key={f.name} value={f.name}>
                  {f.display ?? f.name}
                  {f.mj != null ? ` — ${f.mj} MJ` : ""}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Preferred fuel for burner machines, used whenever the machine can actually burn it (else
            falls back to the cheapest valid fuel).
          </p>
        </div>
      </div>
    </Card>
  );
}

/** Assistant / AI config: the OpenRouter key + model. App-level (your AI account,
 * not a project). Env vars win; the stored values are the fallback default. */
function AssistantCard() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["aiConfig"], queryFn: () => aiConfigFn() });
  const save = useMutation({
    mutationFn: (d: { openrouterApiKey?: string | null; model?: string | null }) =>
      setAiConfigFn({ data: d }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["aiConfig"] }),
  });
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [modelDirty, setModelDirty] = useState(false);
  const d = cfg.data;
  if (!d) return null;
  const modelValue = modelDirty ? model : d.model;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assistant (AI)</CardTitle>
      </CardHeader>
      <div className="space-y-3 px-3 pb-3 text-sm">
        <p className="text-muted-foreground">
          Your OpenRouter account, shared across all projects. The{" "}
          <code className="text-xs">OPENROUTER_API_KEY</code> /{" "}
          <code className="text-xs">PYOPS_AGENT_MODEL</code> env vars take priority when set; these
          stored values are the fallback.
        </p>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            OpenRouter API key
          </div>
          {d.keyFromEnv ? (
            <div className="mt-1 text-xs text-emerald-300">
              ✓ set via OPENROUTER_API_KEY env (wins)
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-2">
              <Input
                type="password"
                value={key}
                placeholder={d.keyStored ? "•••••••• (stored — type to replace)" : "sk-or-…"}
                onChange={(e) => setKey(e.target.value)}
                className="w-72"
              />
              <button
                onClick={() => {
                  save.mutate({ openrouterApiKey: key });
                  setKey("");
                }}
                disabled={!key.trim()}
                className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
              >
                Save
              </button>
              {d.keyStored && (
                <button
                  onClick={() => save.mutate({ openrouterApiKey: "" })}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  clear
                </button>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">model</div>
          {d.modelFromEnv ? (
            <div className="mt-1 text-xs text-emerald-300">
              ✓ set via PYOPS_AGENT_MODEL env (wins): {d.resolvedModel}
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-2">
              <Input
                value={modelValue}
                placeholder={d.defaultModel}
                onChange={(e) => {
                  setModel(e.target.value);
                  setModelDirty(true);
                }}
                className="w-72"
              />
              <button
                onClick={() => {
                  save.mutate({ model: modelValue });
                  setModelDirty(false);
                }}
                className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
              >
                Save
              </button>
              <span className="text-xs text-muted-foreground">
                in use: {d.resolvedModel}
                {!d.model && " (default)"}
              </span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Planning-horizon card — the shared picker (also reachable from the header). */
function HorizonCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Planning horizon</CardTitle>
      </CardHeader>
      <div className="px-3 pb-3">
        <HorizonPicker />
      </div>
    </Card>
  );
}

const DEFAULT_EXCLUDE_NOTE = "ee-* (Editor Extensions, uncraftable)";

/** Manage the planner's exclusion globs — patterns hidden from search, recipe
 * candidates and fuels (matched against name / subgroup / category). */
function ExclusionsCard() {
  const qc = useQueryClient();
  const ex = useQuery({ queryKey: ["exclusions"], queryFn: () => exclusionsFn() });
  const save = useMutation({
    mutationFn: (globs: string[]) => setExclusionsFn({ data: { globs } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["exclusions"] });
      void qc.invalidateQueries({ queryKey: ["solve"] });
    },
  });
  const [draft, setDraft] = useState("");
  const globs = ex.data?.globs ?? [];

  const add = () => {
    const g = draft.trim();
    if (!g || globs.includes(g)) return;
    save.mutate([...globs, g]);
    setDraft("");
  };
  const remove = (g: string) => save.mutate(globs.filter((x) => x !== g));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Excluded from planning</CardTitle>
      </CardHeader>
      <div className="space-y-3 px-3 pb-3">
        <p className="text-sm text-muted-foreground">
          Glob patterns (<code>*</code>, <code>?</code>) hidden from the planner and recipe picker —
          matched against a good's name/subgroup or a recipe's name/category. Subgroups are
          mod-namespaced, so <code>py-alienlife-*</code> hides a whole mod family;{" "}
          <code>some-item</code> hides one thing. Always-on: <code>{DEFAULT_EXCLUDE_NOTE}</code>.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={draft}
            placeholder="e.g. py-alienlife-*  or  ee-*"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            className="w-64 font-mono"
          />
          <button
            onClick={add}
            disabled={!draft.trim()}
            className="rounded border border-border px-3 py-1 text-sm hover:bg-muted disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {globs.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {globs.map((g) => (
              <span
                key={g}
                className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 font-mono text-sm"
              >
                {g}
                <button
                  onClick={() => remove(g)}
                  className="text-muted-foreground hover:text-destructive"
                  title="remove"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No custom exclusions.</p>
        )}
      </div>
    </Card>
  );
}
