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
  await expect(dialog.locator("span[style*='background-image']").first()).toBeVisible({
    timeout: 30_000,
  });

  // producers sit on the price ladder, cheapest ¥ per unit first
  const produced = dialog
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]', { hasText: /^Produced by$/ }) });
  const group = (label: string) =>
    produced.locator(":scope > div").filter({ hasText: new RegExp(`^${label}`) });
  const ladders = group("Available now").getByTestId("price-ladder");
  await expect(ladders.first()).toBeVisible();
  const prices = (await ladders.allInnerTexts())
    .map((t) => /^¥([\d.]+)$/m.exec(t)?.[1])
    .filter((v): v is string => v != null)
    .map(Number);
  expect(prices.length).toBeGreaterThan(0);
  expect(prices).toEqual([...prices].sort((a, b) => a - b));

  // recycling & void recipes stay hidden until the list's toggle shows them
  const toggle = produced.getByRole("button", { name: /^Recycling & void \d+$/ });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(group("Recycling & void")).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(group("Recycling & void").getByTestId("price-ladder").first()).toBeVisible();
  await toggle.click();
  await expect(group("Recycling & void")).toHaveCount(0);

  await expect(page).toHaveURL(/\/explore$/);
});
