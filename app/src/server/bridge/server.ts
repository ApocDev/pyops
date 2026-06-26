/**
 * The app side of the UDP bridge: a localhost dgram socket that receives the
 * companion mod's datagrams, dispatches them, and replies to the sender.
 *
 * Node-only (uses node:dgram) — import it dynamically from server fns so it never
 * reaches the client bundle. The socket is a process singleton stashed on
 * globalThis so Vite HMR re-evaluating this module reuses the existing bind
 * instead of throwing EADDRINUSE.
 */
import dgram from "node:dgram";
import { PROTOCOL_VERSION, parseRequest, serialize, type BridgeResponse } from "./protocol.ts";

const HOST = "127.0.0.1"; // loopback only — the mod sends from the same machine
const PORT = Number(process.env.PYOPS_BRIDGE_PORT ?? 37657);

// Bump when the socket plumbing in THIS file changes — ensureBridge rebinds a
// stale singleton (created by older code) on the next poll. Handler additions in
// handlers.ts do NOT need a bump: dispatch is re-imported per message.
const BRIDGE_VERSION = 3;

export type BridgePeer = {
  address: string;
  port: number;
  player: string | null;
  protocolVersion: number | null; // the mod's wire-contract version
  modVersion: string | null; // the mod's info.json version (display)
  lastSeenMs: number;
};

export type BridgeRuntime = {
  socket: dgram.Socket | null;
  version: number;
  host: string;
  port: number;
  status: "listening" | "starting" | "error" | "stopped";
  error: string | null;
  startedMs: number;
  packetsIn: number;
  packetsOut: number;
  lastPeer: BridgePeer | null;
};

// HMR-safe singleton: the socket outlives module re-evaluation.
const globalRef = globalThis as unknown as { __pyopsBridge?: BridgeRuntime };

function create(): BridgeRuntime {
  const runtime: BridgeRuntime = {
    socket: null,
    version: BRIDGE_VERSION,
    host: HOST,
    port: PORT,
    status: "starting",
    error: null,
    startedMs: Date.now(),
    packetsIn: 0,
    packetsOut: 0,
    lastPeer: null,
  };

  const socket = dgram.createSocket("udp4");

  socket.on("listening", () => {
    runtime.status = "listening";
    runtime.error = null;
  });

  socket.on("error", (err) => {
    runtime.status = "error";
    runtime.error = err.message;
    try {
      socket.close();
    } catch {
      /* already closed */
    }
    runtime.socket = null;
  });

  socket.on("message", (msg, rinfo) => {
    runtime.packetsIn += 1;
    const req = parseRequest(msg);
    runtime.lastPeer = {
      address: rinfo.address,
      port: rinfo.port,
      player: req?.player ?? null,
      protocolVersion: req?.protocol_version ?? null,
      modVersion: req?.mod_version ?? null,
      lastSeenMs: Date.now(),
    };
    if (!req) return;
    // Re-import the dispatcher per message so newly-registered handlers take
    // effect in dev (HMR) without rebinding the socket.
    void import("./handlers.ts")
      .then(({ dispatch }) => dispatch(req))
      .then((res) => {
        if (!res) return;
        // reply to the datagram's source (Factorio's --enable-lua-udp socket)
        socket.send(serialize(res), rinfo.port, rinfo.address);
        runtime.packetsOut += 1;
      })
      .catch(() => {
        /* a handler threw — drop the reply rather than crash the listener */
      });
  });

  socket.bind(PORT, HOST);
  runtime.socket = socket;
  return runtime;
}

/** Start the bridge if it isn't already listening; idempotent. Rebinds a stale
 * singleton (older BRIDGE_VERSION) or an errored one. */
export function ensureBridge(): BridgeRuntime {
  const existing = globalRef.__pyopsBridge;
  if (
    existing &&
    existing.socket &&
    existing.status !== "error" &&
    existing.version === BRIDGE_VERSION
  ) {
    return existing;
  }
  if (existing?.socket) {
    try {
      existing.socket.close();
    } catch {
      /* already closing */
    }
  }
  const runtime = create();
  globalRef.__pyopsBridge = runtime;
  return runtime;
}

/** Send a message to the last peer we heard from (the connected mod). Returns
 * false if no peer is known yet. Used to ask the mod to push its state on demand
 * (the mod receives this only while its panel is open and polling). */
export function sendToPeer(msg: BridgeResponse): boolean {
  const r = globalRef.__pyopsBridge;
  if (!r?.socket || !r.lastPeer) return false;
  r.socket.send(serialize(msg), r.lastPeer.port, r.lastPeer.address);
  r.packetsOut += 1;
  return true;
}

export type BridgeStatus = Omit<BridgeRuntime, "socket"> & { appProtocolVersion: number };

/** Current bridge status (without starting it). Includes the app's expected
 * protocol version so the UI can flag a mismatch against the mod's. */
export function bridgeStatus(): BridgeStatus {
  const r = globalRef.__pyopsBridge;
  if (!r) {
    return {
      version: BRIDGE_VERSION,
      appProtocolVersion: PROTOCOL_VERSION,
      host: HOST,
      port: PORT,
      status: "stopped",
      error: null,
      startedMs: 0,
      packetsIn: 0,
      packetsOut: 0,
      lastPeer: null,
    };
  }
  const { socket: _socket, ...status } = r;
  return { ...status, appProtocolVersion: PROTOCOL_VERSION };
}
