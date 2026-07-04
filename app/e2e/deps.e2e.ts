import { expect, test } from "@playwright/test";

/**
 * Dependency explorer (#100), read-only: pick a good, walk its requires tree,
 * flip to required-by, and filter the fetched nodes. Nothing here writes.
 */

const NONSENSE = "zzz-no-such-thing-e2e";

test("deps explorer walks requires / required-by for a good", async ({ page }) => {
  await page.goto("/deps");
  await expect(page.getByText("Nothing selected")).toBeVisible();
  // wait for hydration before typing — a fill that lands on SSR'd markup is
  // wiped when React mounts, leaving the search silently empty
  await page.waitForFunction(() => {
    const nav = document.querySelector("nav");
    return !!nav && Object.keys(nav).some((k) => k.startsWith("__reactFiber$"));
  });

  // pick a root from the sidebar search (iron plate exists in vanilla and Py alike)
  const search = page.getByPlaceholder("search goods & recipes…");
  await search.fill("iron plate");
  // Scope the click to the SIDEBAR results. A page-wide button match is a
  // booby trap on the read-only suite: the nav's Undo button embeds the last
  // edited block's NAME in its accessible name ("Undo: Edit block \"Iron
  // plate\"") — a loose .first() can click a mutating control on the user's
  // real database. Never match buttons globally by data-derived names here.
  const sidebar = page.locator("aside");
  const first = sidebar.getByRole("button", { name: /iron plate/i }).first();
  try {
    await first.waitFor({ state: "visible", timeout: 15000 }); // first search builds the whole deps graph server-side
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
