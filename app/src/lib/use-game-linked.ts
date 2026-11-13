import { useQuery } from "@tanstack/react-query";
import { bridgeStatusSubscription } from "./live-query-options";

/** The mod counts as connected if we've heard from it within this window (its
 * heartbeat pings ~every 2s). */
export const BRIDGE_FRESH_MS = 6000;

/** True while the companion mod is connected over the bridge. Reads the shared
 * ["bridgeStatus"] query (polled by AppLiveQueries), the same state the
 * top-bar BridgeIndicator shows. */
export function useGameLinked(): boolean {
  const peer = useQuery(bridgeStatusSubscription).data?.lastPeer ?? null;
  return peer != null && Date.now() - peer.lastSeenMs < BRIDGE_FRESH_MS;
}
