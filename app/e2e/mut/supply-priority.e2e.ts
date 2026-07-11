import { expect, test } from "@playwright/test";
import { goto } from "./helpers";

test("block supply priority can be changed and persists", async ({ page }) => {
  await goto(page, "/block");

  const block = page
    .getByRole("complementary")
    .getByRole("button", { name: "Transport belt", exact: true });
  await expect(block).toBeVisible();
  await block.click();

  const priority = page.getByRole("button", { name: /Block supply priority:/ });
  await expect(priority).toBeVisible();
  const original = (await priority.getAttribute("aria-label"))?.replace("Block supply priority: ", "");
  expect(original).toMatch(/Preferred|Normal|Fallback/);
  const next = original === "Preferred" ? "Fallback" : "Preferred";

  await priority.click();
  await page.getByRole("menuitem", { name: next }).click();
  await expect(priority).toHaveAccessibleName(`Block supply priority: ${next}`);

  // Block edits auto-save. Reloading proves the setting survived the server round trip.
  await page.waitForTimeout(1_000);
  await page.reload();
  await expect(page.getByRole("button", { name: `Block supply priority: ${next}` })).toBeVisible();

  // Restore the scratch project for subsequent mutating specs.
  await page.getByRole("button", { name: `Block supply priority: ${next}` }).click();
  await page.getByRole("menuitem", { name: original! }).click();
});
