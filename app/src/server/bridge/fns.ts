/**
 * Server functions for the UDP bridge — the only bridge surface the client
 * touches. The dgram server is imported dynamically so node:dgram never lands in
 * the client bundle (same pattern as the db query layer).
 */
import { createServerFn } from "@tanstack/react-start";

const bridge = () => import("./server.ts");

/** Ensure the bridge is listening and return its status. Calling this from the
 * UI (polled) is what starts the socket — idempotent and HMR-safe. */
export const bridgeStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const b = await bridge();
  b.ensureBridge();
  return b.bridgeStatus();
});

/** Ask the connected mod to push its current state now (research, …). Returns
 * whether a peer was reachable. */
export const bridgeRequestSyncFn = createServerFn({ method: "POST" }).handler(async () => {
  const b = await bridge();
  b.ensureBridge();
  return { sent: b.sendToPeer({ type: "request.sync" }) };
});

/** Ask the connected game to locate a good in the world — the mod relays to the
 * Factory Search mod (producers / storage / consumers, zoomable). Fire-and-forget;
 * returns whether a peer was reachable. */
export const bridgeLocateFn = createServerFn({ method: "POST" })
  .validator((d: { name: string; kind: "item" | "fluid" }) => d)
  .handler(async ({ data }) => {
    const b = await bridge();
    b.ensureBridge();
    return {
      sent: b.sendToPeer({ type: "cmd.locate", payload: { name: data.name, kind: data.kind } }),
    };
  });
