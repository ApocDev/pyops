import { expect, test } from "@playwright/test";
import { clearFactory, goto, insertBlock, uniqueName, withDb } from "./helpers";
import { solveFactory } from "./scenario-factory";

test("an import is marked only while no other enabled block produces it", async ({ page }) => {
  // Start from an empty factory so no block from an earlier spec supplies the import.
  clearFactory();
  const producerId = insertBlock(uniqueName("Plates"), {
    goals: [{ name: "iron-plate", rate: 1 }],
    recipes: ["iron-plate"],
  });
  const consumerId = insertBlock(uniqueName("Gears"), {
    goals: [{ name: "iron-gear-wheel", rate: 1 }],
    recipes: ["iron-gear-wheel"],
  });
  const setProducerEnabled = (enabled: boolean) =>
    withDb((db) =>
      db.prepare("UPDATE blocks SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, producerId),
    );

  // Saved block flows drive the marker, and inserted blocks have none until solved.
  await solveFactory(page);
  await goto(page, `/block/${consumerId}`);
  // The import chip renders either way; the marker only appears without a supplier.
  await expect(page.getByRole("button", { name: /^Iron plate / }).first()).toBeVisible();
  await expect(page.locator('[data-unsourced-import="iron-plate"]')).toBeHidden();

  setProducerEnabled(false);
  await page.reload();
  await expect(page.locator('[data-unsourced-import="iron-plate"]')).toBeVisible();

  setProducerEnabled(true);
  await page.reload();
  await expect(page.locator('[data-unsourced-import="iron-plate"]')).toBeHidden();
});
