import dgram from "node:dgram";
import { expect, test, type Page } from "@playwright/test";

import { MUT_BRIDGE_PORT } from "../ports";
import { PROTOCOL_VERSION } from "../versions";
import { clearFactory, goto, insertBlock, toast, uniqueName } from "./helpers";

/**
 * The in-game focus hotkey, played by a fake mod: send `block.focus` with a
 * recipe over the real UDP bridge and check where the open PyOps page goes.
 * One block → that block; several → the factory drawer listing them; none →
 * a toast whose action opens the good's drawer.
 */

type Reply = { type?: string; payload?: { result?: string; count?: number } };

/** Send `block.focus` until the app replies (the bridge socket binds on the
 * page's first status poll), and return the `block.focused` payload. */
async function focus(recipe: string): Promise<Reply["payload"]> {
  const sock = dgram.createSocket("udp4");
  sock.on("error", () => {});
  let reply: Reply | null = null;
  sock.on("message", (msg) => {
    const parsed = JSON.parse(msg.toString()) as Reply;
    if (parsed.type === "block.focused") reply = parsed;
  });
  const send = () =>
    sock.send(
      JSON.stringify({
        protocol_version: PROTOCOL_VERSION,
        type: "block.focus",
        request_id: "e2e-focus",
        payload: { recipe },
      }),
      MUT_BRIDGE_PORT,
      "127.0.0.1",
    );
  try {
    await expect
      .poll(
        () => {
          if (!reply) send();
          return reply !== null;
        },
        { timeout: 20_000, intervals: [500] },
      )
      .toBe(true);
    return reply!.payload;
  } finally {
    sock.close();
  }
}

async function openApp(page: Page) {
  await goto(page, "/explore");
}

test.beforeEach(() => clearFactory());

test("one block running the recipe opens that block", async ({ page }) => {
  const id = insertBlock(uniqueName("Gears"), { goals: [], recipes: ["iron-gear-wheel"] });
  await openApp(page);
  expect(await focus("iron-gear-wheel")).toMatchObject({ result: "block", count: 1 });
  await expect(page).toHaveURL(new RegExp(`/block/${id}$`), { timeout: 15_000 });
});

test("several blocks open the factory drawer listing them", async ({ page }) => {
  const a = uniqueName("Gears A");
  const b = uniqueName("Gears B");
  insertBlock(a, { goals: [], recipes: ["iron-gear-wheel"] });
  insertBlock(b, { goals: [], recipes: ["pipe", "iron-gear-wheel"] });
  await openApp(page);
  expect(await focus("iron-gear-wheel")).toMatchObject({ result: "several", count: 2 });

  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText(/^Running .* \(2\)$/)).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/factory$/);
  await expect(drawer.getByRole("link", { name: a })).toBeVisible();
  await expect(drawer.getByRole("link", { name: b })).toBeVisible();
});

test("no block running the recipe nudges to create one", async ({ page }) => {
  await openApp(page);
  expect(await focus("pipe")).toMatchObject({ result: "none", count: 0 });

  const nudge = toast(page, /^No block plans .+ yet/);
  await expect(nudge).toBeVisible({ timeout: 15_000 });
  await nudge.getByRole("button", { name: "Create one" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: /New block/ })).toBeVisible();
  await expect(page).toHaveURL(/\/factory$/);
});
