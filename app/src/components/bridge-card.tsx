import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Play, RefreshCw } from "lucide-react";
import {
  bridgeRequestSyncFn,
  bridgeStatusFn,
  factorioLaunchInfoFn,
  launchFactorioFn,
} from "../server/bridge/fns";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
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

  // "Launch Factorio" — spawns the game with --enable-lua-udp already set to a free
  // port, so the bridge connects with no manual flag wrangling.
  const launchInfo = useQuery({
    queryKey: ["factorioLaunchInfo"],
    queryFn: () => factorioLaunchInfoFn(),
    refetchInterval: 5000,
  });
  const gameRunning = launchInfo.data?.running === true;
  const [launchMsg, setLaunchMsg] = useState<string | null>(null);
  const launch = useMutation({
    mutationFn: () => launchFactorioFn(),
    onSuccess: (r) => {
      if (!r.ok) {
        setLaunchMsg(r.error ?? "launch failed");
        return;
      }
      setLaunchMsg(
        r.via === "steam"
          ? `launching via Steam with --enable-lua-udp ${r.port}…`
          : r.isSteam
            ? `Steam didn't respond — launched directly on --enable-lua-udp ${r.port} (no Steam Cloud saves / achievements). Make sure Steam is running, or set the flag in Steam's launch options and start from there.`
            : `launching with --enable-lua-udp ${r.port}…`,
      );
    },
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
          {!connected && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => launch.mutate()}
              disabled={gameRunning || launch.isPending}
              title={
                gameRunning
                  ? "Factorio is already running"
                  : "Launch Factorio with --enable-lua-udp already set to a free port"
              }
            >
              <Play className="size-3.5" />
              {launch.isPending
                ? "launching…"
                : gameRunning
                  ? "Factorio running"
                  : "Launch Factorio"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => pull.mutate()}
            disabled={!connected || pull.isPending}
            title="Ask the connected mod to push its current state now (research, …)"
          >
            <RefreshCw className={`size-3.5 ${pull.isPending ? "animate-spin" : ""}`} />
            {pull.isPending ? "requesting…" : "pull from game"}
          </Button>
          {pullMsg && <span className="text-sm text-muted-foreground">{pullMsg}</span>}
        </div>
        {launchMsg && <p className="text-sm text-muted-foreground">{launchMsg}</p>}
        <p className="text-sm text-muted-foreground">
          Or hit <span className="text-foreground">Sync now</span> in the in-game panel to push
          immediately — research only auto-syncs when a tech finishes.
        </p>

        <p className="text-sm text-muted-foreground">
          Prefer to start it yourself? Launch Factorio with{" "}
          <span className="font-mono text-foreground">
            --enable-lua-udp {(s?.port ?? 37657) + 1}
          </span>{" "}
          — any free port <em>other</em> than this app's{" "}
          <span className="font-mono text-foreground">{s?.port ?? 37657}</span>, since Factorio
          binds it itself and can't share. Leave the mod's bridge-port setting at{" "}
          <span className="font-mono text-foreground">{s?.port ?? 37657}</span>; it connects
          automatically — no in-game toggle.
        </p>
      </div>
    </Card>
  );
}
