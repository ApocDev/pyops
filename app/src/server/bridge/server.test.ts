// Pin the bridge to a test-only UDP port before importing server.ts (it reads the
// port at module load). Keeps this off 37657 so it can't collide with a real mod.
process.env.PYOPS_BRIDGE_PORT = "37662";

import dgram from "node:dgram";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { PROTOCOL_VERSION } from "./protocol.ts";

const { ensureBridge, bridgeStatus } = await import("./server.ts");
const { requestFromMod } = await import("./inspect.ts");

const HOST = "127.0.0.1";
let PORT: number;
const mods: dgram.Socket[] = [];

/** A fake companion-mod socket (reused for ping + receiving app→mod sends). */
function fakeMod(): dgram.Socket {
  const sock = dgram.createSocket("udp4");
  sock.on("error", () => {});
  mods.push(sock);
  return sock;
}
const sendJson = (sock: dgram.Socket, obj: unknown) =>
  sock.send(Buffer.from(JSON.stringify(obj)), PORT, HOST);

/** Send one datagram and resolve with the app's reply (or reject on timeout). */
function rpc(sock: dgram.Socket, obj: unknown, ms = 1500): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no reply")), ms);
    sock.once("message", (msg) => {
      clearTimeout(timer);
      resolve(JSON.parse(msg.toString()) as Record<string, unknown>);
    });
    sendJson(sock, obj);
  });
}
/** Resolve true if NO reply arrives within `ms` (used for fire-and-forget cases). */
function expectSilence(sock: dgram.Socket, raw: Buffer | string, ms = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const onMsg = () => resolve(false);
    sock.once("message", onMsg);
    sock.send(typeof raw === "string" ? Buffer.from(raw) : raw, PORT, HOST);
    setTimeout(() => {
      sock.off("message", onMsg);
      resolve(true);
    }, ms);
  });
}

beforeAll(async () => {
  const r = ensureBridge();
  PORT = r.port;
  // wait for the socket to actually bind
  for (let i = 0; i < 50 && bridgeStatus().status !== "listening"; i++) {
    await new Promise((res) => setTimeout(res, 20));
  }
  expect(bridgeStatus().status).toBe("listening");
});

afterAll(() => {
  for (const m of mods) m.close();
  (
    globalThis as { __pyopsBridge?: { socket?: dgram.Socket | null } }
  ).__pyopsBridge?.socket?.close();
});

describe("bridge UDP server", () => {
  it("answers a heartbeat with a pong and records the peer", async () => {
    const mod = fakeMod();
    const reply = await rpc(mod, {
      protocol_version: 4,
      type: "bridge.ping",
      request_id: "h1",
      player: "jim",
      mod_version: "0.1.0",
    });
    expect(reply).toMatchObject({
      type: "bridge.pong",
      request_id: "h1",
      protocol_version: PROTOCOL_VERSION,
    });
    const peer = bridgeStatus().lastPeer;
    expect(peer).toMatchObject({ player: "jim", protocolVersion: 4, modVersion: "0.1.0" });
  });

  it("survives a malformed (non-JSON) datagram without replying or crashing", async () => {
    const mod = fakeMod();
    expect(await expectSilence(mod, "this is not json{")).toBe(true);
    // listener still healthy afterwards
    expect(bridgeStatus().status).toBe("listening");
    const reply = await rpc(mod, { protocol_version: 4, type: "bridge.ping", request_id: "h2" });
    expect(reply.type).toBe("bridge.pong");
  });

  it("ignores an unknown message type (no reply)", async () => {
    const mod = fakeMod();
    const silent = await expectSilence(
      mod,
      JSON.stringify({ protocol_version: 4, type: "totally.unknown" }),
    );
    expect(silent).toBe(true);
  });

  it("counts inbound packets", async () => {
    const before = bridgeStatus().packetsIn;
    const mod = fakeMod();
    await rpc(mod, { protocol_version: 4, type: "bridge.ping", request_id: "h3" });
    expect(bridgeStatus().packetsIn).toBeGreaterThan(before);
  });

  it("keeps listening after a transient UDP delivery error", async () => {
    const runtime = (
      globalThis as {
        __pyopsBridge?: { socket?: dgram.Socket | null; lastPeer?: unknown };
      }
    ).__pyopsBridge;
    expect(runtime?.socket).toBeTruthy();

    runtime?.socket?.emit(
      "error",
      Object.assign(new Error("recvmsg ECONNRESET"), { code: "ECONNRESET" }),
    );

    expect(bridgeStatus()).toMatchObject({ status: "listening", error: null, lastPeer: null });
    const mod = fakeMod();
    const reply = await rpc(mod, {
      protocol_version: 4,
      type: "bridge.ping",
      request_id: "after-reset",
    });
    expect(reply.type).toBe("bridge.pong");
  });

  it("round-trips an app→mod request: cmd sent to the peer, reply resolves the caller", async () => {
    const mod = fakeMod();
    // the fake mod answers any cmd.* with a bridge.result echoing the request_id
    mod.on("message", (msg, rinfo) => {
      const req = JSON.parse(msg.toString()) as { type?: string; request_id?: string };
      if (req.type === "cmd.locate") {
        mod.send(
          Buffer.from(
            JSON.stringify({
              protocol_version: 4,
              type: "bridge.result",
              request_id: req.request_id,
              payload: { producers: 2, storage: 1 },
            }),
          ),
          rinfo.port,
          rinfo.address,
        );
      }
    });
    // register as the connected peer first (app only sends to a known lastPeer)
    sendJson(mod, { protocol_version: 4, type: "bridge.ping", request_id: "reg" });
    await new Promise((res) => setTimeout(res, 100));

    const result = await requestFromMod("cmd.locate", { name: "iron-plate", kind: "item" }, 2000);
    expect(result).toEqual({ producers: 2, storage: 1 });
  });
});
