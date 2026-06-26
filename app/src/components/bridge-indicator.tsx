import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { bridgeStatusFn } from "../server/bridge/fns";

/** Treat the mod as connected if we've heard from it within this window (its
 * heartbeat pings ~every 2s) — matches BridgeCard. */
const FRESH_MS = 6000;

/** At-a-glance in-game link status for the global nav: a colored dot + label,
 * tooltip-explained, linking to Settings › In-game link. Shares the
 * ["bridgeStatus"] query with BridgeCard, and (like it) mounting this is what
 * starts the UDP listener — so the bridge is live on every page. */
export function BridgeIndicator() {
  const status = useQuery({
    queryKey: ["bridgeStatus"],
    queryFn: () => bridgeStatusFn(),
    refetchInterval: 2000,
  });
  const s = status.data;
  const peer = s?.lastPeer ?? null;
  const connected = peer != null && Date.now() - peer.lastSeenMs < FRESH_MS;
  const versionMismatch =
    connected &&
    peer?.protocolVersion != null &&
    s != null &&
    peer.protocolVersion !== s.appProtocolVersion;

  const { color, label, title } = (() => {
    if (s?.status === "error")
      return {
        color: "bg-destructive",
        label: "bridge error",
        title: `In-game bridge couldn't bind UDP ${s.host}:${s.port} — ${s.error ?? "error"}. Click to troubleshoot.`,
      };
    if (versionMismatch)
      return {
        color: "bg-destructive",
        label: "mod mismatch",
        title: `Mod connected but speaks protocol v${peer?.protocolVersion}; this app expects v${s?.appProtocolVersion}. Update whichever is older. Click for details.`,
      };
    if (connected)
      return {
        color: "bg-emerald-400",
        label: "game linked",
        title: `PyOps companion mod connected${peer?.player ? ` (${peer.player})` : ""}. Live research / TURD / machine sync is active. Click to manage.`,
      };
    if (s?.status === "listening")
      return {
        color: "bg-amber-400",
        label: "no game",
        title: `Listening on ${s.host}:${s.port} — no companion mod connected yet. Launch Factorio with the bridge enabled. Click to set it up.`,
      };
    return {
      color: "bg-muted-foreground",
      label: "bridge",
      title: "Starting the in-game bridge listener…",
    };
  })();

  return (
    <Link
      to="/settings"
      search={{ tab: "link" }}
      title={title}
      className="flex items-center gap-1.5 px-3 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
    >
      <span className={`inline-block size-2 rounded-full ${color}`} />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
