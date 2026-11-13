import { expect, test, type Locator, type Page } from "@playwright/test";
import { goto } from "./helpers";

/**
 * The recipe explorer (#97, #199): the browse detail pane ranks a good's
 * producing/consuming recipes, grouped by research-horizon availability.
 * Producers sit on a price ladder (¥ per unit, cheapest first, waste hatched);
 * recycling and void recipes hide behind a per-list toggle; the two lists sit
 * side by side on wide panes and become tabs on phones. Lives in the mutating
 * suite because the "compute now" affordance (a pre-#97 cost analysis lacks
 * the flow/waste scopes) writes the recompute into the project db.
 */

const NONSENSE = "zzz-no-such-thing-e2e";

const list = (page: Page, title: string) =>
  page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${title}$`) }) });

/** One availability group of a list (its header plus rows). */
const group = (card: Locator, label: string) =>
  card.locator(":scope > div").filter({ hasText: new RegExp(`^${label}`) });

/** Open iron plate's explorer, recomputing a stale cost analysis if needed. */
async function openIronPlate(page: Page) {
  await goto(page, "/explore?sel=iron-plate");
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
  if (!(await page.getByRole("heading", { name: "Iron plate" }).isVisible())) {
    test.skip(true, "no iron-plate in the active project DB");
  }
  // a cost analysis from before the flow/waste scopes offers a one-click
  // recompute — run it so the ranked annotations below are real
  const stale = page.getByText(/hasn't been computed/);
  if (await stale.isVisible()) {
    await page.getByRole("button", { name: "Compute now" }).click();
    await expect(stale).toBeHidden({ timeout: 200_000 });
  }
}

test("explorer ranks producers on a price ladder and filters both lists", async ({ page }) => {
  test.setTimeout(240_000); // may run a full cost-analysis LP over the project db
  await openIronPlate(page);
  const produced = list(page, "Produced by");
  const consumed = list(page, "Consumed by");

  // wide pane: the two lists sit side by side, no tabs
  await expect(page.getByRole("group", { name: "Recipe lists" })).toBeHidden();
  const [p, c] = [await produced.boundingBox(), await consumed.boundingBox()];
  expect(c!.x).toBeGreaterThan(p!.x + p!.width - 1);
  expect(Math.abs(c!.y - p!.y)).toBeLessThan(2);

  // producers: availability groups, ¥ per unit cheapest first inside a group
  await expect(produced.getByText("Available now")).toBeVisible();
  const ladders = group(produced, "Available now").getByTestId("price-ladder");
  await expect(ladders.first()).toBeVisible();
  const prices = (await ladders.allInnerTexts())
    .map((t) => /^¥([\d.]+)$/m.exec(t)?.[1])
    .filter((v): v is string => v != null)
    .map(Number);
  expect(prices.length).toBeGreaterThan(0);
  expect(prices).toEqual([...prices].sort((a, b) => a - b));

  // long lists stay capped behind the shared show-all affordance
  const consumers = Number(
    await consumed.locator('[data-slot="card-header"] > span').first().textContent(),
  );
  if (consumers > 25) {
    await expect(consumed.getByRole("button", { name: /^Show all \d+…$/ })).toBeVisible();
  }

  // the shared recipe filter (#87) narrows both lists and offers the standard
  // no-matches state per list
  const input = page.getByPlaceholder("Filter recipes…");
  await input.fill(NONSENSE);
  await expect(page.getByText(`No matches for "${NONSENSE}"`).first()).toBeVisible();
  await page.getByRole("button", { name: "Clear filter" }).first().click();
  await expect(input).toHaveValue("");
  await expect(page.getByText("Available now").first()).toBeVisible();
});

test("recycling & void recipes hide behind a list toggle", async ({ page }) => {
  test.setTimeout(240_000);
  await openIronPlate(page);
  const produced = list(page, "Produced by");
  const toggle = produced.getByRole("button", { name: /^Recycling & void \d+$/ });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const recycled = group(produced, "Recycling & void");
  await expect(recycled).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(recycled).toBeVisible();
  await expect(recycled.getByTestId("price-ladder").first()).toBeVisible();

  await toggle.click();
  await expect(recycled).toHaveCount(0);
});

test("on a phone the two lists become tabs", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openIronPlate(page);
  const tabs = page.getByRole("group", { name: "Recipe lists" });
  const producedTab = tabs.getByRole("button", { name: /^Produced by \d+$/ });
  const consumedTab = tabs.getByRole("button", { name: /^Consumed by \d+$/ });
  await expect(producedTab).toHaveAttribute("aria-pressed", "true");
  await expect(list(page, "Produced by")).toBeVisible();
  await expect(list(page, "Consumed by")).toBeHidden();

  await consumedTab.click();
  await expect(consumedTab).toHaveAttribute("aria-pressed", "true");
  await expect(list(page, "Consumed by")).toBeVisible();
  await expect(list(page, "Produced by")).toBeHidden();
});
