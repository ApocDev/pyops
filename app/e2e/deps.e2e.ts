import { expect, test } from "@playwright/test";

/**
 * Dependency explorer (#100), read-only: pick a good, walk its requires tree,
 * flip to required-by, and filter the fetched nodes. Nothing here writes.
 */

const NONSENSE = "zzz-no-such-thing-e2e";

test("deps explorer walks requires / required-by for a good", async ({ page }) => {
  await page.goto("/deps");
  await expect(page.getByText("Nothing selected")).toBeVisible();

  // pick a root from the sidebar search (iron plate exists in vanilla and Py alike)
  const search = page.getByPlaceholder("search goods & recipes…");
  await search.fill("iron plate");
  const first = page.getByRole("button", { name: /iron plate/i }).first();
  try {
    await first.waitFor({ state: "visible", timeout: 5000 });
  } catch {
    test.skip(true, "no 'iron plate' in the active project DB");
  }
  await first.click();

  // requires view: root summary + the OR group label, then expand one producer
  await expect(page.getByText(/requires \d+ goods via \d+ recipes/)).toBeVisible();
  const tree = page.locator("div.bg-card").filter({ hasText: /made by any of \d+ recipe/ });
  await expect(tree).toBeVisible();
  await tree.getByRole("button").first().click();
  await expect(page.getByText(/needs all \d+ ingredient/).first()).toBeVisible();

  // flip direction — the URL carries it, the tree reloads as required-by
  await page.getByRole("button", { name: "Required by", exact: true }).click();
  await expect(page.getByText(/required by \d+ recipes touching \d+ goods/)).toBeVisible();
  await expect(page.getByText(/used by \d+ recipe/).first()).toBeVisible();

  // the in-tree filter uses the shared no-matches state and clears
  const filter = page.getByPlaceholder("filter tree…");
  await filter.fill(NONSENSE);
  await expect(page.getByText(`No matches for "${NONSENSE}"`)).toBeVisible();
  await page.getByRole("button", { name: "clear filter" }).click();
  await expect(filter).toHaveValue("");
  await expect(page.getByText(/used by \d+ recipe/).first()).toBeVisible();
});
