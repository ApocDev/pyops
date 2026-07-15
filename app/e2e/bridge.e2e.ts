import dgram from "node:dgram";
import { expect, test } from "@playwright/test";
import { APP_VERSION, PROTOCOL_VERSION } from "./versions";

/**
 * Bridge-fed UI without a running game — by being the mod.
 *
 * Instead of mocking the app's RPC layer, we open a real UDP socket and send the
 * app's bridge the same datagrams Factorio would (`bridge.ping`, with a player +
 * protocol version). The app's real socket → parse → lastPeer → bridgeStatus →
 * BridgeIndicator path then runs end-to-end; we only stand in for the game.
 *
 * This exercises the whole real stack (no mocked responses) and carries no
 * dependency on TanStack Start's wire format, so it won't break on their releases.
 * The dev server's bridge port is pinned via PYOPS_BRIDGE_PORT (see config).
 */

const BRIDGE_PORT = 37659;
const HOST = "127.0.0.1";

/** A stand-in for the companion mod: heartbeats the app's bridge on an interval
 * (the indicator treats a peer as connected only within a ~6s freshness window). */
function fakeMod(fields: { protocol_version: number; player?: string; mod_version?: string }) {
  const sock = dgram.createSocket("udp4");
  sock.on("error", () => {}); // ignore ICMP port-unreachable before the app binds
  let markReady: () => void;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  sock.on("message", markReady!);
  const ping = () => {
    const msg = Buffer.from(
      JSON.stringify({ request_id: "e2e", type: "bridge.ping", ...fields }),
    );
    sock.send(msg, BRIDGE_PORT, HOST);
  };
  ping();
  const timer = setInterval(ping, 1500);
  return {
    ready,
    stop: () => {
      clearInterval(timer);
      sock.close();
    },
  };
}

const label = (page: import("@playwright/test").Page) => page.locator("nav a[href*='tab=link']");

test("shows 'Game linked' for a fresh, protocol-matched peer", async ({ page }) => {
  await page.goto("/");
  const mod = fakeMod({ protocol_version: PROTOCOL_VERSION, player: "jim", mod_version: APP_VERSION });
  try {
    // Wait for the real bridge to answer a heartbeat, then reload so the first
    // status read cannot race the listener's asynchronous UDP bind.
    await mod.ready;
    await page.reload();
    await expect(label(page)).toContainText("Game linked");
    // the peer detail now lives in the styled tooltip, shown on hover
    await label(page).hover();
    await expect(page.getByRole("tooltip")).toContainText("jim");
  } finally {
    mod.stop();
  }
});

test("flags a protocol mismatch when the mod speaks a different version", async ({ page }) => {
  await page.goto("/");
  const mod = fakeMod({ protocol_version: PROTOCOL_VERSION - 1, player: "jim" });
  try {
    await mod.ready;
    await page.reload();
    await expect(label(page)).toContainText("Mod mismatch");
  } finally {
    mod.stop();
  }
});

// NOTE: deliberately no "peer goes stale → no game" test. The indicator computes
// freshness with Date.now() at render time, but once the heartbeat stops the
// bridge-status payload stops changing, so react-query never re-renders it — the
// label is stale-sticky until the next payload change. Asserting an automatic
// flip would be testing behavior the app doesn't have. (Minor real quirk.)
