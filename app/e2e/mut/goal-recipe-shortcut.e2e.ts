import { expect, test } from "@playwright/test";
import { addGoal, createBlock, expectUndoTop } from "./helpers";

test("Ctrl+Click adds the picker's best currently unlocked goal recipe", async ({ page }) => {
  await createBlock(page);
  await addGoal(page, "iron plate", "Iron plate");
  await expectUndoTop(page, /Undo: Edit block "Iron plate"/);

  const goal = page.getByRole("button", { name: "add a recipe that makes Iron plate" });
  await goal.click();
  const picker = page.getByRole("dialog", { name: "Recipes that make Iron plate" });
  await expect(picker.getByText("Unlocked now", { exact: true })).toBeVisible();
  const best = picker.locator("[data-recipe-candidate]").first();
  const bestName = await best.getAttribute("data-recipe-candidate");
  expect(bestName).toBeTruthy();
  expect(bestName).not.toMatch(/barrel/i);
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();

  await goal.click({ modifiers: ["Control"] });
  await expect(page.locator(`[data-recipe-row="${bestName}"]`)).toBeVisible();
  await expect(picker).toBeHidden();
  await expectUndoTop(page, /Undo: Add recipe/);
});
