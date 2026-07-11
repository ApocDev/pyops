import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { Check, Copy, Star } from "lucide-react";
import {
  aiConfigFn,
  dataPathsFn,
  dataStatusFn,
  exclusionsFn,
  modDriftFn,
  plannerSettingsFn,
  setAiConfigFn,
  setExclusionsFn,
  setPlannerSettingsFn,
} from "../server/factorio";
import { BridgeCard } from "../components/bridge-card";
import { HelpButton } from "../components/help-drawer";
import { InfoHint } from "../components/info-hint";
import { HorizonHelpButton } from "../components/horizon-help";
import { BlockShareCard } from "../components/block-share-card.tsx";
import { ProjectBackupCard } from "../components/project-backup-card.tsx";
import { HorizonPicker } from "../components/horizon-picker";
import { CompanionModCard } from "../components/companion-mod-card";
import { DriftChanges } from "../components/drift-changes";
import { driftModal } from "../lib/drift-store";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Input } from "#/components/ui/input.tsx";
import { FieldLabel, Label } from "#/components/ui/label.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { Tooltip } from "#/components/ui/tooltip.tsx";
import { FilterEmptyState } from "#/components/filter-empty-state.tsx";
import { FilterInput } from "#/components/filter-input.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { useFilteredList } from "../lib/use-filtered-list";
import {
  formatQty,
  getCompactNumbers,
  setCompactNumbers,
  subscribeNumberFormat,
} from "../lib/format";
import { getTheme, setTheme, subscribeTheme, type ThemePref } from "../lib/theme";
import {
  getAdvancedSupplyPriorities,
  setAdvancedSupplyPriorities,
  subscribeAdvancedSupplyPriorities,
} from "../lib/supply-priority";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";

