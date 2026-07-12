import { expect, test } from "@playwright/test";

/**
 * The shared filtered-list primitive (#87): every filterable page uses the same
 * search box (`FilterInput`) and the same "no matches for X" empty state with a
 * clear-filter action (`FilterEmptyState`). Read-only — typing in a filter box
 * writes nothing.
 */

const NONSENSE = "zzz-no-such-thing-e2e";

test("Explore search shows the shared no-matches state and clears", async ({ page }) => {
  await page.goto("/explore");
  // the stats line renders from a client query — once it's there, React has
  // hydrated and the controlled input actually receives the fill
  await expect(page.getByText(/recipes · /)).toBeVisible();
  const input = page.getByPlaceholder("search items & fluids…");
  await input.fill(NONSENSE);
  await expect(page.getByText(`No matches for "${NONSENSE}"`)).toBeVisible();
  await page.getByRole("button", { name: "clear filter" }).click();
  await expect(input).toHaveValue("");
  await expect(page.getByText("type to search", { exact: false })).toBeVisible();
});

test("turd filter offers clear-filter on no matches", async ({ page }) => {
  await page.goto("/turd");
  // wait for the upgrade list to finish loading (skeletons gone), then skip
  // when the active project has no TURD data at all
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
  if (await page.getByText("No TURD upgrades in this dataset").isVisible()) {
    test.skip(true, "no TURD data in the active project DB");
  }

  const input = page.getByPlaceholder("filter upgrades…");
  await input.fill(NONSENSE);
  await expect(page.getByText(`No matches for "${NONSENSE}"`)).toBeVisible();
  await page.getByRole("button", { name: "clear filter" }).click();
  await expect(input).toHaveValue("");
  await expect(page.getByText(`No matches for "${NONSENSE}"`)).toBeHidden();
});

test("factory filter shows the shared no-matches state", async ({ page }) => {
  await page.goto("/factory");
  // wait until the flows either rendered (some goods section) or came up empty
  const section = page.getByText(/^(Deficits|Surpluses|Balanced|Stock buffers)/).first();
  const noFlows = page.getByText("No flows yet");
  await expect(section.or(noFlows).first()).toBeVisible();
  if (await noFlows.isVisible()) test.skip(true, "no factory flows in the active project DB");

  const input = page.getByPlaceholder("filter items…");
  await input.fill(NONSENSE);
  await expect(page.getByText(`No matches for "${NONSENSE}"`)).toBeVisible();
  // the input's inline ✕ clears too (distinct from the empty state's button)
  await page.getByRole("button", { name: "clear", exact: true }).click();
  await expect(input).toHaveValue("");
});
