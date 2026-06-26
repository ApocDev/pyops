import dgram from "node:dgram";
import { expect, test } from "@playwright/test";

/**
 * The app→mod direction: a UI action should put the right datagram on the wire.
 * We can't confirm the in-game effect, but with a real fake-mod socket we CAN
 * confirm the app sent the expected request — and (for request/reply commands)
 * that a stubbed mod response flows back into the app.
 *
 * Pairs with bridge.e2e.ts (mod→app). The dev server's bridge port is pinned via
 * PYOPS_BRIDGE_PORT (see config).
 */

const BRIDGE_PORT = 37659;
const HOST = "127.0.0.1";

type Datagram = { type?: string; request_id?: string; payload?: unknown };

/** A fake mod that heartbeats to stay connected and records what the app sends it. */
function fakeMod(fields: { protocol_version: number; player?: string }) {
  const sock = dgram.createSocket("udp4");
  sock.on("error", () => {});
  const received: Datagram[] = [];
  sock.on("message", (msg) => {
    try {
      received.push(JSON.parse(msg.toString()) as Datagram);
    } catch {
      /* ignore non-JSON */
    }
  });
  const ping = () =>
    sock.send(
      Buffer.from(JSON.stringify({ request_id: "e2e", type: "bridge.ping", ...fields })),
      BRIDGE_PORT,
      HOST,
    );
  ping();
  const timer = setInterval(ping, 1500);
  return {
    received,
    stop: () => {
      clearInterval(timer);
      sock.close();
    },
  };
}

test("clicking 'pull from game' puts a request.sync datagram on the wire", async ({ page }) => {
  await page.goto("/settings?tab=link");
  const mod = fakeMod({ protocol_version: 4, player: "jim" });
  try {
    const pull = page.getByRole("button", { name: /pull from game/i });
    // the button is disabled until the bridge sees our heartbeat → connected
    await expect(pull).toBeEnabled();
    await pull.click();
    // the app should have emitted a request.sync to us
    await expect
      .poll(() => mod.received.some((m) => m.type === "request.sync"), { timeout: 5000 })
      .toBe(true);
  } finally {
    mod.stop();
  }
});
