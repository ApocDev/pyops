import { expect, test } from "@playwright/test";

/**
 * Bridge-fed UI without a running game: we intercept the `bridgeStatusFn`
 * server-function response and feed the UI canned mod state. This is the pattern
 * for stress-testing anything driven by the in-game bridge (live research/TURD/
 * built sync, custom recipes) from the browser — drive the RPC, assert the UI.
 *
 * The response uses TanStack Start's seroval wire format; `serialize()` rebuilds
 * that envelope (validated against a real capture — see the smoke run).
 */

type Json = null | number | string | boolean | { [k: string]: Json };

/** Encode a value as TanStack Start's seroval node tree (objects get DFS ids). */
function serialize(result: Json): string {
  let id = 0;
  const node = (v: Json): unknown => {
    if (v === null || v === undefined) return { t: 2, s: 0 };
    if (typeof v === "number") return { t: 0, s: v };
    if (typeof v === "string") return { t: 1, s: v };
    if (typeof v === "boolean") return { t: 0, s: v ? 1 : 0 };
    const i = id++;
    const keys = Object.keys(v);
    return { t: 10, i, p: { k: keys, v: keys.map((k) => node(v[k])) }, o: 0 };
  };
  const envId = id++; // envelope is id 0
  const resultNode = node(result); // result subtree next
  const contextNode = { t: 11, i: id++, p: { k: [], v: [] }, o: 0 };
  // envelope's error slot is "no error" → seroval undefined constant {t:2,s:1}
  // (a null *field* is {t:2,s:0}); verified byte-identical to a real capture.
  return JSON.stringify({
    t: 10,
    i: envId,
    p: { k: ["result", "error", "context"], v: [resultNode, { t: 2, s: 1 }, contextNode] },
    o: 0,
  });
}

type Peer = { lastSeenMs: number; protocolVersion: number; player: string } | null;
function status(over: Partial<{ status: string; error: string | null; appProtocolVersion: number; lastPeer: Peer }>) {
  const base = {
    version: 3,
    host: "127.0.0.1",
    port: 37657,
    status: "listening",
    error: null as string | null,
    startedMs: 1,
    packetsIn: 0,
    packetsOut: 0,
    lastPeer: null as Peer,
    appProtocolVersion: 4,
  };
  return { ...base, ...over } as unknown as Json;
}

/** Make every bridgeStatusFn call return our canned status; let other RPCs through. */
async function mockBridge(page: import("@playwright/test").Page, value: Json) {
  await page.route("**/_serverFn/**", async (route) => {
    const seg = route.request().url().split("/_serverFn/")[1]?.split("?")[0] ?? "";
    let isBridge = false;
    try {
      isBridge = String(
        JSON.parse(Buffer.from(seg, "base64").toString()).export,
      ).includes("bridgeStatusFn");
    } catch {
      /* not a decodable id */
    }
    if (isBridge)
      await route.fulfill({
        // TanStack Start only deserializes responses flagged with this header
        headers: { "x-tss-serialized": "true" },
        contentType: "application/json",
        body: serialize(value),
      });
    else await route.fallback();
  });
}

const label = (page: import("@playwright/test").Page) =>
  page.locator("nav a[href*='tab=link']");

test("shows 'game linked' for a fresh, protocol-matched peer", async ({ page }) => {
  await mockBridge(page, status({ lastPeer: { lastSeenMs: Date.now(), protocolVersion: 4, player: "jim" } }));
  await page.goto("/");
  await expect(label(page)).toContainText("game linked");
  await expect(label(page).getByText("game linked")).toBeVisible();
});

test("flags a protocol mismatch when the mod speaks a different version", async ({ page }) => {
  await mockBridge(page, status({ lastPeer: { lastSeenMs: Date.now(), protocolVersion: 3, player: "jim" } }));
  await page.goto("/");
  await expect(label(page)).toContainText("mod mismatch");
});

test("shows 'no game' while listening with no peer", async ({ page }) => {
  await mockBridge(page, status({ status: "listening", lastPeer: null }));
  await page.goto("/");
  await expect(label(page)).toContainText("no game");
});

test("surfaces a bind error", async ({ page }) => {
  await mockBridge(page, status({ status: "error", error: "EADDRINUSE" }));
  await page.goto("/");
  await expect(label(page)).toContainText("bridge error");
});
