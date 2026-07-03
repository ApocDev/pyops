import { expect, test } from "@playwright/test";
import { createBlock } from "./helpers";

/**
 * The v2 link model (#91): adding a producer through an item's chip marks the
 * item "made in this block" (production covers consumption, imports
 * forbidden); the mark is visible on the balance card's made strip and one
 * click unmarks it — the item flips back to an import and the producer row
 * honestly idles at 0.
 */
test("chip-adding a producer marks the item made; unmarking flips it back to an import", async ({
  page,
}) => {
  await createBlock(page);

  // goal: iron plate (any solid with a real chain works)
  await page.locator('button[title="add a goal product"]').click();
  const goalDialog = page.getByRole("dialog", { name: "Add a goal product" });
  await goalDialog.getByPlaceholder("search an item or fluid…").fill("iron plate");
  await goalDialog.getByRole("button", { name: "Iron plate", exact: true }).first().click();
  await expect(goalDialog).toBeHidden();

  // producer for the goal itself (goals self-link — no made mark expected)
  await page.locator('button[title^="click to add a recipe that makes this goal"]').click();
  const platePicker = page.getByRole("dialog", { name: /Recipes that make/ });
  await platePicker.getByRole("button", { name: /Iron plate/ }).first().click();
  await expect(platePicker).toBeHidden();
  await expect(page.getByText("made in this block:")).toBeHidden();

  // the plate recipe consumes iron ore (py.db: iron-plate ← 8 iron-ore),
  // showing as an import; adding a producer for it is the linking gesture —
  // the made strip appears with exactly that item
  await page
    .getByRole("button", { name: /^Iron ore.*(raw input|craftable)/ })
    .first()
    .click();
  const ingPicker = page.getByRole("dialog", { name: /Recipes that make/ });
  await ingPicker.getByRole("button", { name: /Iron ore/ }).first().click();
  await expect(ingPicker).toBeHidden();
  await expect(page.getByText("made in this block:")).toBeVisible();

  // unmark via the strip: the mark disappears and the item re-imports (its
  // producer row stays in the block but idles at 0)
  await page
    .getByRole("button", { name: /^Iron ore/, exact: false })
    .and(page.locator('[title*="Click to unmark"]'))
    .click();
  await expect(page.getByText("made in this block:")).toBeHidden();
  await expect(
    page.getByRole("button", { name: /^Iron ore.*(raw input|craftable)/ }).first(),
  ).toBeVisible();
});
