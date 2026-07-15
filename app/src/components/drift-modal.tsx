import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw, X, type LucideIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { factorioRunningFn, modDriftFn, startDataSyncFn, syncStateFn } from "../server/factorio";
import { bridgeStatusSubscription } from "../lib/live-query-options";
import { driftModal, useDriftModalOpen } from "../lib/drift-store";
import { type StepStatus, stepStatuses, stepsForRun } from "../lib/sync-steps";
import { DriftChanges } from "./drift-changes";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";
import { HelpButton } from "#/components/help-drawer.tsx";
import { InfoHint } from "#/components/info-hint.tsx";

const TWO_HOURS = 2 * 60 * 60 * 1000;
const BRIDGE_FRESH_MS = 6000;
const DISMISS_KEY = "pyops.driftDismissed";
const RUNNING = new Set([
  "helper-mod",
  "dump-data",
  "dump-locale",
  "dump-icons",
  "import",
  "atlas",
  "costs",
  "migrations",
]);

const readDismissed = (): string | null => {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
};
const writeDismissed = (sig: string) => {
  try {
    localStorage.setItem(DISMISS_KEY, sig);
  } catch {
    /* private mode — fine, it just re-prompts */
  }
};

/** The guided data-sync experience: a themed modal that pops when mod or importer
 * drift is detected (or is opened from the nav / Settings), lets you ignore or
 * re-sync, and then walks the dump as a step-by-step progress flow ending in a
 * summary. Mounted once in the root; it owns the periodic drift check and polling. */
