import { expect, test, type Page } from "@playwright/test";
import { blockNameInput, createBlock, expectUndoTop, goto, uniqueName } from "./helpers";

/**
 * The Ctrl+K / `/` command palette (#78): open/close semantics (including the
 * input-focus rules of the hotkey layer) and fuzzy search over pages, blocks,
 * and actions. Lives in the mutating suite because the block-search case
 * creates its own block to find.
 */

const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette" });
const paletteInput = (page: Page) => page.getByRole("textbox", { name: "Search commands" });

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
  // the Pages group ranks Browse first, so it's the active item
  await expect(palette(page).getByRole("button", { name: "Browse" })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/browse$/);
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
