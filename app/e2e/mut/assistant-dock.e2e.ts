import { expect, test, type Page } from "@playwright/test";
import {
  addGoal,
  blockNameInput,
  createBlock,
  goalRateButton,
  goto,
  insertBlock,
  setGoalRate,
  uniqueName,
  withDb,
} from "./helpers";

/**
 * The assistant dock (#131): the top-bar Ask button and Ctrl+. open a chat
 * beside any page; the page stays usable; the focused entity rides along as a
 * removable chip and reaches the request; "open in full page" lands on
 * /assistant with the same conversation; phones get a full-screen sheet. The
 * chat request is stubbed, so no model is called.
 */

type SentPart = { type: string; text?: string; data?: unknown };
type Chunk = Record<string, unknown> & { type: string };

const textReply = (n: number): Chunk[] => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: `Stub answer ${n}.` },
  { type: "text-end", id: "t" },
];

/** Answer every chat send with a streamed reply (one line of text by default);
 * returns the parts of each sent user message, in order. */
async function stubChat(page: Page, reply = textReply): Promise<SentPart[][]> {
  const sent: SentPart[][] = [];
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { messages: { parts: SentPart[] }[] };
    sent.push(body.messages.at(-1)!.parts);
    const chunks = [
      { type: "start", messageId: `a${sent.length}` },
      ...reply(sent.length),
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

// a side column from `lg` up, a modal sheet below
const dock = (page: Page) =>
  page
    .getByRole("complementary", { name: "Assistant" })
    .or(page.getByRole("dialog", { name: "Assistant" }));
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

test("applying a resize from the dock updates the open block editor", async ({ page }) => {
  const name = uniqueName("Dock apply");
  const blockId = insertBlock(name, { goals: [{ name: "iron-plate", rate: 1 }], recipes: ["iron-plate"] });
  // a reviseBlock proposal for the block that is open beside the dock
  await stubChat(page, () => [
    { type: "tool-input-available", toolCallId: "c1", toolName: "reviseBlock", input: {} },
    {
      type: "tool-output-available",
      toolCallId: "c1",
      output: {
        kind: "update",
        updateBlockId: blockId,
        blockName: name,
        target: "iron-plate",
        targetDisplay: "Iron plate",
        rate: 3,
        oldRate: 1,
        recipes: ["iron-plate"],
      },
    },
  ]);
  await goto(page, `/block/${blockId}`);
  await expect(goalRateButton(page)).toHaveText("1");

  await askButton(page).click();
  await dock(page).getByPlaceholder("Ask about this block…").fill("Triple it");
  await page.keyboard.press("Enter");
  await dock(page).getByRole("button", { name: /Apply update/ }).click();
  await expect(dock(page).getByText("Applied")).toBeVisible();
  await expect(goalRateButton(page)).toHaveText("3");

  // the editor's next auto-save keeps the applied rate instead of writing 1 back
  const renamed = uniqueName("Dock apply renamed");
  await blockNameInput(page).fill(renamed);
  const stored = () =>
    withDb(
      (db) =>
        db.prepare("SELECT name, data FROM blocks WHERE id = ?").get(blockId) as {
          name: string;
          data: string;
        },
      { readOnly: true },
    );
  await expect.poll(() => stored().name, { timeout: 15_000 }).toBe(renamed);
  expect(JSON.parse(stored().data).goals[0].rate).toBe(3);
});

test("applying a multi-goal update changes only the goals it names", async ({ page }) => {
  const name = uniqueName("Dock mall");
  const goals = [
    { name: "iron-plate", rate: 1 },
    { name: "iron-gear-wheel", rate: 0.1, stock: 60, window: 600 },
    { name: "pipe", rate: 0.05, stock: 30, window: 600 },
  ];
  const blockId = insertBlock(name, {
    goals,
    recipes: ["iron-plate", "iron-gear-wheel", "pipe"],
  });
  // a reviseBlock proposal raising the plate rate and the gear stock, not the pipes
  await stubChat(page, () => [
    { type: "tool-input-available", toolCallId: "c1", toolName: "reviseBlock", input: {} },
    {
      type: "tool-output-available",
      toolCallId: "c1",
      output: {
        ok: true,
        kind: "update",
        updateBlockId: blockId,
        blockName: name,
        target: "iron-plate",
        targetDisplay: "Iron plate",
        rate: 3,
        recipes: ["iron-plate", "iron-gear-wheel", "pipe"],
        goalChanges: [
          { name: "iron-plate", display: "Iron plate", before: { rate: 1 }, after: { rate: 3 } },
          {
            name: "iron-gear-wheel",
            display: "Iron gear wheel",
            before: { rate: 0.1, stock: 60, window: 600 },
            after: { rate: 0.2, stock: 120, window: 600 },
          },
        ],
      },
    },
  ]);
  await goto(page, `/block/${blockId}`);
  await askButton(page).click();
  await dock(page).getByPlaceholder("Ask about this block…").fill("Stock more gears");
  await page.keyboard.press("Enter");

  // the card lists each changed goal, old → new
  const card = dock(page);
  await expect(card.getByText("keep 120 (refill 10m)")).toBeVisible();
  await expect(card.getByText("keep 60 (refill 10m)")).toBeVisible();
  await card.getByRole("button", { name: /Apply update/ }).click();
  await expect(card.getByText("Applied")).toBeVisible();
  await expect(goalRateButton(page).first()).toHaveText("3");

  const stored = () =>
    withDb(
      (db) =>
        JSON.parse(
          (db.prepare("SELECT data FROM blocks WHERE id = ?").get(blockId) as { data: string })
            .data,
        ) as { goals: typeof goals },
      { readOnly: true },
    );
  expect(stored().goals).toEqual([
    { name: "iron-plate", rate: 3 },
    { name: "iron-gear-wheel", rate: 0.2, stock: 120, window: 600 },
    goals[2],
  ]);
});

test("an unsent draft survives closing the dock and opening the full page", async ({ page }) => {
  await goto(page, "/tasks");
  await askButton(page).click();
  const composer = dock(page).getByPlaceholder("Ask about a recipe or chain…");
  await composer.fill("Half-written question");
  await askButton(page).click();
  await expect(dock(page)).toBeHidden();
  await askButton(page).click();
  await expect(composer).toHaveValue("Half-written question");

  await dock(page).getByRole("button", { name: "Open in full page" }).click();
  await page.waitForURL(/\/assistant\?c=/);
  await expect(page.getByPlaceholder("Ask about a recipe or chain…")).toHaveValue(
    "Half-written question",
  );
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

test("on a phone the dock is a full-screen sheet that holds focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubChat(page);
  await goto(page, "/tasks");
  const ask = page.locator("nav").getByRole("button", { name: "Ask" });
  await ask.click();
  await expect(page.getByRole("dialog", { name: "Assistant" })).toBeVisible();
  // full screen once the slide-in settles
  await expect
    .poll(() => dock(page).boundingBox())
    .toEqual({ x: 0, y: 0, width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  await dock(page).getByPlaceholder("Ask about a recipe or chain…").fill("What next?");
  await page.keyboard.press("Enter");
  await expect(dock(page).getByText("Stub answer 1.")).toBeVisible();
  // the "asked from" tag names the page
  await expect(dock(page).getByText("Tasks", { exact: true })).toBeVisible();

  // the covered page can't take focus: Shift+Tab cycles inside the sheet
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await dock(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }

  await dock(page).getByRole("button", { name: "Close" }).click();
  await expect(dock(page)).toBeHidden();
  await expect(ask).toBeFocused();
});
