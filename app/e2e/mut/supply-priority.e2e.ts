import { expect, test } from "@playwright/test";
import { addGoal, createBlock, expectUndoTop } from "./helpers";

test("block supply priority can be changed and persists", async ({ page }) => {
  await createBlock(page);
  await addGoal(page);

  const priority = page.getByRole("button", { name: "Block supply priority: Normal" });
  await expect(priority).toBeVisible();
  await priority.click();
  await page.getByRole("menuitem", { name: "Preferred" }).click();
  await expect(page.getByRole("button", { name: "Block supply priority: Preferred" })).toBeVisible();

  // Block edits auto-save. Reloading proves the setting survived the server round trip.
  await expectUndoTop(page, /Set block supply priority/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Block supply priority: Preferred" })).toBeVisible();
});
