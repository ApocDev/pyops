import { expect, test, type Locator } from "@playwright/test";

/**
 * The factory Machines card on the shared sortable-table engine (#80):
 * click-to-sort headers (persisted in localStorage — read-only for the db),
 * a collapsible section, and machine groups whose nested per-recipe rows
 * travel with their machine when the sort changes.
 */

/** The Machines card (the goods sections share the same anatomy, so scope
 * every assertion to the card containing the "Machines (n)" title). */
const machinesCard = (page: import("@playwright/test").Page): Locator =>
  page.locator('[data-slot="card"]', { hasText: /^Machines \(\d+\)/ });

test("machines card sorts by column and collapses", async ({ page }) => {
  await page.goto("/factory");
  // hydration proof first (same as filter.e2e.ts), then wait for the queries
  // to settle: skeletons gone means the machines card is rendered — or absent
  // because the active project has no machine data at all
  const section = page.getByText(/^(Deficits|Surpluses|Balanced|Stock buffers)/).first();
  const noFlows = page.getByText("No flows yet");
  await expect(section.or(noFlows).first()).toBeVisible();
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
  const card = machinesCard(page);
  if ((await card.count()) === 0) {
    test.skip(true, "no machine data in the active project DB");
  }

  // the sortable header row (desktop viewport — the header is md+ only)
  const header = (label: string | RegExp) => card.getByRole("button", { name: label });
  await expect(header(/Machine · recipe/)).toBeVisible();
  await expect(header(/^Required/)).toBeVisible();

  const machineNames = async () => {
    const names = await card.getByTestId("machine-name").allInnerTexts();
    // strip the "(no recipe data)" note some rows append
    return names.map((n) => n.replace(/\s*\(no recipe data\)\s*/, "").trim());
  };

  // click the lead header → alphabetical ascending by display name
  // (numeric+case-insensitive collation ≈ TanStack's alphanumeric sort)
  await header(/Machine · recipe/).click();
  const asc = await machineNames();
  expect(asc.length).toBeGreaterThan(0);
  expect(asc).toEqual(
    [...asc].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })),
  );

  // click again → descending
  await header(/Machine · recipe/).click();
  const desc = await machineNames();
  expect(desc).toEqual([...asc].reverse());

  // the choice sticks across a reload (localStorage)
  await page.reload();
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
  expect(await machineNames()).toEqual(desc);

  // collapse folds the rows away; expand brings them back (the fold button's
  // accessible name is the card title, so target its title attribute)
  await card.locator('button[title="Collapse"]').click();
  await expect(card.getByTestId("machine-group")).toHaveCount(0);
  await card.locator('button[title="Expand"]').click();
  await expect(card.getByTestId("machine-group").first()).toBeVisible();
});
