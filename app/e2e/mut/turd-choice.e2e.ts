import { expect, test } from "@playwright/test";
import { expectUndoTop, goto, toast, undoButton } from "./helpers";

/**
 * Choosing a TURD branch (#191) is a confirmed, undoable action: the option
 * header is plain text, Choose opens a confirm naming the blocks that re-solve,
 * and the top-bar Undo reverts the pick.
 */
test("choose a TURD upgrade → confirm → undo reverts it", async ({ page }) => {
  await goto(page, "/turd");
  const choose = page.getByRole("button", { name: /^Choose / }).first();
  await expect(choose).toBeVisible({ timeout: 30_000 });
  const sub = (await choose.getAttribute("aria-label"))!.replace(/^Choose /, "");

  // the click only opens the confirm; nothing is written until it's accepted
  await choose.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Choose TURD upgrade")).toBeVisible();
  await expect(dialog).toContainText(sub);
  await expect(dialog).toContainText(/This re-solves \d+ blocks?:|No blocks to re-solve\./);
  await dialog.getByRole("button", { name: "Choose upgrade" }).click();

  await expect(page.getByRole("button", { name: `Clear ${sub}` })).toBeVisible({
    timeout: 30_000,
  });
  await expectUndoTop(page, /Undo: Choose TURD/);

  await undoButton(page).click();
  await expect(toast(page, /Undid: Choose TURD/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: `Choose ${sub}` })).toBeVisible();
});
