import { expect, test } from "@playwright/test";
import { addGoal, createBlock } from "./helpers";

/**
 * The block flow view (#101): a solved block can be viewed as a layered
 * material-flow diagram instead of the recipe table. This drives the main flow —
 * build a tiny block, switch to the Flow tab, confirm the diagram renders with a
 * recipe node, then click that node and confirm it jumps back to the table row.
 */
test("the flow view renders a block's material flow and a node focuses its table row", async ({
  page,
}) => {
  await createBlock(page);
  await addGoal(page, "iron plate", "Iron plate");

  // add a producer for the goal so the block has a running recipe (and thus a
  // node + links in the diagram) — the goal card's "make this goal" affordance.
  await page.locator('button[aria-label^="add a recipe that makes "]').click();
  const picker = page.getByRole("dialog", { name: /Recipes that make/ });
  await picker.getByRole("button", { name: /Iron plate/ }).first().click();
  await expect(picker).toBeHidden();

  // switch to the Flow view; the diagram panel and a clickable recipe node appear
  await page.getByRole("button", { name: "Flow", exact: true }).click();
  await expect(page.getByText("Material flow")).toBeVisible();
  const recipeNode = page.locator('button[title$="click to open in the table"]').first();
  await expect(recipeNode).toBeVisible();

  // clicking a recipe node returns to the table and focuses that recipe's row
  // ("Table" must be exact — "craftable" chip labels otherwise match the name).
  await recipeNode.click();
  await expect(page.getByText("Material flow")).toBeHidden();
  await expect(page.getByRole("button", { name: "Table", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Ingredients ↓", { exact: false }).first()).toBeVisible();
});
