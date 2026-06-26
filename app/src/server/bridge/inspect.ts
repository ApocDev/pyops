/**
 * App→mod read-only queries. The existing bridge is mod-initiated, but the app
 * can already push to the connected peer (sendToPeer, as `request.sync` does). We
 * reuse that: send a `cmd.*` with a fresh request_id, and the mod replies with a
 * `bridge.result` echoing that id (routed here by the dispatcher). A pending-map
 * correlates the reply back to the awaiting caller, with a timeout.
 *
 * These power the assistant's read-only game-world tools — bounded, structured,
 * no whole-map dumps. Node-only (depends on the dgram socket via server.ts).
 */
import { randomUUID } from "node:crypto";

import { ensureBridge, sendToPeer } from "./server.ts";
import type { BridgeRequest } from "./protocol.ts";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
const pending = new Map<string, Pending>();

/** Resolve the awaiting `requestFromMod` for a mod reply (`bridge.result`). */
export function handleModResult(req: BridgeRequest): void {
  const id = req.request_id;
  if (!id) return;
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  p.resolve(req.payload);
}

/** Send a `cmd.*` to the connected mod and await its `bridge.result` payload.
 * Rejects if no mod is connected or it doesn't reply within `timeoutMs`. */
export function requestFromMod(type: string, payload: unknown, timeoutMs = 4000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Self-heal the listener: after a dev-server restart the UDP socket may not be
    // bound yet (nothing polled bridgeStatusFn). Binding it now lets the mod's ~2s
    // heartbeat re-register the peer, so the next call connects even without the UI.
    ensureBridge();
    const id = randomUUID();
    const sent = sendToPeer({ type, request_id: id, payload });
    if (!sent) {
      reject(
        new Error("the in-game mod isn't connected (launch Factorio with the bridge enabled)"),
      );
      return;
    }
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("the in-game mod didn't reply in time"));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
  });
}
