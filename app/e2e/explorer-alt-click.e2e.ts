import { expect, test } from "@playwright/test";

test("Alt+Click opens a focused recipe explorer without navigating away", async ({ page }) => {
  test.setTimeout(60_000); // first icon-atlas load can be slow on a cold dev server

  await page.goto("/explore");
  await page.waitForFunction(
    () => {
      const nav = document.querySelector("nav");
      return !!nav && Object.keys(nav).some((key) => key.startsWith("__reactFiber$"));
    },
    { timeout: 30_000 },
  );
  await page.getByPlaceholder("Search items & fluids…").fill("iron plate");
  const result = page.getByRole("button", { name: "Iron plate", exact: true }).first();
  await result.locator("[data-good-name='iron-plate']").click({ modifiers: ["Alt"] });

  const dialog = page.getByRole("dialog", { name: "Recipe explorer" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Recipes \(\d+\)$/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(dialog.locator("span[style*='background-image']").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(dialog.getByText("Recipe", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Inputs", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText("Outputs", { exact: true }).first()).toBeVisible();
  await dialog.getByRole("button", { name: /^Uses \(\d+\)$/ }).click();
  await expect(dialog.getByText(/^Uses \(\d+\)$/).last()).toBeVisible();
  await expect(page).toHaveURL(/\/explore$/);
});
