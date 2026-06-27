import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { modDriftFn, startDataSyncFn, syncStateFn } from "../server/factorio";
import { bridgeStatusFn } from "../server/bridge/fns";
import { driftModal, useDriftModalOpen } from "../lib/drift-store";
import { type StepStatus, stepStatuses, stepsForRun } from "../lib/sync-steps";
import { DriftChanges } from "./drift-changes";

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

/** The guided data-sync experience: a themed modal that pops when mod drift is
 * detected (or is opened from the nav / Settings), lets you ignore or re-sync, and
 * then walks the dump as a step-by-step progress flow ending in a summary. Mounted
 * once in the root; it owns the periodic drift check and the sync polling. */
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
  const bridge = useQuery({
    queryKey: ["bridgeStatus"],
    queryFn: () => bridgeStatusFn(),
    refetchInterval: 2000,
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

  // Auto-open once per drift signature (until it's dismissed or resolved by a sync).
  const sig = drift.data?.needsRedump ? JSON.stringify(drift.data.drift) : null;
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
  // In the prompt, backdrop/✕ means "ignore" (remember it); mid/after a sync it just hides.
  const onClose = view === "prompt" ? dismiss : close;

  const steps = stepsForRun(icons);
  const statuses = stepStatuses(steps, phase, sync.data?.failedAt ?? null);
  const log = sync.data?.log ?? [];

  return (
    <Overlay onClose={onClose}>
      <Header view={view} onClose={onClose} />

      <div className="max-h-[60vh] overflow-auto px-4 py-3">
        {view === "prompt" && (
          <PromptBody
            hasDrift={!!drift.data?.needsRedump}
            drift={drift.data?.drift ?? null}
            icons={icons}
            setIcons={setIcons}
          />
        )}
        {(view === "running" || view === "error") && <Stepper steps={steps} statuses={statuses} />}
        {view === "done" && <DoneBody log={log} />}
        {view === "error" && (
          <div className="mt-3 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {sync.data?.error ?? "Sync failed."}
          </div>
        )}
        {(view === "running" || view === "done" || view === "error") && log.length > 0 && (
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              raw log
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-muted-foreground">
              {log.join("\n")}
            </pre>
          </details>
        )}
      </div>

      <Footer>
        {view === "prompt" && (
          <>
            <button onClick={dismiss} className={btnGhost}>
              Ignore for now
            </button>
            <button
              onClick={() => start.mutate()}
              disabled={start.isPending}
              className={btnPrimary}
            >
              {start.isPending ? "starting…" : "Re-sync now"}
            </button>
          </>
        )}
        {view === "running" && (
          <>
            <span className="mr-auto text-xs text-muted-foreground">
              You can close this — the sync keeps running.
            </span>
            <button onClick={close} className={btnGhost}>
              Hide
            </button>
          </>
        )}
        {view === "done" && (
          <>
            <Link to="/factory" onClick={close} className="mr-auto text-sm text-sky-400 underline">
              Review affected blocks →
            </Link>
            <button onClick={close} className={btnPrimary}>
              Done
            </button>
          </>
        )}
        {view === "error" && (
          <>
            <button onClick={close} className={btnGhost}>
              Close
            </button>
            <button
              onClick={() => start.mutate()}
              disabled={start.isPending}
              className={btnPrimary}
            >
              Retry
            </button>
          </>
        )}
      </Footer>
    </Overlay>
  );
}

const btnPrimary =
  "rounded bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/80 disabled:opacity-50";
const btnGhost =
  "rounded border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground";

function Overlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-[34rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-border bg-card font-mono shadow-2xl"
      >
        {children}
      </div>
    </div>
  );
}

const TITLES: Record<string, { icon: string; tone: string; text: string }> = {
  prompt: { icon: "⚠", tone: "text-amber-300", text: "Reference data is out of date" },
  running: { icon: "⟳", tone: "text-sky-300", text: "Re-syncing reference data" },
  done: { icon: "✓", tone: "text-emerald-300", text: "Reference data updated" },
  error: { icon: "✕", tone: "text-destructive", text: "Sync failed" },
};

function Header({ view, onClose }: { view: string; onClose: () => void }) {
  const t = TITLES[view];
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
      <span className={`text-base ${t.tone}`}>{t.icon}</span>
      <h2 className="text-sm font-semibold text-foreground">{t.text}</h2>
      <button
        onClick={onClose}
        className="ml-auto text-muted-foreground hover:text-foreground"
        aria-label="close"
      >
        ✕
      </button>
    </div>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
      {children}
    </div>
  );
}

function PromptBody({
  hasDrift,
  drift,
  icons,
  setIcons,
}: {
  hasDrift: boolean;
  drift: Parameters<typeof DriftChanges>[0]["drift"];
  icons: boolean;
  setIcons: (v: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {hasDrift
          ? "The game's mods changed since your last sync, so your saved plans were built against an older mod set. Re-sync to pull the current data — pure renames are applied automatically, and anything that genuinely changed is flagged on your blocks."
          : "Re-dump the game's prototype data from the current mods and import it. Pure renames are applied to your saved blocks automatically."}
      </p>
      {hasDrift && <DriftChanges drift={drift} />}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={icons} onChange={(e) => setIcons(e.target.checked)} />
        also re-dump icon sprites + rebuild the atlas
        <span className="text-muted-foreground/70">(loads the full game — slower)</span>
      </label>
    </div>
  );
}

function StepGlyph({ status }: { status: StepStatus }) {
  if (status === "active")
    return (
      <span className="mt-0.5 size-4 shrink-0 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
    );
  const map: Record<StepStatus, { ch: string; cls: string }> = {
    done: { ch: "✓", cls: "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" },
    error: { ch: "✕", cls: "border-destructive/50 bg-destructive/15 text-destructive" },
    pending: { ch: "", cls: "border-border text-muted-foreground" },
    active: { ch: "", cls: "" },
  };
  const { ch, cls } = map[status];
  return (
    <span
      className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${cls}`}
    >
      {ch}
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
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const st = statuses[i];
        const labelCls =
          st === "active"
            ? "font-semibold text-foreground"
            : st === "done"
              ? "text-emerald-300"
              : st === "error"
                ? "font-semibold text-destructive"
                : "text-muted-foreground";
        return (
          <li key={s.phase} className="flex items-start gap-3">
            <StepGlyph status={st} />
            <div className="min-w-0">
              <div className={`text-sm ${labelCls}`}>{s.label}</div>
              <div className="text-xs text-muted-foreground">{s.detail}</div>
            </div>
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
      <p className="text-sm text-emerald-300">✓ The reference data now matches the current mods.</p>
      {summary.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {summary.map((l) => (
            <li key={l}>· {l.replace(/^migrations:\s*/, "renames: ")}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Saved blocks that referenced changed prototypes may need a recompute — renamed ones were
        healed automatically; anything that vanished is flagged for review.
      </p>
    </div>
  );
}
