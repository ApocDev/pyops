import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, addGoal, createBlock, setGoalRate } from "./helpers";

test("a throughput-heavy row warns when loading access needs more buildings", async ({ page }) => {
  // Footprints arrive through a game-data sync in production. This isolated DB
  // is a seeded snapshot, so arrange the one imported prototype this flow uses.
  const db = new DatabaseSync(activeProjectDbFile());
  try {
    db.exec(`
      UPDATE crafting_machines
      SET tile_width = 3, tile_height = 3
      WHERE name = 'assembling-machine-1'
    `);
  } finally {
    db.close();
  }

  await createBlock(page);
  await addGoal(page, "small parts", "Small parts");

  // Add the Small parts recipe, then make the machine/rate deterministic.
  await page.locator('button[aria-label^="Add a recipe that makes "]').click();
  const recipes = page.getByRole("dialog", { name: /Recipes that make/ });
  await recipes.locator('[data-recipe-candidate="small-parts-01"]').click();
  await expect(recipes).toBeHidden();

  await page.locator('button[aria-label^="Change "][aria-label$=" building"]').click();
  const buildings = page.getByRole("dialog", { name: /Building for/ });
  await buildings.getByRole("button", { name: /^Burner assembling machine MK 01/ }).click();
  await expect(buildings).toBeHidden();
  await setGoalRate(page, "8.375");

  // Select the same basic, unstacked inserter the estimate is expected against.
  await page.getByRole("button", { name: /^Logistics/ }).click();
  const logistics = page.getByRole("dialog", { name: "Logistics throughput" });
  const showInserters = logistics.getByRole("switch", { name: "Inserters / loaders" });
  if ((await showInserters.getAttribute("data-state")) !== "checked") await showInserters.click();
  await logistics.locator('button[title*="(inserter)"]').click();
  const useStacking = logistics.getByRole("switch", { name: "Use stacking research" });
  if ((await useStacking.getAttribute("data-state")) === "checked") await useStacking.click();
  await page.keyboard.press("Escape");
  await expect(logistics).toBeHidden();

  const warning = page.getByLabel("Suggested build count 4");
  await expect(warning).toBeVisible();
  await expect(warning).toHaveText("4");
  await warning.hover();
  await expect(page.getByText(/does not prove belts or pipes can be routed/)).toBeVisible();
});
