import { expect, test, type Page } from "@playwright/test";
import { blockNameInput, createBlock, expectUndoTop, goto, uniqueName } from "./helpers";

/**
 * The Ctrl+K / `/` command palette (#78): open/close semantics (including the
 * input-focus rules of the hotkey layer), fuzzy search over pages, blocks,
 * and actions, server-side goods search, recents on an empty query, and the
 * `?` shortcut help sheet. Lives in the mutating suite because the block-search
 * and recents cases create their own blocks to find.
 */

const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette" });
const paletteInput = (page: Page) => page.getByRole("textbox", { name: "Search commands" });
// One result group ("Recent" / "Pages" / "Blocks" / "Goods" / "Actions") — a
// block and a good can share a visible name, so assertions scope by group.
const group = (page: Page, title: string) => palette(page).locator(`[data-group="${title}"]`);
const helpSheet = (page: Page) => page.getByRole("dialog", { name: "Keyboard shortcuts" });

test("Ctrl+K opens from any page; Escape closes", async ({ page }) => {
  await goto(page, "/");
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  await expect(paletteInput(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();

  // a second page, for "from any page"
  await goto(page, "/tasks");
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();
});

test("Ctrl+K opens even while typing in an input", async ({ page }) => {
  await goto(page, "/block");
  const search = page.getByPlaceholder("search blocks…");
  await search.click();
  await search.pressSequentially("iro");
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
});

test("'/' opens the palette only when NOT typing in a field", async ({ page }) => {
  await goto(page, "/block");

  // focused in a text field: '/' must type a slash, not open the palette
  const search = page.getByPlaceholder("search blocks…");
  await search.click();
  await search.press("/");
  await expect(palette(page)).toBeHidden();
  await expect(search).toHaveValue("/");

  // focus outside any field: '/' opens it
  await search.press("Escape"); // no-op for the input; just leave it deterministic
  await page.locator("nav").getByRole("link", { name: "PyOps" }).focus();
  await page.keyboard.press("/");
  await expect(palette(page)).toBeVisible();
  // and the slash did not leak into the search box
  await expect(paletteInput(page)).toHaveValue("");
});

test("fuzzy query matches a page and Enter navigates to it", async ({ page }) => {
  await goto(page, "/");
  await page.keyboard.press("Control+k");
  await paletteInput(page).fill("browse");
  // The renamed Explore workspace keeps Browse as a search alias.
  await expect(palette(page).getByRole("button", { name: "Explore" })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/explore$/);
  await expect(palette(page)).toBeHidden();
});

test("finds a block by display name and opens it on Enter", async ({ page }) => {
  const name = uniqueName("Palette target");
  const id = await createBlock(page);
  await blockNameInput(page).fill(name);
  await expectUndoTop(page, new RegExp(`Undo: Edit block "${name}"`));

  await goto(page, "/");
  await page.keyboard.press("Control+k");
  // a fuzzy fragment: drop the spaces, keep the unique suffix
  await paletteInput(page).fill(name.toLowerCase().replaceAll(" ", ""));
  await expect(palette(page).getByRole("button", { name, exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.waitForURL(new RegExp(`/block/${id}$`));
  await expect(blockNameInput(page)).toHaveValue(name);
});

test("goods search finds an item server-side and jumps to its browse view", async ({ page }) => {
  await goto(page, "/");
  await page.keyboard.press("Control+k");
  await paletteInput(page).fill("iron plate");
  // the Goods group fills from the (debounced) server search
  const good = group(page, "Goods").getByRole("button", { name: "Iron plate", exact: true });
  await expect(good).toBeVisible();
  await good.click();
  await page.waitForURL(/\/explore\?sel=iron-plate$/);
  await expect(palette(page)).toBeHidden();
  // and the browse detail actually resolved
  await expect(page.getByRole("heading", { name: "Iron plate" })).toBeVisible();
});

test("empty palette surfaces recently visited blocks and goods", async ({ page }) => {
  // visit a block (the editor records the visit on load; the label resolves live)
  const name = uniqueName("Recent target");
  await createBlock(page);
  await blockNameInput(page).fill(name);
  await expectUndoTop(page, new RegExp(`Undo: Edit block "${name}"`));

  // visit a good in the browser — recorded the same way
  await goto(page, "/explore?sel=iron-plate");
  await expect(page.getByRole("heading", { name: "Iron plate" })).toBeVisible();

  await goto(page, "/");
  await page.keyboard.press("Control+k");
  const recent = group(page, "Recent");
  // most recent first: the good was visited after the block
  await expect(recent.getByRole("button", { name: "Iron plate", exact: true })).toBeVisible();
  await expect(recent.getByRole("button", { name, exact: true })).toBeVisible();
  // running a recent entry jumps straight back
  await recent.getByRole("button", { name, exact: true }).click();
  await page.waitForURL(/\/block\/\d+$/);
  await expect(blockNameInput(page)).toHaveValue(name);
});

test("'?' opens the shortcut help sheet listing active hotkeys", async ({ page }) => {
  await goto(page, "/");

  // '?' inside a text field must not open the sheet (it types a question mark)
  await page.keyboard.press("Control+k");
  await paletteInput(page).press("?");
  await expect(helpSheet(page)).toBeHidden();
  await expect(paletteInput(page)).toHaveValue("?");
  await page.keyboard.press("Escape");

  // outside a field it opens, and lists the root-registered shortcuts
  await page.locator("nav").getByRole("link", { name: "PyOps" }).focus();
  await page.keyboard.press("?");
  await expect(helpSheet(page)).toBeVisible();
  await expect(helpSheet(page).getByText("Open the command palette")).toBeVisible();
  await expect(helpSheet(page).getByText("Ctrl+K", { exact: true })).toBeVisible();
  await expect(helpSheet(page).getByText("Undo the last action")).toBeVisible();
  await expect(helpSheet(page).getByText("Show keyboard shortcuts")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(helpSheet(page)).toBeHidden();
});

test("the palette's 'Keyboard shortcuts' action opens the help sheet", async ({ page }) => {
  await goto(page, "/");
  await page.keyboard.press("Control+k");
  await paletteInput(page).fill("keyboard");
  await group(page, "Actions").getByRole("button", { name: "Keyboard shortcuts" }).click();
  await expect(palette(page)).toBeHidden();
  await expect(helpSheet(page)).toBeVisible();
});
