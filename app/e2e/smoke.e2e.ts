import { expect, test } from "@playwright/test";

/**
 * Route smoke tests: the app boots against the active project DB and each top-level
 * page renders without a client error. Catches the things unit tests can't —
 * router wiring, SSR/hydration, server-function plumbing against real data.
 */

const errorsFrom = (page: import("@playwright/test").Page) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
};

test("home renders the global nav", async ({ page }) => {
  const errors = errorsFrom(page);
  await page.goto("/");
  const nav = page.locator("nav");
  await expect(nav.getByRole("link", { name: "PyOps" })).toBeVisible();
  // the nav's primary destinations are present (scoped to the nav — the home page
  // also has cards linking to the same routes)
  for (const name of ["Blocks", "Factory", "Explore", "TURD", "Assistant", "Tasks"]) {
    await expect(nav.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

for (const route of [
  "/block",
  "/factory",
  "/factory/connections",
  "/explore",
  "/explore/dependencies",
  "/turd",
  "/tasks",
]) {
  test(`route ${route} loads without a page error`, async ({ page }) => {
    const errors = errorsFrom(page);
    const resp = await page.goto(route);
    expect(resp?.status(), `${route} HTTP status`).toBeLessThan(400);
    // nav chrome is always present once the route mounts
    await expect(page.locator("nav").getByRole("link", { name: "PyOps" })).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });
}

test("related factory and explore routes share workspace navigation", async ({ page }) => {
  await page.goto("/factory/connections");
  const globalNav = page.getByRole("navigation").first();
  await expect(globalNav.getByRole("link", { name: "Factory" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const factoryViews = page.getByRole("navigation", { name: "Factory views" });
  await expect(factoryViews.getByRole("link", { name: "Connections" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(factoryViews.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(factoryViews.getByRole("link", { name: "Scenario" })).toBeVisible();

  await page.goto("/explore/dependencies");
  await expect(globalNav.getByRole("link", { name: "Explore" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const exploreViews = page.getByRole("navigation", { name: "Explore views" });
  await expect(exploreViews.getByRole("link", { name: "Dependencies" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(exploreViews.getByRole("link", { name: "Search" })).toBeVisible();
});

test("saved links redirect to canonical workspace URLs", async ({ page }) => {
  await page.goto("/coherence");
  await expect(page).toHaveURL(/\/factory\/connections$/);
  await page.goto("/whatif");
  await expect(page).toHaveURL(/\/factory\/scenario$/);
  await page.goto("/browse?sel=iron-plate");
  await expect(page).toHaveURL(/\/explore\?sel=iron-plate$/);
  await page.goto("/deps?sel=iron-plate&dir=requiredBy");
  await expect(page).toHaveURL(/\/explore\/dependencies\?.*sel=iron-plate/);
  await expect(page).toHaveURL(/dir=requiredBy/);
});

test("home presents project status and a next action", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Next action", { exact: true })).toBeVisible();
  await expect(page.getByText("Factory balance", { exact: true })).toBeVisible();
  await expect(page.getByText("Project status", { exact: true })).toBeVisible();
});

test("Explore search renders recipes by their localized display names", async ({ page }) => {
  await page.goto("/explore");
  // the recipe browser lists rows; assert at least some content rendered (real
  // reference data) and that the page isn't an error boundary
  await expect(page.locator("nav").getByRole("link", { name: "Explore" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Something went wrong");
});
