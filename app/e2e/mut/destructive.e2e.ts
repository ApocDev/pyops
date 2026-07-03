import { expect, test } from "@playwright/test";
import {
  addGoal,
  blockNameInput,
  createBlock,
  expectUndoTop,
  sidebarBlockRow,
  toast,
  uniqueName,
  goto,
} from "./helpers";

/**
 * Consistent destructive actions (#83): the big delete (a block) confirms via
 * an AlertDialog whose copy names the block and what its deletion destroys,
 * then toasts with an Undo shortcut; small reversible deletes (a task) skip
 * the confirm entirely and rely on the undo toast alone.
 */

test("block delete: confirm dialog with real copy, cancel keeps it, undo toast restores it", async ({
  page,
}) => {
  const name = uniqueName("Doomed block");
  await createBlock(page);
  await addGoal(page, "iron plate", "Iron plate");
  await blockNameInput(page).fill(name); // typing a name pins it
  await expectUndoTop(page, new RegExp(`Undo: .* — ${name}|Undo: Edit block "${name}"`));

  const row = sidebarBlockRow(page, name);
  await row.hover();
  await row.getByRole("button", { name: "delete", exact: true }).click();

  // the AlertDialog names the block and states what's destroyed
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`Delete "${name}"?`);
  await expect(dialog).toContainText("0 recipes and 1 goal");

  // Cancel leaves the block intact
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toBeVisible();

  // Confirm deletes it and toasts with an Undo shortcut
  await row.hover();
  await row.getByRole("button", { name: "delete", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete block" }).click();
  const deleted = toast(page, `Deleted "${name}"`);
  await expect(deleted).toBeVisible();
  await expect(row).toBeHidden();

  // Undo (from the toast) brings the block back into the sidebar
  await deleted.getByRole("button", { name: "Undo" }).click();
  await expect(toast(page, /^Undid: /)).toBeVisible();
  await expect(sidebarBlockRow(page, name)).toBeVisible();
});

test("task delete fires immediately — undo toast, no confirm dialog", async ({ page }) => {
  const title = uniqueName("Doomed task");
  await goto(page, "/tasks");
  await page.getByRole("button", { name: "Task", exact: true }).click();

  // the new task opens in the detail pane; give it a findable title
  const titleInput = page.getByPlaceholder("Task title");
  await titleInput.fill(title);
  await titleInput.blur(); // saves on blur
  await expect(page.getByRole("complementary").getByRole("button", { name: title })).toBeVisible();

  await page.getByRole("button", { name: "delete task (undoable)" }).click();
  // no AlertDialog — the toast with Undo is the safety net
  await expect(page.getByRole("alertdialog")).toBeHidden();
  const deleted = toast(page, `Deleted "${title}"`);
  await expect(deleted).toBeVisible();
  await expect(deleted.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(
    page.getByRole("complementary").getByRole("button", { name: title }),
  ).toBeHidden();
});
