import { expect, test } from "@playwright/test";
import { addGoal, createBlock } from "./helpers";

/**
 * Inline building-count pin (#121): a recipe row's building count is click-to-
 * fix. Clicking it opens a number field; typing a count pins the row (supply-
 * push) and the number tints to show it's fixed — no separate badge. Clearing
 * the field unpins it.
 */
test("building count: click to fix, tint shows fixed, clear to unpin", async ({ page }) => {
  await createBlock(page);
  await addGoal(page, "iron plate", "Iron plate");
  await page.locator('button[aria-label^="add a recipe that makes "]').click();
  const picker = page.getByRole("dialog", { name: /Recipes that make/ });
  await picker.getByRole("button", { name: /Iron plate/ }).first().click();
  await expect(picker).toBeHidden();

  // the row's building count is unpinned → click-to-fix
  const unpinned = page.locator('button[title="click to fix the building count"]');
  await expect(unpinned).toBeVisible();

  // click → type 4 → the row is fixed at 4 (tinted, own tooltip; no =N badge)
  await unpinned.click();
  const field = page.locator('input[inputmode="decimal"]');
  await field.fill("4");
  await field.press("Enter");
  const fixed = page.locator('button[title^="fixed at 4 building"]');
  await expect(fixed).toBeVisible();
  await expect(fixed).toContainText("4");
  // the old =N badge is gone
  await expect(page.getByText("=4")).toHaveCount(0);

  // clear the field → unpinned again
  await fixed.click();
  const field2 = page.locator('input[inputmode="decimal"]');
  await field2.fill("");
  await field2.press("Enter");
  await expect(page.locator('button[title="click to fix the building count"]')).toBeVisible();
  await expect(page.locator('button[title^="fixed at"]')).toHaveCount(0);
});
