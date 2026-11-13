import { expect, test, type Page } from "@playwright/test";
import { addGoal, createBlock, goto, setGoalRate } from "./helpers";

/**
 * The assistant dock (#131): the top-bar Ask button and Ctrl+. open a chat
 * beside any page; the page stays usable; the focused entity rides along as a
 * removable chip and reaches the request; "open in full page" lands on
 * /assistant with the same conversation; phones get a full-screen sheet. The
 * chat request is stubbed, so no model is called.
 */

type SentPart = { type: string; text?: string; data?: unknown };

/** Answer every chat send with a one-line streamed reply; returns the parts of
 * each sent user message, in order. */
async function stubChat(page: Page): Promise<SentPart[][]> {
  const sent: SentPart[][] = [];
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { messages: { parts: SentPart[] }[] };
    sent.push(body.messages.at(-1)!.parts);
    const chunks = [
      { type: "start", messageId: `a${sent.length}` },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: `Stub answer ${sent.length}.` },
      { type: "text-end", id: "t" },
      { type: "finish" },
    ];
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
      body: chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n",
    });
  });
  return sent;
}

const dock = (page: Page) => page.getByRole("complementary", { name: "Assistant" });
const askButton = (page: Page) => page.locator("nav").getByRole("button", { name: "Ask" });
const contextPart = (parts: SentPart[]) => parts.find((p) => p.type === "data-page-context");

test("the Ask button docks a chat beside a block with the block as context", async ({ page }) => {
  const sent = await stubChat(page);
  const blockId = await createBlock(page);
  await addGoal(page);

  await askButton(page).click();
  await expect(dock(page)).toBeVisible();
  await expect(askButton(page)).toHaveAttribute("aria-pressed", "true");
  const removeChip = dock(page).getByRole("button", { name: "Remove page context" });
  await expect(removeChip).toBeVisible();
  await expect(dock(page).getByText("Iron plate", { exact: true })).toBeVisible();

  // the dock sits beside the page, not over it, and the page still works
  const content = await page.locator("[data-app-content]").boundingBox();
  const panel = await dock(page).boundingBox();
  expect(content!.x + content!.width).toBeLessThanOrEqual(panel!.x + 1);
  await setGoalRate(page, "2");

  const composer = dock(page).getByPlaceholder("Ask about this block…");
  await composer.fill("Why does this need so much power?");
  await composer.press("Enter");
  await expect(dock(page).getByText("Stub answer 1.")).toBeVisible();
  // the sent message is tagged with where it was asked
  await expect(dock(page).getByTitle(`/block/${blockId}`)).toHaveText("Iron plate");
  expect(contextPart(sent[0])?.data).toMatchObject({
    path: `/block/${blockId}`,
    page: "Blocks",
    entity: { kind: "block", id: String(blockId), label: "Iron plate" },
  });

  // removing the chip sends the page without the entity
  await removeChip.click();
  await expect(removeChip).toBeHidden();
  await dock(page).getByPlaceholder("Ask about a recipe or chain…").fill("And in general?");
  await page.keyboard.press("Enter");
  await expect(dock(page).getByText("Stub answer 2.")).toBeVisible();
  expect(contextPart(sent[1])?.data).toEqual({ path: `/block/${blockId}`, page: "Blocks" });

  // full page shows the same conversation
  await dock(page).getByRole("button", { name: "Open in full page" }).click();
  await page.waitForURL(/\/assistant\?c=/);
  await expect(dock(page)).toBeHidden();
  await expect(page.getByText("Why does this need so much power?")).toBeVisible();
  await expect(page.getByText("Stub answer 2.")).toBeVisible();
});

test("Ctrl+. toggles the dock, even from a text field, and is listed", async ({ page }) => {
  await goto(page, "/explore?sel=iron-plate");
  await page.getByPlaceholder("Search items & fluids…").click();
  await page.keyboard.press("Control+.");
  await expect(dock(page)).toBeVisible();
  // Explore offers the selected good
  await expect(dock(page).getByText("Iron plate", { exact: true })).toBeVisible();
  await expect(dock(page).getByPlaceholder("Ask about this item…")).toBeFocused();
  await page.keyboard.press("Control+.");
  await expect(dock(page)).toBeHidden();

  await page.locator("nav").getByRole("link", { name: "PyOps" }).focus();
  await page.keyboard.press("?");
  await expect(
    page
      .getByRole("dialog", { name: "Keyboard shortcuts" })
      .getByText("Ask the assistant about this page"),
  ).toBeVisible();
});

test("on a phone the dock is a full-screen sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubChat(page);
  await goto(page, "/tasks");
  await page.locator("nav").getByRole("button", { name: "Ask" }).click();
  await expect(dock(page)).toBeVisible();
  expect(await dock(page).boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  await dock(page).getByPlaceholder("Ask about a recipe or chain…").fill("What next?");
  await page.keyboard.press("Enter");
  await expect(dock(page).getByText("Stub answer 1.")).toBeVisible();
  // the "asked from" tag names the page
  await expect(dock(page).getByText("Tasks", { exact: true })).toBeVisible();

  await dock(page).getByRole("button", { name: "Close" }).click();
  await expect(dock(page)).toBeHidden();
});
