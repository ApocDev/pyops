import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { bridgeRequestSyncFn, bridgeStatusFn } from "../server/bridge/fns";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";

/** Treat the mod as connected if we've heard from it within this window (its
 * heartbeat pings ~every 2s). */
const FRESH_MS = 6000;

/** Live UDP bridge status. Polling this is also what starts the listener
 * (bridgeStatusFn ensures the socket), so just mounting the card brings it up. */
export function BridgeCard() {
  const status = useQuery({
    queryKey: ["bridgeStatus"],
    queryFn: () => bridgeStatusFn(),
    refetchInterval: 2000,
  });
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
          ? "asked the mod to push — research appears in Planning horizon"
          : "no mod connected",
      ),
  });

  const dotColor =
    s?.status === "listening"
      ? versionMismatch
        ? "bg-destructive"
        : connected
          ? "bg-emerald-400"
          : "bg-amber-400"
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
              ? "version mismatch"
              : connected
                ? "mod connected"
                : "listening — no mod yet"
            : s?.status === "error"
              ? "error"
              : "starting…"}
        </span>
      </CardHeader>
      <div className="space-y-2 px-3 pb-3 text-sm">
        {s?.status === "error" ? (
          <p className="text-destructive">
            Couldn't bind UDP {s.host}:{s.port} — {s.error}
          </p>
        ) : (
          <p className="text-muted-foreground">
            Listening on <span className="text-foreground">{s?.host}</span>:
            <span className="text-foreground">{s?.port}</span> for the PyOps companion mod.
          </p>
        )}

        {connected && peer && (
          <div className="text-muted-foreground">
            last packet from <span className="text-foreground">{peer.player ?? peer.address}</span>{" "}
            · {Math.max(0, Math.round((Date.now() - peer.lastSeenMs) / 1000))}s ago
            {peer.modVersion && <> · mod v{peer.modVersion}</>}
            {peer.protocolVersion != null && <> · protocol v{peer.protocolVersion}</>}
          </div>
        )}
        {versionMismatch && peer && (
          <p className="flex items-start gap-1.5 rounded bg-destructive/15 px-2 py-1 text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              Version mismatch — this app expects protocol v{s?.appProtocolVersion}, the mod speaks
              v{peer.protocolVersion}. Update whichever is older (re-pull the repo / reload the mod)
              so the bridge stays in sync.
            </span>
          </p>
        )}
        {s && (s.packetsIn > 0 || s.packetsOut > 0) && (
          <div className="text-xs text-muted-foreground">
            {s.packetsIn} in · {s.packetsOut} out
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => pull.mutate()}
            disabled={!connected || pull.isPending}
            title="Ask the connected mod to push its current state now (research, …)"
            className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-sm hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${pull.isPending ? "animate-spin" : ""}`} />
            {pull.isPending ? "requesting…" : "pull from game"}
          </button>
          {pullMsg && <span className="text-xs text-muted-foreground">{pullMsg}</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          Or hit <span className="text-foreground">Sync now</span> in the in-game panel to push
          immediately — research only auto-syncs when a tech finishes.
        </p>

        <p className="text-xs text-muted-foreground">
          In game: set the mod's bridge port to{" "}
          <span className="font-mono text-foreground">{s?.port ?? 37657}</span>, enable the bridge
          in mod settings, and launch Factorio with{" "}
          <span className="font-mono text-foreground">--enable-lua-udp</span>. The mod's status
          flips to <span className="text-emerald-300">connected</span> on ping.
        </p>
      </div>
    </Card>
  );
}
