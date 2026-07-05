import { expect, test } from "@playwright/test";
import { createBlock, goalRateButton, goto } from "./helpers";

/**
 * Reactor neighbour bonus (#94): a heat block's reactor row carries a farm
 * layout chip. Picking 2×2 scales each reactor's heat output ×3 (Py's breeder
 * reactor has neighbour_bonus 1 = +100% per adjacent working reactor), so the
 * solved reactor count drops to a third — and the choice persists.
 */
test("reactor row: picking a 2×2 farm scales heat ×3 and persists", async ({ page }) => {
  await createBlock(page);

  // goal: the pyops-heat pseudo-fluid at 6 GW (power goods edit in watt units)
  await page.locator('button[title="add a goal product"]').click();
  const goalDialog = page.getByRole("dialog", { name: "Add a goal product" });
  await goalDialog.getByPlaceholder("search an item or fluid…").fill("pyops heat");
  await goalDialog.getByRole("button", { name: "Heat (MJ)", exact: true }).click();
  await expect(goalDialog).toBeHidden();
  await expect(goalRateButton(page)).toHaveText("1 MW");
  await goalRateButton(page).click();
  const rateInput = page.locator("input:focus");
  await rateInput.fill("6GW");
  await rateInput.press("Enter");
  await expect(goalRateButton(page)).toHaveText("6 GW");

  // the goal is unmade — click its icon to add the producing recipe (a single
  // candidate — the breeder-reactor heat recipe — is auto-added, no dialog)
  await page.locator('button[title^="click to add a recipe that makes this goal"]').click();
  await expect(page.getByText("Breeder reactor heat")).toBeVisible();

  // flat-rated (1×1): 6 GW ÷ 2 GW per reactor = 3 reactors, chip shows no bonus.
  // The building count is now its own click-to-fix field (#121) beside the
  // machine icon — unpinned here, so it carries the "click to fix" title.
  const machineChip = page.locator('button[title="click to fix the building count"]');
  await expect(machineChip).toContainText("3");
  const layoutChip = page.locator('button[title^="reactor farm"]');
  await expect(layoutChip).toContainText("1×1");
  await expect(layoutChip).not.toContainText("heat");

  // pick a 2×2 farm: each reactor gains 2 neighbours → ×3 heat → 1 reactor
  await layoutChip.click();
  await page.getByRole("menuitem", { name: /^2×2/ }).click();
  await expect(layoutChip).toContainText("2×2");
  await expect(layoutChip).toContainText("×3 heat");
  await expect(machineChip).toContainText("1");

  // outlive the editor's 700ms auto-save debounce, then reload: the layout
  // (and the rescaled count) persisted with the block doc
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(layoutChip).toContainText("2×2");
  await expect(layoutChip).toContainText("×3 heat");
  await expect(machineChip).toContainText("1");
});
