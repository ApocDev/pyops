/**
 * PyOps ↔ Factorio UDP bridge — wire protocol.
 *
 * The companion mod sends JSON datagrams to the app and polls for replies; the
 * app answers each request on the same socket. This module is the pure envelope
 * layer (types + parse/serialize) — no transport, no Node deps — so handlers and
 * tests can use it without touching the socket.
 */

// The bridge wire contract. Bump on BOTH sides (here and the mod's PROTOCOL_VERSION
// in control.lua) whenever the message shapes change — each side warns when the
// other reports a different version.
export const PROTOCOL_VERSION = 4;

/** A request from the mod. `type` selects the handler; `payload` is type-specific. */
export type BridgeRequest = {
  protocol_version: number;
  type: string;
  request_id?: string;
  tick?: number;
  player?: string;
  mod_version?: string; // the installed mod's info.json version (display only)
  payload?: unknown;
};

/** A reply from the app. `request_id` echoes the request so the mod can correlate. */
export type BridgeResponse = {
  type: string;
  request_id?: string;
  protocol_version?: number; // app's contract version — pong carries it for the mod's check
  payload?: unknown;
};

/** Parse an incoming datagram into a request, or null if it isn't valid. */
export function parseRequest(buf: Buffer | string): BridgeRequest | null {
  try {
    const obj = JSON.parse(buf.toString("utf8")) as unknown;
    if (!obj || typeof obj !== "object") return null;
    const req = obj as Partial<BridgeRequest>;
    if (typeof req.type !== "string") return null;
    return {
      protocol_version: typeof req.protocol_version === "number" ? req.protocol_version : 0,
      type: req.type,
      request_id: typeof req.request_id === "string" ? req.request_id : undefined,
      tick: typeof req.tick === "number" ? req.tick : undefined,
      player: typeof req.player === "string" ? req.player : undefined,
      mod_version: typeof req.mod_version === "string" ? req.mod_version : undefined,
      payload: req.payload,
    };
  } catch {
    return null;
  }
}

/** Serialize a response for the socket. */
export function serialize(res: BridgeResponse): Buffer {
  return Buffer.from(JSON.stringify(res), "utf8");
}

/** Build an `error` response (the mod surfaces payload.message). */
export function errorResponse(message: string, request_id?: string): BridgeResponse {
  return { type: "error", request_id, payload: { message } };
}