export function DriftModal() {
  const qc = useQueryClient();
  const isOpen = useDriftModalOpen();
  const [icons, setIcons] = useState(false);
  const [initiated, setInitiated] = useState(false); // a sync was started from this session

  const drift = useQuery({
    queryKey: ["modDrift"],
    queryFn: () => modDriftFn(),
    refetchInterval: TWO_HOURS,
    refetchOnWindowFocus: true,
  });
  const sync = useQuery({
    queryKey: ["syncState"],
    queryFn: () => syncStateFn(),
    refetchInterval: (q) => (RUNNING.has(q.state.data?.phase ?? "") ? 1000 : false),
  });
  const bridge = useQuery(bridgeStatusSubscription);
  // Proactively check whether the game is running while the prompt is open, so we
  // can warn and block the sync (it would just fail on the engine's instance lock).
  const gameRunning = useQuery({
    queryKey: ["factorioRunning"],
    queryFn: () => factorioRunningFn(),
    enabled: isOpen,
    refetchInterval: 3000,
  });

  const start = useMutation({
    mutationFn: () => startDataSyncFn({ data: { icons } }),
    onSuccess: () => {
      setInitiated(true);
      void qc.invalidateQueries({ queryKey: ["syncState"] });
    },
  });

  // Bridge reconnect (Factorio likely restarted) → re-check drift.
  const peer = bridge.data?.lastPeer ?? null;
  const connected = peer != null && Date.now() - peer.lastSeenMs < BRIDGE_FRESH_MS;
  const prevConnected = useRef(connected);
  useEffect(() => {
    if (connected && !prevConnected.current) void qc.invalidateQueries({ queryKey: ["modDrift"] });
    prevConnected.current = connected;
  }, [connected, qc]);

  // Auto-open once per combined drift signature (until dismissed or resolved).
  // Include the reader versions so each future format bump prompts exactly once,
  // even when the mod set itself has not changed.
  const sig = drift.data?.needsRedump
    ? JSON.stringify({ mods: drift.data.drift, dataFormat: drift.data.dataFormat })
    : null;
  useEffect(() => {
    if (sig && readDismissed() !== sig) driftModal.open();
  }, [sig]);

  // When a sync WE started finishes, refresh everything data-derived (drift clears).
  const phase = sync.data?.phase ?? "idle";
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    if (initiated && phase === "done")
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "syncState" });
  }, [initiated, phase, qc]);

  // On each fresh open, start in the prompt unless a sync is actively running —
  // otherwise a stale `done`/`error` from a previous run would replay its summary.
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !wasOpen.current) setInitiated(RUNNING.has(phaseRef.current));
    wasOpen.current = isOpen;
  }, [isOpen]);

  if (!isOpen) return null;

  const hasDrift = !!drift.data?.needsRedump;
  const hasModDrift = !!drift.data?.modsChanged;
  const hasDataFormatDrift = !!drift.data?.dataFormat.stale;
  const gameUp = gameRunning.data?.running === true; // can't sync while the game runs
  const running = RUNNING.has(phase);
  const view: "prompt" | "running" | "done" | "error" = running
    ? "running"
    : initiated && phase === "done"
      ? "done"
      : initiated && phase === "error"
        ? "error"
        : "prompt";

  const dismiss = () => {
    if (sig) writeDismissed(sig);
    driftModal.close();
  };
  const close = () => driftModal.close();
  // In the prompt with real drift, backdrop/✕ means "ignore" (remember it);
  // otherwise (manual sync, or mid/after a run) it just closes.
  const onClose = view === "prompt" && hasDrift ? dismiss : close;

  // The prompt title/actions depend on whether we're reacting to drift or the user
  // opened it to sync proactively — "out of date" vs a plain "Sync game data".
  const title =
    view === "prompt"
      ? hasDrift
        ? { icon: AlertTriangle, tone: "text-warning", text: "Reference data is out of date" }
        : { icon: RefreshCw, tone: "text-info", text: "Sync game data" }
      : TITLES[view];
  const TitleIcon = title.icon;

  const steps = stepsForRun(icons);
  const statuses = stepStatuses(steps, phase, sync.data?.failedAt ?? null);
  const log = sync.data?.log ?? [];

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="md:max-w-[34rem]">
        <DialogHeader className="gap-2">
          <TitleIcon className={`size-5 shrink-0 ${title.tone}`} />
          <DialogTitle>{title.text}</DialogTitle>
          <HelpButton title="Data drift" className="mr-7 ml-auto">
            <p>
              PyOps plans against a snapshot of the game&apos;s prototype data (recipes, items,
              machines, techs). When the game&apos;s mod set or PyOps&apos; data reader changes,
              that snapshot drifts out of date and this dialog offers a re-sync.
            </p>
            <p>
              A re-sync launches a headless copy of Factorio to re-dump the data, then imports it.
              Pure renames are applied to your saved blocks automatically; anything that genuinely
              changed (or vanished) is flagged on the affected blocks for review.
            </p>
            <p>
              Re-dumping icon sprites rebuilds the icon atlas. It loads the full game, so it&apos;s
              much slower — only needed when a mod&apos;s visuals changed.
            </p>
          </HelpButton>
        </DialogHeader>

        <DialogBody>
          {view === "prompt" && (
            <PromptBody
              hasDrift={hasDrift}
              hasModDrift={hasModDrift}
              hasDataFormatDrift={hasDataFormatDrift}
              drift={drift.data?.drift ?? null}
              dataFormat={drift.data?.dataFormat}
              icons={icons}
              setIcons={setIcons}
              gameUp={gameUp}
            />
          )}
          {(view === "running" || view === "error") && (
            <Stepper steps={steps} statuses={statuses} />
          )}
          {view === "done" && <DoneBody log={log} />}
          {view === "error" && (
            <Callout tone="destructive">{sync.data?.error ?? "Sync failed."}</Callout>
          )}
          {(view === "running" || view === "done" || view === "error") && log.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Raw log
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-muted-foreground">
                {log.join("\n")}
              </pre>
            </details>
          )}
        </DialogBody>

        <DialogFooter>
          {view === "prompt" && (
            <>
              <Button variant="outline" onClick={hasDrift ? dismiss : close}>
                {hasDrift ? "Ignore for now" : "Cancel"}
              </Button>
              <Button
                onClick={() => start.mutate()}
                disabled={start.isPending || gameUp}
                title={gameUp ? "Close Factorio first" : undefined}
              >
                {start.isPending ? "Starting…" : hasDrift ? "Re-sync now" : "Sync now"}
              </Button>
            </>
          )}
          {view === "running" && (
            <>
              <span className="mr-auto text-sm text-muted-foreground">
                You can close this — the sync keeps running.
              </span>
              <Button variant="outline" onClick={close}>
                Hide
              </Button>
            </>
          )}
          {view === "done" && (
            <>
              <Link to="/factory" onClick={close} className="mr-auto text-sm text-info underline">
                Review affected blocks →
              </Link>
              <Button onClick={close}>Done</Button>
            </>
          )}
          {view === "error" && (
            <>
              <Button variant="outline" onClick={close}>
                Close
              </Button>
              <Button onClick={() => start.mutate()} disabled={start.isPending}>
                Retry
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type TitleSpec = { icon: LucideIcon; tone: string; text: string };
const TITLES: Record<"running" | "done" | "error", TitleSpec> = {
  running: { icon: RefreshCw, tone: "text-info", text: "Re-syncing reference data" },
  done: { icon: Check, tone: "text-success", text: "Reference data updated" },
  error: { icon: X, tone: "text-destructive", text: "Sync failed" },
};

function PromptBody({
  hasDrift,
  hasModDrift,
  hasDataFormatDrift,
  drift,
  dataFormat,
  icons,
  setIcons,
  gameUp,
}: {
  hasDrift: boolean;
  hasModDrift: boolean;
  hasDataFormatDrift: boolean;
  drift: Parameters<typeof DriftChanges>[0]["drift"];
  dataFormat?: { current: number; imported: number | null; stale: boolean };
  icons: boolean;
  setIcons: (v: boolean) => void;
  gameUp: boolean;
}) {
  return (
    <div className="space-y-3">
      {gameUp && (
        <Callout tone="warning">
          Factorio is running. Close the game first — PyOps launches its own headless copy to read
          the data, and the engine won&apos;t allow two instances at once.
        </Callout>
      )}
      <p className="text-sm text-muted-foreground">
        {hasModDrift && hasDataFormatDrift
          ? "The game's mods and PyOps' data reader changed since your last sync. Re-sync to rebuild this project's reference data."
          : hasModDrift
            ? "The game's mods changed since your last sync — re-sync to plan against the current data."
            : hasDataFormatDrift
              ? "PyOps now reads the Factorio dump differently than the version that built this project's reference data. Re-sync to rebuild it with the current reader."
              : hasDrift
                ? "This project's reference data needs to be rebuilt before planning continues."
                : "Re-dump the game's prototype data from the current mods and import it."}
      </p>
      {hasDataFormatDrift && dataFormat && (
        <div className="border border-warning/30 bg-warning/10 p-2 text-sm text-warning">
          Imported data format:{" "}
          {dataFormat.imported == null ? "unversioned" : `v${dataFormat.imported}`}
          {" · "}Current reader: v{dataFormat.current}
        </div>
      )}
      {hasModDrift && drift && (
        <div className="max-h-48 overflow-y-auto border border-border bg-muted/20 p-2">
          <DriftChanges drift={drift} />
        </div>
      )}
      <label className="flex cursor-pointer items-start gap-2.5 border border-border bg-muted/30 p-2.5 text-sm hover:bg-muted/50">
        <input
          type="checkbox"
          checked={icons}
          onChange={(e) => setIcons(e.target.checked)}
          className="mt-0.5"
        />
        <span className="flex items-center gap-1.5">
          <span className="text-foreground">Also re-dump icon sprites</span>
          <InfoHint content="Rebuilds the icon atlas — loads the full game, so it's much slower. Only needed when a mod's visuals changed." />
        </span>
      </label>
    </div>
  );
}

function StepGlyph({ status }: { status: StepStatus }) {
  if (status === "active")
    return <Loader2 className="mt-px size-5 shrink-0 animate-spin text-info" />;
  const map: Record<StepStatus, { Glyph: LucideIcon | null; cls: string }> = {
    done: { Glyph: Check, cls: "border-success/50 bg-success/15 text-success" },
    error: { Glyph: X, cls: "border-destructive/50 bg-destructive/15 text-destructive" },
    pending: { Glyph: null, cls: "border-border text-muted-foreground" },
    active: { Glyph: null, cls: "" },
  };
  const { Glyph, cls } = map[status];
  return (
    <span
      className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${cls}`}
    >
      {Glyph && <Glyph className="size-3" />}
    </span>
  );
}

function Stepper({
  steps,
  statuses,
}: {
  steps: { phase: string; label: string; detail: string }[];
  statuses: StepStatus[];
}) {
  return (
    <ol className="space-y-1">
      {steps.map((s, i) => {
        const st = statuses[i];
        const active = st === "active";
        const labelCls = active
          ? "font-semibold text-info"
          : st === "done"
            ? "text-success"
            : st === "error"
              ? "font-semibold text-destructive"
              : "text-muted-foreground";
        return (
          <li
            key={s.phase}
            className={`flex items-start gap-3 px-2 py-1.5 ${
              active ? "bg-info/10 ring-1 ring-info/30" : ""
            }`}
          >
            <StepGlyph status={st} />
            <div className="min-w-0 flex-1">
              <div className={`text-sm ${labelCls}`}>{s.label}</div>
              <div className={`text-sm ${active ? "text-info/70" : "text-muted-foreground"}`}>
                {s.detail}
              </div>
            </div>
            {active && <span className="mt-0.5 shrink-0 text-xs text-info">Running…</span>}
          </li>
        );
      })}
    </ol>
  );
}

function DoneBody({ log }: { log: string[] }) {
  // best-effort summary lines pulled from the sync log
  const summary = [
    log.find((l) => /recorded \d+ mods/.test(l)),
    log.find((l) => l.startsWith("migrations:")),
    log.find((l) => /imported \d+ recipes/.test(l)),
  ].filter(Boolean) as string[];
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-sm text-success">
        <Check className="size-4 shrink-0" /> The reference data now matches the current mods.
      </p>
      {summary.length > 0 && (
        <ul className="space-y-0.5 text-sm text-muted-foreground">
          {summary.map((l) => (
            <li key={l}>· {l.replace(/^migrations:\s*/, "renames: ")}</li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">
        Blocks that referenced changed prototypes are flagged for review.
      </p>
    </div>
  );
}
