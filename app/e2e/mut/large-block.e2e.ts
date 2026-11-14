import { expect, test } from "@playwright/test";
import { goto, insertBlock, uniqueName, withDb } from "./helpers";

/**
 * Large blocks render lazily (#154): when the goals push the recipe grid far
 * below the fold, its rows mount only as the grid nears the viewport, and a
 * focus request from the flow view mounts them and brings its row into view
 * (#276).
 */
test("a large block mounts its rows near the viewport and focuses a far row", async ({ page }) => {
  // A mall-shaped block: one goal per recipe, enough goals to push the grid
  // well past the mount distance below a 900px viewport. Single-product item
  // recipes that never feed each other, so every row sizes from its own goal
  // and the block always solves.
  const candidates = withDb(
    (db) =>
      db
        .prepare(
          `SELECT r.name, r.main_product AS product, r.display,
             (SELECT group_concat(name, ',') FROM recipe_ingredients WHERE recipe = r.name) AS ins
           FROM recipes r JOIN items i ON i.name = r.main_product
           WHERE r.kind = 'real' AND r.hidden = 0 AND r.display IS NOT NULL
             AND (SELECT count(*) FROM recipe_products WHERE recipe = r.name) = 1
           ORDER BY r.name`,
        )
        .all() as { name: string; product: string; display: string; ins: string | null }[],
    { readOnly: true },
  );
  const picks: typeof candidates = [];
  const products = new Set<string>();
  const ingredients = new Set<string>();
  for (const c of candidates) {
    const ins = c.ins?.split(",") ?? [];
    if (products.has(c.product) || ingredients.has(c.product)) continue;
    if (ins.some((n) => products.has(n))) continue;
    picks.push(c);
    products.add(c.product);
    for (const n of ins) ingredients.add(n);
    if (picks.length === 80) break;
  }
  const id = insertBlock(uniqueName("Large block"), {
    goals: picks.map((p) => ({ name: p.product, rate: 0.01 })),
    recipes: picks.map((p) => p.name),
  });
  const rows = page.locator("[data-recipe-row]");

  await goto(page, `/block/${id}`);
  const header = page.getByText(`Recipe (${picks.length})`);
  await expect(header).toBeAttached();
  await expect(rows).toHaveCount(0);

  // scrolling toward the grid mounts every row
  await header.scrollIntoViewIfNeeded();
  await expect(rows).toHaveCount(picks.length);

  // On a fresh load (rows never mounted), the flow node for the last row
  // switches back to the table, mounts the rows and scrolls that row into
  // view, even as rows above it grow during the scroll.
  await goto(page, `/block/${id}`);
  await page.getByRole("button", { name: "Flow", exact: true }).click();
  const target = picks.at(-1)!;
  await page.locator(`button[title="${target.display} — click to open in the table"]`).click();
  const row = page.locator(`[data-recipe-row="${target.name}"]`);
  await expect(row).toHaveClass(/ring-primary/);
  await expect(row).toBeInViewport();
});
