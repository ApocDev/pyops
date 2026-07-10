import { expect, test } from "@playwright/test";
import { addGoal, createBlock } from "./helpers";

test("incidental spoilage joins an intentional goal without duplicating its export", async ({
  page,
}) => {
  await createBlock(page);
  await addGoal(page, "biocrud", "Biocrud");

  // Intentional spoilage is ordinary goal-driven production through the real
  // synthetic recipe: one imported Agar per second becomes one Biocrud/s.
  await page.locator('button[aria-label^="add a recipe that makes "]').click();
  const picker = page.getByRole("dialog", { name: /Recipes that make/ });
  await picker.getByRole("button", { name: /Agar spoils/ }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByText("Agar spoils", { exact: true })).toBeVisible();

  // Add a separate operational estimate through the imported source item's
  // normal context menu. It must not resize the intentional recipe/import.
  const agarImport = page
    .getByRole("button", { name: /^Agar .*(?:raw input|craftable)/ })
    .first();
  await expect(agarImport).toBeVisible();
  await agarImport.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Estimate incidental spoilage…" }).click();

  const dialog = page.getByRole("dialog", { name: /Estimate incidental spoilage — Agar/ });
  await dialog.getByLabel("expected amount spoiled per second").fill("0.01");
  await dialog.getByRole("button", { name: "save estimate" }).click();
  await expect(dialog).toBeHidden();

  // The normal 1/s goal stays primary. Its incidental 0.01/s is shown beneath
  // it, while the duplicate display-only Exports column disappears.
  const goalButton = page.getByRole("button", { name: "add a recipe that makes Biocrud" });
  const goalCell = goalButton.locator("..");
  await expect(goalCell.getByLabel("0.01/s estimated incidental spoilage")).toBeVisible();
  await expect(page.getByText("Exports", { exact: true })).toHaveCount(0);
  await expect(agarImport).toHaveAccessibleName(/^Agar 1\/s/);

  // Goal context is folded into the one rich item card; the spoilage row keeps
  // its warning color and no second Radix text tooltip opens over it.
  await goalButton.hover();
  const spoilageContext = page.getByText("0.01/s estimated incidental spoilage", {
    exact: true,
  });
  await expect(spoilageContext).toBeVisible();
  await expect(spoilageContext).toHaveClass(/text-warning/);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});
