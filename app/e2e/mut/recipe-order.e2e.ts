import { expect, test } from "@playwright/test";
import { addGoal, createBlock, setPlanningHorizon } from "./helpers";

test("recipe picker ranks unlocked recipes before cheaper future tiers", async ({ page }) => {
  await createBlock(page);
  await addGoal(page, "seaweed", "Seaweed");
  await setPlanningHorizon(page, "Future");

  await page.locator('button[aria-label^="add a recipe that makes "]').click();
  const picker = page.getByRole("dialog", { name: "Recipes that make Seaweed" });
  const candidates = picker.locator("[data-recipe-candidate]");

  await expect(picker.getByText("Unlocked now", { exact: true })).toBeVisible();
  await expect(candidates.first()).toHaveAttribute("data-recipe-candidate", "seaweed-1");
  await expect(
    picker.locator('[data-recipe-candidate="seaweed-1"]'),
  ).toContainText("unlocked now");
  await expect(
    picker.locator('[data-recipe-candidate="seaweed-3"]'),
  ).toContainText("available in horizon");
});
