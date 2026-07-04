import { expect, test, type Page } from "@playwright/test";

/**
 * In-app help drawers (#16), read-only: every planning page renders a `?`
 * HelpButton that opens a docs drawer. This covers the newly-added Assistant
 * drawer (the page that previously had none) plus a spot-check that an enriched
 * drawer opens with its worked example. Opening a drawer writes nothing.
 */

/** Open the page's `?` help drawer. Retries the click until the dialog is up —
 * on an SSR'd header the button paints before hydration wires its handler, so a
 * single early click can no-op. */
async function openHelp(page: Page) {
  const help = page.getByRole("button", { name: "What is this?" });
  await help.waitFor({ state: "visible", timeout: 10000 });
  const dialog = page.getByRole("dialog");
  await expect(async () => {
    await help.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  return dialog;
}

test("assistant page has a help drawer explaining what it does", async ({ page }) => {
  await page.goto("/assistant");
  const drawer = await openHelp(page);
  await expect(drawer.getByRole("heading", { name: "What is the Assistant?" })).toBeVisible();
  // the propose-then-apply model and backtick chips are the load-bearing claims
  await expect(drawer.getByText("Propose, then apply")).toBeVisible();
  await expect(drawer.getByText("Draft a block", { exact: false }).first()).toBeVisible();
});

test("coherence help drawer opens with its worked example", async ({ page }) => {
  await page.goto("/coherence");
  const drawer = await openHelp(page);
  await expect(drawer.getByRole("heading", { name: "What is Coherence?" })).toBeVisible();
  await expect(drawer.getByText("Worked example — scale stone")).toBeVisible();
});
