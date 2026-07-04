import { expect, test } from "@playwright/test";

/**
 * Theme toggle (#107): Settings → Display → Theme flips the `.dark` class and
 * `color-scheme` on <html> and persists across a reload. This exercises the
 * MECHANISM; the pixel-level light-mode contrast pass is a human visual review.
 */
test("theme toggle flips the dark class and persists", async ({ page }) => {
  await page.goto("/settings?tab=planning");

  const html = page.locator("html");
  await expect(html).toHaveClass(/dark/); // dark is the default

  // switch to light
  // the theme Select trigger shows the current value; open it and pick Light
  await page.locator('[data-slot="select-trigger"]').filter({ hasText: /Dark|Light|System/ }).first().click();
  await page.getByRole("option", { name: "Light" }).click();
  await expect(html).not.toHaveClass(/dark/);
  await expect(html).toHaveJSProperty("style.colorScheme", "light");

  // the pre-paint script keeps it light across a reload (no flash back to dark)
  await page.reload();
  await expect(html).not.toHaveClass(/dark/);

  // back to dark for the rest of the suite's assumptions
  await page.goto("/settings?tab=planning");
  await page.getByRole("combobox").filter({ hasText: /Dark|Light|System/ }).first().click();
  await page.getByRole("option", { name: "Dark" }).click();
  await expect(html).toHaveClass(/dark/);
});
