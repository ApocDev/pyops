import { expect, test } from "@playwright/test";
import { createBlock } from "./helpers";

/**
 * Sub-blocks v2 (#76): a display-only row group (#7) can be PROMOTED to a real,
 * separately-solved module. The parent then consumes only its boundary contract
 * — net imports → net exports — the way it consumes any recipe product. This
 * drives the main compose flow: build a chain, group its intermediate producer,
 * compose it, edit its internal goal, and confirm the promotion persists.
 */
test("promote a sub-block to a composed module, edit its goal, and persist", async ({ page }) => {
  await createBlock(page);

  // goal: iron plate (a real chain: iron-plate ← iron ore)
  await page.locator('button[title="add a goal product"]').click();
  const goalDialog = page.getByRole("dialog", { name: "Add a goal product" });
  await goalDialog.getByPlaceholder("search an item or fluid…").fill("iron plate");
  await goalDialog.getByRole("button", { name: "Iron plate", exact: true }).first().click();
  await expect(goalDialog).toBeHidden();

  // add the plate producer (self-links the goal)
  await page.locator('button[title^="click to add a recipe that makes this goal"]').click();
  const platePicker = page.getByRole("dialog", { name: /Recipes that make/ });
  await platePicker.getByRole("button", { name: /Iron plate/ }).first().click();
  await expect(platePicker).toBeHidden();

  // add an iron-ore producer, so the block has a two-recipe chain to fold
  await page
    .getByRole("button", { name: /^Iron ore.*(raw input|craftable)/ })
    .first()
    .click();
  const orePicker = page.getByRole("dialog", { name: /Recipes that make/ });
  await orePicker.getByRole("button", { name: /Iron ore/ }).first().click();
  await expect(orePicker).toBeHidden();

  // right-click the plate recipe row's name → "New sub-block from this row".
  // (The recipe grid's row name carries the context menu; the plate recipe
  // display is "Iron plate" — the last such title is the recipe row, not the
  // goal-card icon.)
  await page.getByTitle("Iron plate", { exact: true }).last().click({ button: "right" });
  await page.getByRole("menuitem", { name: /New sub-block from this row/ }).click();

  // a group header appears in rename-in-place; commit the name
  const nameInput = page.locator("input:focus");
  await nameInput.fill("Plate module");
  await nameInput.press("Enter");
  const header = page.locator("div").filter({ hasText: "Plate module" }).last();
  await expect(page.getByText("Plate module")).toBeVisible();

  // compose it: the Boxes button promotes the display fold to a real module
  await page.locator('button[title^="compose — solve this sub-block"]').click();
  await expect(page.getByText("module", { exact: true })).toBeVisible();
  // the block still solves (no infeasible badge on the module)
  await expect(header.getByText("infeasible")).toBeHidden();

  // edit the module's internal goals via the sliders button
  await page.locator('button[title="edit this module\'s internal goals"]').click();
  const goalsDialog = page.getByRole("dialog", { name: /Module goals/ });
  await expect(goalsDialog).toBeVisible();
  await goalsDialog.getByRole("button", { name: "save" }).click();
  await expect(goalsDialog).toBeHidden();

  // outlive the auto-save debounce, reload: the module promotion persisted
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.getByText("Plate module")).toBeVisible();
  await expect(page.getByText("module", { exact: true })).toBeVisible();

  // revert to a display-only fold: the module badge disappears
  await page.locator('button[title^="revert to a display-only sub-block"]').click();
  await expect(page.getByText("module", { exact: true })).toBeHidden();
});
