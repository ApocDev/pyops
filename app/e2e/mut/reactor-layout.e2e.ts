import { expect, test } from "@playwright/test";
import { createBlock, goalRateButton } from "./helpers";

/**
 * Reactor neighbour bonus (#94): a heat block's reactor row carries a farm
 * layout chip. Picking 2×2 gives each reactor 2 working neighbours → Py's
 * breeder reactor (neighbour_bonus 1 = +100% each) makes ×3 heat, so the solved
 * reactor count drops to a third — and the choice persists.
 *
 * Project-independent (#122): the breeder's ×3 bonus is a Py constant, but its
 * raw power (hence the absolute reactor count) differs between mod configs
 * (2 GW in vanilla Py, 10 GW in py-hard-mode). So assert the INVARIANT — the
 * ×3 layout bonus and a strictly lower count — with the base count read at
 * runtime, not hardcoded. The heat goal also has several producers in some
 * configs, so pick the breeder from the picker when one opens.
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

  // click the goal icon to add a producer: one heat candidate auto-adds, several
  // open a picker — pick the breeder reactor either way
  await page.locator('button[title^="click to add a recipe that makes this goal"]').click();
  // the picker opens asynchronously (multi-candidate configs); give it a beat to
  // appear, then pick the breeder. A single-candidate config auto-adds — no dialog.
  const heatPicker = page.getByRole("dialog", { name: /Recipes that make/ });
  await heatPicker.waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
  if (await heatPicker.isVisible().catch(() => false)) {
    await heatPicker.getByRole("button", { name: /Breeder reactor heat/ }).click();
    await expect(heatPicker).toBeHidden();
  }
  // the reactor row is in the grid now
  await expect(page.getByText("Breeder reactor heat")).toBeVisible();

  // flat-rated (1×1): some whole+fraction of reactors, chip shows no bonus. The
  // building count is its own click-to-fix field (#121) beside the machine icon.
  const machineChip = page.locator('button[title="click to fix the building count"]');
  await expect(machineChip).toBeVisible();
  const baseCount = Number((await machineChip.textContent())?.trim());
  expect(baseCount).toBeGreaterThan(0);
  const layoutChip = page.locator('button[title^="reactor farm"]');
  await expect(layoutChip).toContainText("1×1");
  await expect(layoutChip).not.toContainText("heat");

  // pick a 2×2 farm: each reactor gains 2 neighbours → ×3 heat → a third the count
  await layoutChip.click();
  await page.getByRole("menuitem", { name: /^2×2/ }).click();
  await expect(layoutChip).toContainText("2×2");
  await expect(layoutChip).toContainText("×3 heat");
  const bonusCount = Number((await machineChip.textContent())?.trim());
  expect(bonusCount).toBeCloseTo(baseCount / 3, 2);

  // outlive the editor's 700ms auto-save debounce, then reload: the layout
  // (and the rescaled count) persisted with the block doc
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(layoutChip).toContainText("2×2");
  await expect(layoutChip).toContainText("×3 heat");
  await expect(machineChip).toBeVisible();
  const persisted = Number((await machineChip.textContent())?.trim());
  expect(persisted).toBeCloseTo(bonusCount, 2);
});
