import { expect, test } from "@playwright/test";
import { goto } from "./helpers";

test("manual mining productivity bonus persists and can be cleared", async ({ page }) => {
  await goto(page, "/settings");
  const now = page.getByRole("button", { name: "Now", exact: true });
  await now.click();
  await expect(now).toHaveAttribute("aria-pressed", "true");

  const mining = page.getByRole("spinbutton", { name: "mining productivity bonus percent" });
  await mining.fill("120");
  await mining.press("Enter");
  await expect(mining).toHaveValue("120");
  await expect(page.getByText(/mining \+120% · recipe bonuses/)).toBeVisible();

  await page.reload();
  await expect(mining).toHaveValue("120");
  await expect(page.getByText(/mining \+120% · recipe bonuses/)).toBeVisible();

  await mining.fill("");
  await mining.press("Enter");
  await expect(mining).toHaveValue("");

  await page.reload();
  await expect(mining).toHaveValue("");
});