const TABS = [
  { id: "planning", label: "Planning" },
  { id: "data", label: "Game data" },
  { id: "link", label: "In-game link" },
  { id: "backup", label: "Backup & share" },
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
    <div className="flex h-full flex-col font-mono text-sm text-foreground md:flex-row">
      <aside className="w-full shrink-0 border-b border-border p-2 md:w-40 md:border-r md:border-b-0">
        <nav className="flex gap-1 overflow-x-auto md:block md:space-y-0.5 md:overflow-visible">
          {TABS.map((t) => (
            <Button
              key={t.id}
              variant="ghost"
              onClick={() => select(t.id)}
              aria-pressed={tab === t.id}
              className={`shrink-0 justify-start md:w-full ${
                tab === t.id ? "bg-muted font-semibold text-foreground" : "text-muted-foreground"
              }`}
            >
              {t.label}
            </Button>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 overflow-auto p-4">
        <PageHeader title="Settings" />
        {tab === "planning" && (
          <div className={cols}>
            <PlannerCard />
            <DisplayCard />
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
        {tab === "backup" && (
          <div className={cols}>
            <ProjectBackupCard />
            <BlockShareCard />
          </div>
        )}
      </div>
    </div>
  );
}

/** Game-data sync: the state lives here (reference-data summary, drift, mods); the
 * sync action + its guided progress run in the global DriftModal (opened here, on
 * drift detection, or from the nav), so the dump isn't buried in a log at the
 * bottom of the page. */
function GameDataTab() {
  const status = useQuery({ queryKey: ["dataStatus"], queryFn: () => dataStatusFn() });
  const drift = useQuery({ queryKey: ["modDrift"], queryFn: () => modDriftFn() });

  return (
    <div className="columns-1 gap-4 xl:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
      <Card>
        <CardHeader className="justify-between">
          <CardTitle>Reference data</CardTitle>
          {drift.data?.needsRedump && (
            <Tooltip content="the game's enabled mods or their versions changed since the last sync">
              <Badge variant="destructive">stale — mods changed</Badge>
            </Tooltip>
          )}
        </CardHeader>
        <div className="space-y-2 px-3 pb-3">
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
          <Button onClick={() => driftModal.open()} className="mt-1">
            {drift.data?.needsRedump ? "Review & re-sync…" : "Sync game data…"}
          </Button>
          <p className="text-sm text-muted-foreground">
            Runs <span className="text-foreground">factorio --dump-data</span> with the pyops-dump
            helper, imports into sqlite, applies mod renames, and records the mod list — guided
            step-by-step in the dialog.
          </p>
        </div>
      </Card>

      <ModDriftCard data={drift.data} />

      <ModsCard mods={status.data?.mods ?? []} />

      <StorageCard />
    </div>
  );
}

/** Where the app stores its data on disk. Per-OS for a packaged build, the working
 * dir in dev — shown here so it's findable when sharing a db or filing a bug. */
function StorageCard() {
  const paths = useQuery({ queryKey: ["dataPaths"], queryFn: () => dataPathsFn() });
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value);
    setCopied(value);
    setTimeout(() => setCopied((c) => (c === value ? null : c)), 1200);
  };

  const rows: { label: string; value: string }[] = paths.data
    ? [
        { label: "Data folder", value: paths.data.dataDir },
        { label: "Projects (databases)", value: paths.data.projectsDir },
        { label: "Icon atlas", value: paths.data.iconDataDir },
        { label: "App config", value: paths.data.appConfig },
      ]
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage location</CardTitle>
        <InfoHint content="Useful when sharing a database or filing a bug report." />
      </CardHeader>
      <div className="space-y-2 px-3 pb-3">
        {paths.isPending ? (
          <div className="space-y-1.5">
            {["Data folder", "Projects (databases)", "Icon atlas", "App config"].map((label) => (
              <Skeleton key={label} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.label}>
                <FieldLabel>{r.label}</FieldLabel>
                <div className="flex items-center gap-1.5">
                  <code
                    className="min-w-0 flex-1 truncate bg-muted px-1.5 py-0.5 text-sm"
                    title={r.value}
                  >
                    {r.value}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => copy(r.value)}
                    className="shrink-0 text-muted-foreground"
                    title="Copy path"
                    aria-label={`Copy ${r.label} path`}
                  >
                    {copied === r.value ? (
                      <Check className="size-3.5 text-success" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Mod drift: the game's CURRENT mod set vs the baseline this project's data was
 * dumped from (#28), by name and version. Spells out exactly what changed and
 * whether a re-dump is due, so the re-sync below isn't a black box. */
function ModDriftCard({ data }: { data: Awaited<ReturnType<typeof modDriftFn>> | undefined }) {
  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Mod drift</CardTitle>
        </CardHeader>
        <div className="space-y-2 px-3 pb-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </Card>
    );
  }
  if (!data.haveBaseline) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Mod drift</CardTitle>
        </CardHeader>
        <div className="px-3 pb-3 text-sm text-muted-foreground">
          No mod baseline recorded yet — run a sync below so PyOps can tell when the game&apos;s
          mods drift from your reference data.
        </div>
      </Card>
    );
  }
  const d = data.drift;
  if (!data.needsRedump) {
    return (
      <Card>
        <CardHeader className="justify-between">
          <CardTitle>Mod drift</CardTitle>
          <Badge className="border-transparent bg-success/15 text-success">
            <Check className="size-3.5" /> matches the game
          </Badge>
        </CardHeader>
        <div className="px-3 pb-3 text-sm text-muted-foreground">
          The enabled mods and their versions match what your data was dumped from.
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="justify-between">
        <CardTitle>Mod drift</CardTitle>
        <Badge variant="destructive">re-dump needed</Badge>
      </CardHeader>
      <div className="space-y-2 px-3 pb-3 text-sm">
        <p className="text-muted-foreground">
          The game&apos;s mods changed since your last sync, so the reference data no longer
          matches. Re-sync to update it.
        </p>
        <div className="max-h-56 overflow-y-auto border border-border bg-muted/20 p-2">
          <DriftChanges drift={d} />
        </div>
      </div>
    </Card>
  );
}

/** Provenance: the mods (name + version + enabled) this project's reference data
 * was dumped from, so you can see exactly what your saved plans were built against.
 * Recorded on each sync (`readMods` → meta.mod_list). Filterable — Py is huge. */
function ModsCard({
  mods,
}: {
  mods: { name: string; enabled: boolean; version: string | null }[];
}) {
  const [filter, setFilter] = useState("");
  // a mod's id IS its user-facing name here (no localized display exists)
  const shown = useFilteredList(mods, filter, { display: (m) => m.name });
  if (mods.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Mods</CardTitle>
        </CardHeader>
        <div className="px-3 pb-3 text-sm text-muted-foreground">
          No mod list recorded yet — run a sync to capture the mods (and versions) your reference
          data was built from.
        </div>
      </Card>
    );
  }
  const enabled = mods.filter((m) => m.enabled).length;
  return (
    <Card>
      <CardHeader className="justify-between">
        <CardTitle>
          Mods{" "}
          <span className="font-normal text-muted-foreground">
            ({enabled} on / {mods.length})
          </span>
        </CardTitle>
      </CardHeader>
      <div className="space-y-2 px-3 pb-3">
        <p className="text-sm text-muted-foreground">
          What this project&apos;s reference data was dumped from — its provenance. Recorded on each
          sync.
        </p>
        <FilterInput value={filter} onValueChange={setFilter} placeholder="filter mods…" />
        <div className="max-h-80 overflow-auto border border-border">
          {shown.map((m) => (
            <div
              key={m.name}
              className={`flex items-center gap-2 border-b border-border/50 px-2 py-1 text-sm last:border-0 ${
                m.enabled ? "" : "opacity-50"
              }`}
            >
              <span className="min-w-0 flex-1 truncate" title={m.name}>
                {m.name}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {m.version ?? "—"}
              </span>
              {!m.enabled && <Badge className="shrink-0 px-1 py-0 text-xs">off</Badge>}
            </div>
          ))}
          {shown.length === 0 && (
            <FilterEmptyState className="p-4" query={filter} onClear={() => setFilter("")} />
          )}
        </div>
      </div>
    </Card>
  );
}

/** Display preferences (#74): how numbers render. Per-browser (localStorage),
 * not project data — it changes nothing about the plan, only how it reads. */
function DisplayCard() {
  const compact = useSyncExternalStore(subscribeNumberFormat, getCompactNumbers, () => true);
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => "dark" as ThemePref);
  const advancedPriorities = useSyncExternalStore(
    subscribeAdvancedSupplyPriorities,
    getAdvancedSupplyPriorities,
    () => false,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Display</CardTitle>
      </CardHeader>
      <div className="space-y-3 px-3 pb-3">
        <label className="flex items-center justify-between gap-3">
          <span>
            Theme
            <span className="block text-sm text-muted-foreground">
              light, dark, or follow your system setting
            </span>
          </span>
          <Select value={theme} onValueChange={(v) => setTheme(v as ThemePref)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>
            Compact large numbers
            <span className="block text-sm text-muted-foreground">
              {compact ? (
                <>
                  showing {formatQty(200_000)} — toggle off for {(200_000).toLocaleString("en-US")}
                </>
              ) : (
                <>showing {(200_000).toLocaleString("en-US")} — toggle on for 200K</>
              )}
            </span>
          </span>
          <Switch checked={compact} onCheckedChange={(v) => setCompactNumbers(v)} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>
            Advanced supply priorities
            <span className="block text-sm text-muted-foreground">
              enter numeric tiers instead of Preferred, Normal, and Fallback
            </span>
          </span>
          <Switch checked={advancedPriorities} onCheckedChange={setAdvancedSupplyPriorities} />
        </label>
      </div>
    </Card>
  );
}

/** Module auto-fill settings: the solve suggests a fill per row (productivity
 * where allowed, else the fewest speed modules that reach the smallest whole
 * building count, rest efficiency) — applied only by explicit click, never
 * automatically. This card controls the ambient hints. */
function PlannerCard() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["plannerSettings"], queryFn: () => plannerSettingsFn() });
  const save = useMutation({
    mutationFn: (d: { autofill: boolean; fillMiners: boolean; spoilImportCutoffSec?: number }) =>
      setPlannerSettingsFn({ data: d }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["plannerSettings"] });
      void qc.invalidateQueries({ queryKey: ["solve"] });
      void qc.invalidateQueries({ queryKey: ["blocks"] });
    },
  });
  const s = settings.data;
  if (!s) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Module auto-fill</CardTitle>
        </CardHeader>
        <div className="space-y-2 px-3 pb-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-8 w-full" />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="justify-between">
        <CardTitle>Module auto-fill</CardTitle>
        <HelpButton title="Module auto-fill">
          <p>
            Every solve computes a suggested module fill per recipe row —{" "}
            <b className="text-foreground">productivity</b> where the recipe allows it, otherwise
            just enough <b className="text-foreground">speed</b> modules to reach the smallest whole
            building count, with the rest on efficiency. Speed beacons count toward that target.
          </p>
          <p>
            Suggestions are never applied on their own: rows whose current setup differs show a ✨
            hint you can click, and the block header offers a whole-block apply.
          </p>
        </HelpButton>
      </CardHeader>
      <div className="space-y-3 px-3 pb-3">
        <p className="text-sm text-muted-foreground">
          Suggestions are computed per solve; the ✨ hint applies them.
        </p>
        <Label>
          <Checkbox
            checked={s.autofill}
            onCheckedChange={(checked) =>
              save.mutate({ autofill: checked === true, fillMiners: s.fillMiners })
            }
          />
          show suggestion hints on recipe rows
        </Label>
        <Label>
          <Checkbox
            checked={s.fillMiners}
            onCheckedChange={(checked) =>
              save.mutate({ autofill: s.autofill, fillMiners: checked === true })
            }
          />
          also suggest for mining drills
        </Label>
        {save.isError && (
          <p className="text-sm text-destructive">save failed: {save.error.message}</p>
        )}

        <div className="border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5">
              spoilage import cutoff
              <InfoHint content="When the planner drafts, goods spoiling faster than this must be produced locally; slower ones may be imported between blocks." />
            </span>
            <Input
              type="number"
              value={s.spoilImportCutoffSec}
              min={0}
              step={30}
              onChange={(e) =>
                save.mutate({
                  autofill: s.autofill,
                  fillMiners: s.fillMiners,
                  spoilImportCutoffSec: Number(e.target.value) || 0,
                })
              }
              className="w-28"
            />
            <span className="text-muted-foreground">s</span>
          </div>
        </div>

        <div className="border-t border-border pt-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Preferred defaults (favorites)</span>
            <HelpButton title="Preferred defaults">
              <p>
                New recipes default to the <b className="text-foreground">lowest-tier building</b>{" "}
                and <b className="text-foreground">cheapest fuel</b> — correct and buildable from
                the start.
              </p>
              <p>
                To prefer something else, open a recipe's building or fuel picker in the block
                editor and click its <Star className="inline size-3.5" /> star: the next new recipe
                in that category uses your pick (once it's researched). Existing blocks keep their
                choices.
              </p>
            </HelpButton>
          </div>
          <p className="text-sm text-muted-foreground">
            Star a building or fuel in a recipe picker to make it the default for new recipes.
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
  if (!d) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Assistant (AI)</CardTitle>
        </CardHeader>
        <div className="space-y-2 px-3 pb-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-8 w-72" />
        </div>
      </Card>
    );
  }
  const modelValue = modelDirty ? model : d.model;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assistant (AI)</CardTitle>
      </CardHeader>
      <div className="space-y-3 px-3 pb-3 text-sm">
        <p className="flex items-center gap-1.5 text-muted-foreground">
          Shared across all projects.
          <InfoHint content="The OPENROUTER_API_KEY / PYOPS_AGENT_MODEL env vars take priority when set; these stored values are the fallback." />
        </p>

        <div>
          <FieldLabel>OpenRouter API key</FieldLabel>
          {d.keyFromEnv ? (
            <div className="mt-1 flex items-center gap-1 text-sm text-success">
              <Check className="size-3.5" /> set via OPENROUTER_API_KEY env (wins)
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  save.mutate({ openrouterApiKey: key });
                  setKey("");
                }}
                disabled={!key.trim()}
              >
                Save
              </Button>
              {d.keyStored && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => save.mutate({ openrouterApiKey: "" })}
                  className="text-muted-foreground hover:text-destructive"
                >
                  clear
                </Button>
              )}
            </div>
          )}
        </div>

        <div>
          <FieldLabel>model</FieldLabel>
          {d.modelFromEnv ? (
            <div className="mt-1 flex items-center gap-1 text-sm text-success">
              <Check className="size-3.5" /> set via PYOPS_AGENT_MODEL env (wins): {d.resolvedModel}
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  save.mutate({ model: modelValue });
                  setModelDirty(false);
                }}
              >
                Save
              </Button>
              <span className="text-sm text-muted-foreground">
                in use: {d.resolvedModel}
                {!d.model && " (default)"}
              </span>
            </div>
          )}
        </div>
        {save.isError && (
          <p className="text-sm text-destructive">save failed: {save.error.message}</p>
        )}
      </div>
    </Card>
  );
}

/** Planning-horizon card — the shared picker (also reachable from the header). */
function HorizonCard() {
  return (
    <Card>
      <CardHeader className="justify-between">
        <CardTitle>Planning horizon</CardTitle>
        <HorizonHelpButton />
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
        <InfoHint
          content={`Patterns (* and ? wildcards) match a good's name/subgroup or a recipe's name/category. Subgroups are mod-namespaced, so py-alienlife-* hides a whole mod family. Always-on: ${DEFAULT_EXCLUDE_NOTE}.`}
        />
      </CardHeader>
      <div className="space-y-3 px-3 pb-3">
        <p className="text-sm text-muted-foreground">
          Glob patterns hidden from the planner and recipe picker.
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
          <Button variant="outline" onClick={add} disabled={!draft.trim()}>
            Add
          </Button>
        </div>
        {globs.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {globs.map((g) => (
              <Badge key={g} className="gap-1 font-mono text-foreground">
                {g}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => remove(g)}
                  className="size-4 text-muted-foreground hover:text-destructive"
                  title="remove"
                >
                  ×
                </Button>
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No custom exclusions.</p>
        )}
        {save.isError && (
          <p className="text-sm text-destructive">save failed: {save.error.message}</p>
        )}
      </div>
    </Card>
  );
}
