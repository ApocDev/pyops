import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { bridgeStatusSubscription } from "./live-query-options";

/** The mod counts as connected if we've heard from it within this window (its
 * heartbeat pings ~every 2s). */
export const BRIDGE_FRESH_MS = 6000;

/** True while the companion mod is connected over the bridge. Reads the shared
 * ["bridgeStatus"] query (polled by AppLiveQueries), the same state the
 * top-bar BridgeIndicator shows. Once heartbeats stop, the polled status stops
 * changing and React Query skips the re-render, so a timer re-renders when the
 * last heartbeat expires. */
export function useGameLinked(): boolean {
  const peer = useQuery(bridgeStatusSubscription).data?.lastPeer ?? null;
  const lastSeenMs = peer?.lastSeenMs;
  const [, setExpired] = useState(0);
  useEffect(() => {
    if (lastSeenMs == null) return;
    const remaining = lastSeenMs + BRIDGE_FRESH_MS - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setExpired((n) => n + 1), remaining);
    return () => clearTimeout(timer);
  }, [lastSeenMs]);
  return peer != null && Date.now() - peer.lastSeenMs < BRIDGE_FRESH_MS;
}
