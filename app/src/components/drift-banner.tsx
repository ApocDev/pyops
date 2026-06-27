import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { modDriftFn } from "../server/factorio";
import { bridgeStatusFn } from "../server/bridge/fns";

const TWO_HOURS = 2 * 60 * 60 * 1000;
const BRIDGE_FRESH_MS = 6000; // matches BridgeIndicator's "connected" window

/** Global "your reference data no longer matches the game" prompt. Polls mod drift
 * (current mod set vs the project's dump baseline) and shows a slim banner when a
 * re-dump is due, linking to the integrated sync on Settings › Game data.
 *
 * Re-checks on: mount (app start / project switch, which is a full reload), every
 * couple of hours in the background, on window focus, and whenever the in-game
 * bridge reconnects (Factorio likely restarted, maybe with a different mod set). */
export function DriftBanner() {
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState(false);

  const drift = useQuery({
    queryKey: ["modDrift"],
    queryFn: () => modDriftFn(),
    refetchInterval: TWO_HOURS,
    refetchOnWindowFocus: true,
  });

  // Reuse the shared bridge-status poll (BridgeIndicator drives it too); when it
  // transitions to connected, re-check drift — a restart can change the mod set.
  const bridge = useQuery({
    queryKey: ["bridgeStatus"],
    queryFn: () => bridgeStatusFn(),
    refetchInterval: 2000,
  });
  const peer = bridge.data?.lastPeer ?? null;
  const connected = peer != null && Date.now() - peer.lastSeenMs < BRIDGE_FRESH_MS;
  const prevConnected = useRef(connected);
  useEffect(() => {
    if (connected && !prevConnected.current) void qc.invalidateQueries({ queryKey: ["modDrift"] });
    prevConnected.current = connected;
  }, [connected, qc]);

  // A fresh check that changes the verdict un-dismisses the banner (so resolving
  // and later re-breaking re-surfaces it), while a session dismiss hides noise.
  const sig = JSON.stringify(drift.data?.drift ?? null);
  const prevSig = useRef(sig);
  useEffect(() => {
    if (sig !== prevSig.current) {
      setDismissed(false);
      prevSig.current = sig;
    }
  }, [sig]);

  if (!drift.data?.needsRedump || dismissed) return null;
  const d = drift.data.drift;
  const parts = [
    d?.added.length && `${d.added.length} added`,
    d?.removed.length && `${d.removed.length} removed`,
    d?.enabled.length && `${d.enabled.length} enabled`,
    d?.disabled.length && `${d.disabled.length} disabled`,
    d?.versionChanged.length && `${d.versionChanged.length} updated`,
  ].filter(Boolean);

  return (
    <div className="flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-1.5 font-mono text-sm text-amber-200">
      <span>
        ⚠ Your reference data no longer matches the game
        {parts.length ? ` (${parts.join(", ")})` : ""} — a data dump is needed.
      </span>
      <Link
        to="/settings"
        search={{ tab: "data" }}
        className="font-semibold underline hover:text-amber-100"
      >
        Review &amp; re-sync
      </Link>
      <button
        onClick={() => setDismissed(true)}
        title="dismiss for now (re-appears on the next change or reload)"
        className="ml-auto text-amber-300/70 hover:text-amber-100"
      >
        ✕
      </button>
    </div>
  );
}
