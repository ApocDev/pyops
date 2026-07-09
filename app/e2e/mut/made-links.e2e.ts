import { expect, test } from "@playwright/test";
import { createBlock } from "./helpers";

/**
 * The v2 link model (#91): a good's made state is toggled from its right-click
 * menu (the made set drives the solve but is not shown in a strip — the recipe
 * rows show what's produced). A made mark with no in-block producer degrades
 * silently to an import — no warning strip (the #91 nitpick). This drives the
 * import chip's menu and asserts the good stays an import either way.
 */
test("marking an import made without a producer keeps it a silent import", async ({ page }) => {
  await createBlock(page);

  // goal: iron plate (a real Py chain); its recipe consumes iron ore, an import
  await page.locator('button[title="add a goal product"]').click();
  const goalDialog = page.getByRole("dialog", { name: "Add a goal product" });
  await goalDialog.getByPlaceholder("search an item or fluid…").fill("iron plate");
  await goalDialog.getByRole("button", { name: "Iron plate", exact: true }).first().click();
  await expect(goalDialog).toBeHidden();

  await page.locator('button[title^="click to add a recipe that makes this goal"]').click();
  const platePicker = page.getByRole("dialog", { name: /Recipes that make/ });
  await platePicker.getByRole("button", { name: /Iron plate/ }).first().click();
  await expect(platePicker).toBeHidden();

  const oreImport = page.getByRole("button", { name: /^Iron ore.*(raw input|craftable)/ }).first();
  await expect(oreImport).toBeVisible();

  // right-click the import → the good menu offers the made gesture
  await oreImport.click({ button: "right" });
  const markItem = page.getByRole("menuitem", {
    name: /Require in-block production|Make in this block/,
  });
  await expect(markItem).toBeVisible();
  await markItem.click();

  // no producer exists for it, so marking made is a non-event: NO "no recipe
  // yet" strip, and the good still shows as an import
  await expect(page.getByText(/no recipe yet/)).toBeHidden();
  await expect(
    page.getByRole("button", { name: /^Iron ore.*(raw input|craftable)/ }).first(),
  ).toBeVisible();

  // the menu now reads "made" — unmarking it back is available and harmless
  await page
    .getByRole("button", { name: /^Iron ore.*(raw input|craftable)/ })
    .first()
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: /click to import instead/ }),
  ).toBeVisible();
});
