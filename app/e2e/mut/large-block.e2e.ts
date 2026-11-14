import { expect, test, type Page } from "@playwright/test";
import { goalRateButton, goto, insertBlock, uniqueName, withDb } from "./helpers";

/**
 * Large blocks render lazily (#154): when the goals push the recipe grid far
 * below the fold, its rows mount only as the grid nears the viewport, and a
 * focus request from the flow view mounts them and brings its row into view
 * (#276).
 */

/** A mall-shaped block: one goal per recipe, enough goals to push the grid
 * well past the mount distance below a 900px viewport. Single-product item
 * recipes that never feed each other, so every row sizes from its own goal
 * and the block always solves. */
function insertLargeBlock() {
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
  return { id, picks };
}

/** Distinct keys the dev build's render tally saw since the last reset, by
 * prefix (`goal`, `row`, `import`, `export`; see app/src/lib/render-count.ts). */
async function renderedKeys(page: Page) {
  const keys = await page.evaluate(() =>
    Object.keys((window as { __pyopsRenders?: Record<string, number> }).__pyopsRenders ?? {}),
  );
  return (prefix: string) => keys.filter((k) => k.startsWith(`${prefix}:`)).length;
}

test("a large block mounts its rows near the viewport and focuses a far row", async ({ page }) => {
  const { id, picks } = insertLargeBlock();
  const rows = page.locator("[data-recipe-row]");

  await goto(page, `/block/${id}`);
  const header = page.getByText(`Recipe (${picks.length})`);
  // The first solve fills the balance card, which pushes the grid more than a
  // screen further down, so a scroll aimed before it lands would fall short.
  await expect(page.getByText("Solved", { exact: true })).toBeVisible();
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

/** The server function a request calls: dev builds name it in the URL
 * (`/_serverFn/<base64url JSON of {file, export}>`). */
function serverFnName(url: URL) {
  const id = url.pathname.split("/_serverFn/")[1];
  if (!id) return "";
  const { export: name } = JSON.parse(Buffer.from(id, "base64url").toString()) as {
    export: string;
  };
  return name;
}

test("reaching the grid before the first solve lands mounts the rows", async ({ page }) => {
  const { id, picks } = insertLargeBlock();
  const rows = page.locator("[data-recipe-row]");
  // hold the block's first solve until the grid has been reached
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => serverFnName(url).startsWith("solveBlockFn_"),
    async (route) => {
      await held;
      await route.continue();
    },
  );

  await goto(page, `/block/${id}`);
  const header = page.getByText(`Recipe (${picks.length})`);
  await expect(header).toBeAttached();
  await expect(rows).toHaveCount(0);
  await header.scrollIntoViewIfNeeded();
  await expect(rows).toHaveCount(picks.length);
  await expect(page.getByText("Solved", { exact: true })).toBeHidden();

  // the solve landing keeps them mounted
  release();
  await expect(page.getByText("Solved", { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(picks.length);
});

test("the browser find shortcut mounts a large block's rows so find can match them", async ({
  page,
}) => {
  const { id, picks } = insertLargeBlock();
  const rows = page.locator("[data-recipe-row]");
  await goto(page, `/block/${id}`);
  await expect(page.getByText("Solved", { exact: true })).toBeVisible();
  // window.find (non-standard, so untyped) runs the browser's find-in-page
  // search: (text, caseSensitive, backwards, wrapAround)
  type Find = (
    text: string,
    caseSensitive: boolean,
    backwards: boolean,
    wrapAround: boolean,
  ) => boolean;
  const last = picks.at(-1)!.display;
  const find = () =>
    page.evaluate((text) => (window as { find?: Find }).find!(text, false, false, true), last);
  await expect(rows).toHaveCount(0);
  expect(await find()).toBe(false);

  await page.keyboard.press("ControlOrMeta+f");
  await expect(rows).toHaveCount(picks.length);
  expect(await find()).toBe(true);
});

/** Edit the nth goal's rate and wait until the save (which returns the new
 * solve the editor applies) lands on the undo stack. */
async function editGoalRate(page: Page, n: number, value: string) {
  const label = await page
    .locator("[data-goal]")
    .nth(n)
    .getByRole("button", { name: /^Add a recipe that makes / })
    .getAttribute("aria-label");
  const display = label!.replace("Add a recipe that makes ", "");
  await goalRateButton(page).nth(n).click();
  const input = page.locator("input:focus");
  await input.fill(value);
  await input.press("Enter");
  await expect(
    page.locator("nav").getByRole("button", { name: `Undo: Set "${display}" rate` }),
  ).toBeVisible({ timeout: 15_000 });
}

test("a goal edit re-renders only what it changed, not every tile, row and chip", async ({
  page,
}) => {
  const { id, picks } = insertLargeBlock();
  await goto(page, `/block/${id}`);
  await expect(page.getByText("Solved", { exact: true })).toBeVisible();
  await page.getByText(`Recipe (${picks.length})`).scrollIntoViewIfNeeded();
  await expect(page.locator("[data-recipe-row]")).toHaveCount(picks.length);
  // a first edit lets the page's remaining first-load queries settle
  await editGoalRate(page, 9, "0.02");

  await page.evaluate(() => {
    (window as { __pyopsRenders?: Record<string, number> }).__pyopsRenders = {};
  });
  await editGoalRate(page, 10, "0.02");

  // The edited goal's tile and recipe row, plus the boundary chips its recipe
  // touches (about 1 tile, 2 rows, 3 chips). Rendering everything again would
  // be 80 tiles, 80 rows, and about 180 chips.
  const count = await renderedKeys(page);
  expect(count("goal")).toBeGreaterThan(0); // the tally is live
  expect(count("goal")).toBeLessThanOrEqual(5);
  expect(count("row")).toBeLessThanOrEqual(5);
  expect(count("import") + count("export")).toBeLessThanOrEqual(12);
});
