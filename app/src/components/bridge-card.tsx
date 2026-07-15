import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { bridgeRequestSyncFn } from "../server/bridge/fns";
import { bridgeStatusSubscription } from "../lib/live-query-options";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { InfoHint } from "#/components/info-hint.tsx";
import { LaunchFactorioButton } from "#/components/launch-factorio-button.tsx";

/** Treat the mod as connected if we've heard from it within this window (its
 * heartbeat pings ~every 2s). */
const FRESH_MS = 6000;

/** Live UDP bridge status from the app-shell query owner. */
export function BridgeCard() {
  const status = useQuery(bridgeStatusSubscription);
  const s = status.data;
  const peer = s?.lastPeer ?? null;
  const connected = peer != null && Date.now() - peer.lastSeenMs < FRESH_MS;
  // protocol-version handshake: warn when the connected mod speaks a different
  // contract than this app expects (one side needs updating).
  const versionMismatch =
    connected &&
    peer?.protocolVersion != null &&
    s != null &&
    peer.protocolVersion !== s.appProtocolVersion;

  const [pullMsg, setPullMsg] = useState<string | null>(null);
  const pull = useMutation({
    mutationFn: () => bridgeRequestSyncFn(),
    onSuccess: (r) =>
      setPullMsg(
        r.sent
          ? "Asked the mod to push — research appears in Planning horizon"
          : "No mod connected",
      ),
  });

  const dotColor =
    s?.status === "listening"
      ? versionMismatch
        ? "bg-destructive"
        : connected
          ? "bg-success"
          : "bg-warning"
      : s?.status === "error"
        ? "bg-destructive"
        : "bg-muted-foreground";

  return (
    <Card>
      <CardHeader className="justify-between">
        <CardTitle>Live bridge</CardTitle>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span className={`inline-block size-2 rounded-full ${dotColor}`} />
          {s?.status === "listening"
            ? versionMismatch
              ? "Version mismatch"
              : connected
                ? "Mod connected"
                : "Listening — no mod yet"
            : s?.status === "error"
              ? "Error"
              : "Starting…"}
        </span>
      </CardHeader>
      <div className="space-y-2 px-3 pb-3 text-sm">
        {s?.status === "error" ? (
          <p className="text-destructive">
            Couldn't bind UDP {s.host}:{s.port} — {s.error}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <span>
              <span className="text-foreground">{s?.host}</span>:
              <span className="text-foreground">{s?.port}</span>
            </span>
            <InfoHint content="Waiting for the companion mod to connect." />
          </p>
        )}

        {connected && peer && (
          <div className="text-muted-foreground">
            Last packet from <span className="text-foreground">{peer.player ?? peer.address}</span>{" "}
            · {Math.max(0, Math.round((Date.now() - peer.lastSeenMs) / 1000))}s ago
            {peer.modVersion && <> · mod v{peer.modVersion}</>}
            {peer.protocolVersion != null && <> · protocol v{peer.protocolVersion}</>}
          </div>
        )}
        {versionMismatch && peer && (
          <Callout tone="destructive" icon={AlertTriangle}>
            Version mismatch — this app expects protocol v{s?.appProtocolVersion}, the mod speaks v
            {peer.protocolVersion}. Update whichever is older (re-pull the repo / reload the mod) so
            the bridge stays in sync.
          </Callout>
        )}
        {s && (s.packetsIn > 0 || s.packetsOut > 0) && (
          <div className="text-xs text-muted-foreground">
            {s.packetsIn} in · {s.packetsOut} out
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!connected && <LaunchFactorioButton size="sm" />}
          <Button
            variant="outline"
            size="sm"
            onClick={() => pull.mutate()}
            disabled={!connected || pull.isPending}
            title="Ask the connected mod to push its current state now (research, …)"
          >
            <RefreshCw className={`size-3.5 ${pull.isPending ? "animate-spin" : ""}`} />
            {pull.isPending ? "Requesting…" : "Pull from game"}
          </Button>
          <InfoHint content="Or hit Sync now in the in-game panel to push immediately — research only auto-syncs when a tech finishes." />
          {pullMsg && <span className="text-sm text-muted-foreground">{pullMsg}</span>}
        </div>
      </div>
    </Card>
  );
}
