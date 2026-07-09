import { expect, test } from "@playwright/test";
import { addGoal, blockNameInput, createBlock } from "./helpers";

test("extract a recipe row into a dedicated block from the row icon menu", async ({ page }) => {
  await createBlock(page);
  await addGoal(page, "iron plate", "Iron plate");

  await page.locator('button[title^="click to add a recipe that makes this goal"]').click();
  const platePicker = page.getByRole("dialog", { name: /Recipes that make/ });
  await platePicker.getByRole("button", { name: /Iron plate/ }).first().click();
  await expect(platePicker).toBeHidden();

  await page.getByRole("button", { name: /^Iron ore.*(raw input|craftable)/ }).first().click();
  const orePicker = page.getByRole("dialog", { name: /Recipes that make/ });
  await orePicker.getByRole("button", { name: /Iron ore/ }).first().click();
  await expect(orePicker).toBeHidden();

  const rowIcons = page.locator("[data-recipe-row-icon]");
  await expect(rowIcons).toHaveCount(2);
  await rowIcons.nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Extract into new block" }).click();

  await expect(blockNameInput(page)).toHaveValue("Iron ore", { timeout: 15_000 });
  await expect(page.locator("[data-recipe-row-icon]")).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: /Extracted "Iron ore"/ })).toBeVisible();
});
