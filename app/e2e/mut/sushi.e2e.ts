import { expect, test } from "@playwright/test";
import { addGoal, createBlock } from "./helpers";

/**
 * Sushi planner (block balance header): with a plate + ore chain the block has
 * an internal flow (ore) and boundary flows, so the planner opens with per-item
 * rows, a verdict, and set-points that react to the loop-length input.
 */
test("sushi planner sizes one mixed loop for the block's flows", async ({ page }) => {
  await createBlock(page);

  await page.getByRole("button", { name: /^Logistics/ }).click();
  const logistics = page.getByRole("dialog", { name: "Logistics throughput" });
  await expect(logistics).toBeVisible();
  const belts = logistics.getByRole("switch", { name: "Belts" });
  if ((await belts.getAttribute("data-state")) !== "checked") await belts.click();
  await page.keyboard.press("Escape");

  await addGoal(page, "iron plate", "Iron plate");

  // plate recipe, then a producer for its ore ingredient → ore becomes internal
  await page.locator('button[aria-label^="Add a recipe that makes "]').click();
  const platePicker = page.getByRole("dialog", { name: /Recipes that make/ });
  await platePicker.locator('[data-recipe-candidate="iron-plate"]').click();
  await expect(platePicker).toBeHidden();
  await page.getByRole("button", { name: /^Iron ore.*(Raw input|Craftable)/ }).first().click();
  const orePicker = page.getByRole("dialog", { name: /Recipes that make/ });
  await orePicker.getByRole("button", { name: /Iron ore/ }).first().click();
  await expect(orePicker).toBeHidden();

  await page.getByRole("button", { name: "Sushi" }).click();
  const dialog = page.getByRole("dialog", { name: "Sushi planner" });
  await expect(dialog).toBeVisible();

  // a verdict callout and the ore row (internal flow) with a set-point
  await expect(dialog.getByText(/Comfortable|Workable|Fragile|Over capacity|Loop too small/)).toBeVisible();
  const oreRow = dialog.locator("div").filter({ hasText: /^.*Iron ore/ }).last();
  await expect(oreRow.getByText("INT")).toBeVisible();

  // loop length drives the lap/slot readout
  const tiles = dialog.getByLabel("Loop length in belt tiles");
  await tiles.fill("200");
  await expect(dialog.getByText(/Lap ≈ .* s · \d+\/\d+ slots/)).toBeVisible();

  // unticking a flow keeps the planner live (recomputes without it)
  await dialog.getByRole("checkbox").first().click();
  await expect(dialog.getByText(/Lap ≈/)).toBeVisible();

  // delivery: bridge send is gated on a connected mod (none here), the
  // blueprint-string copy works without one
  await expect(dialog.getByRole("button", { name: "To cursor in game" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Copy blueprint" })).toBeEnabled();
});
