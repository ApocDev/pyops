import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import {
  activeProjectDbFile,
  addGoal,
  createBlock,
  goto,
  uniqueName,
} from "./helpers";

/**
 * Inline building-count pin (#121): a recipe row's building count is click-to-
 * fix. Clicking it opens a number field; typing a count pins the row (supply-
 * push) and the number tints to show it's fixed — no separate badge. Clearing
 * the field unpins it.
 */
test("building count: click to fix, tint shows fixed, clear to unpin", async ({ page }) => {
  await createBlock(page);
  await addGoal(page, "iron plate", "Iron plate");
  await page.locator('button[aria-label^="Add a recipe that makes "]').click();
  const picker = page.getByRole("dialog", { name: /Recipes that make/ });
  await picker.getByRole("button", { name: /Iron plate/ }).first().click();
  await expect(picker).toBeHidden();

  // the row's building count is unpinned → click-to-fix
  const unpinned = page.locator('button[title="Click to fix the building count"]');
  await expect(unpinned).toBeVisible();

  // click → type 4 → the row is fixed at 4 (tinted, own tooltip; no =N badge)
  await unpinned.click();
  const field = page.locator('input[inputmode="decimal"]');
  await field.fill("4");
  await field.press("Enter");
  const fixed = page.locator('button[title^="Fixed at 4 building"]');
  await expect(fixed).toBeVisible();
  await expect(fixed).toContainText("4");
  // the old =N badge is gone
  await expect(page.getByText("=4")).toHaveCount(0);

  // clear the field → unpinned again
  await fixed.click();
  const field2 = page.locator('input[inputmode="decimal"]');
  await field2.fill("");
  await field2.press("Enter");
  await expect(page.locator('button[title="Click to fix the building count"]')).toBeVisible();
  await expect(page.locator('button[title^="Fixed at"]')).toHaveCount(0);
});

test("an infeasible block keeps its burner row editable", async ({ page }) => {
  const db = new DatabaseSync(activeProjectDbFile());
  db.exec("PRAGMA busy_timeout = 5000");
  const data = {
    recipes: ["boil-steam-250"],
    made: ["steam"],
    pins: [{ kind: "cap", recipe: "boil-steam-250", count: 0 }],
    machines: { "boil-steam-250": "boiler" },
    fuels: { "boil-steam-250": "coal" },
    goals: [{ name: "steam", rate: 1 }],
  };
  const inserted = db
    .prepare("INSERT INTO blocks (name, data) VALUES (?, ?)")
    .run(uniqueName("Recoverable boiler"), JSON.stringify(data));
  const id = Number(inserted.lastInsertRowid);
  db.close();

  try {
    await goto(page, `/block/${id}`);
    await expect(page.getByText(/Infeasible/).first()).toBeVisible();

    const row = page.locator('[data-recipe-row="boil-steam-250"]');
    await expect(row).toHaveClass(/bg-destructive\/10/);
    await expect(row.getByText("Solve failed", { exact: true })).toBeVisible();
    await expect(row.getByLabel("Change Boiler building")).toBeVisible();
    await expect(row.getByTitle(/Coal .* click to change fuel/)).toBeVisible();
    await expect(row.getByLabel(/^Water /)).toBeVisible();
    await expect(row.getByLabel(/^Steam /)).toBeVisible();

    await row.getByTitle(/Coal .* click to change fuel/).click();
    const fuels = page.getByRole("dialog", { name: "Fuel for Boil Steam (250°)" });
    await expect(fuels.getByRole("button", { name: /^Raw coal/ })).toBeVisible();
  } finally {
    const cleanup = new DatabaseSync(activeProjectDbFile());
    try {
      cleanup.exec("PRAGMA busy_timeout = 5000");
      cleanup.prepare("DELETE FROM blocks WHERE id = ?").run(id);
    } finally {
      cleanup.close();
    }
  }
});

test("favoriting a fuel keeps the burner rows on the current solve", async ({ page }) => {
  const db = new DatabaseSync(activeProjectDbFile());
  db.exec("PRAGMA busy_timeout = 5000");
  const favoriteFuels = db
    .prepare("SELECT value FROM meta WHERE key = 'favorite_fuels'")
    .get() as { value: string } | undefined;
  const data = {
    recipes: ["boil-steam-250"],
    made: ["steam"],
    machines: { "boil-steam-250": "boiler" },
    fuels: { "boil-steam-250": "coal" },
    goals: [{ name: "steam", rate: 1 }],
  };
  const inserted = db
    .prepare("INSERT INTO blocks (name, data) VALUES (?, ?)")
    .run(uniqueName("Favorite fuel"), JSON.stringify(data));
  const id = Number(inserted.lastInsertRowid);
  db.close();

  try {
    await goto(page, `/block/${id}`);
    const row = page.locator('[data-recipe-row="boil-steam-250"]');

    // Make a post-load editor change. The solve query's initial loader still
    // holds the original coal document, while the live saved solve now uses raw
    // coal — invalidating that query would put the row back on stale data.
    await row.getByTitle(/Coal .* click to change fuel/).click();
    let fuels = page.getByRole("dialog", { name: "Fuel for Boil Steam (250°)" });
    await fuels.getByRole("button", { name: /^Raw coal/ }).click();
    await expect(fuels).toBeHidden();
    await expect(row.getByTitle(/Raw coal .* click to change fuel/)).toBeVisible();

    await row.getByTitle(/Raw coal .* click to change fuel/).click();
    fuels = page.getByRole("dialog", { name: "Fuel for Boil Steam (250°)" });
    const rawCoal = fuels.getByRole("button", { name: /^Raw coal/ });
    const star = rawCoal.locator('[title*="favorite fuel" i]');
    const previousTitle = await star.getAttribute("title");
    await star.click();
    await expect(star).not.toHaveAttribute("title", previousTitle!);

    // Let any invalidated background query settle: the favorite is an app-level
    // default for future rows and must not replace this editor's live solve.
    await page.waitForTimeout(750);
    await expect(row.getByTitle(/Raw coal .* click to change fuel/)).toBeVisible();
  } finally {
    const cleanup = new DatabaseSync(activeProjectDbFile());
    try {
      cleanup.exec("PRAGMA busy_timeout = 5000");
      if (favoriteFuels)
        cleanup
          .prepare(
            `INSERT INTO meta (key, value) VALUES ('favorite_fuels', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          )
          .run(favoriteFuels.value);
      else cleanup.prepare("DELETE FROM meta WHERE key = 'favorite_fuels'").run();
      cleanup.prepare("DELETE FROM blocks WHERE id = ?").run(id);
    } finally {
      cleanup.close();
    }
  }
});

test("variable generator shows its average and min-max output", async ({ page }) => {
  const db = new DatabaseSync(activeProjectDbFile());
  db.exec("PRAGMA busy_timeout = 5000");
  const product = db
    .prepare(
      `SELECT amount, amount_min, amount_max FROM recipe_products
       WHERE recipe = 'generate-multiblade-turbine-mk01' AND name = 'pyops-electricity'`,
    )
    .get() as { amount: number; amount_min: number | null; amount_max: number | null };
  let id: number;
  try {
    db.prepare(
      `UPDATE recipe_products SET amount = 1.2, amount_min = 0.4, amount_max = 2
       WHERE recipe = 'generate-multiblade-turbine-mk01' AND name = 'pyops-electricity'`,
    ).run();
    const data = {
      recipes: [
        "generate-steam-engine-250",
        "boil-steam-250",
        "generate-multiblade-turbine-mk01",
      ],
      made: ["steam"],
      pins: [{ kind: "count", recipe: "generate-multiblade-turbine-mk01", count: 40 }],
      machines: {
        "generate-steam-engine-250": "steam-engine",
        "boil-steam-250": "boiler",
        "generate-multiblade-turbine-mk01": "multiblade-turbine-mk01",
      },
      fuels: { "boil-steam-250": "raw-coal" },
      goals: [{ name: "pyops-electricity", rate: 50 }],
    };
    const inserted = db
      .prepare("INSERT INTO blocks (name, data) VALUES (?, ?)")
      .run(uniqueName("Variable power"), JSON.stringify(data));
    id = Number(inserted.lastInsertRowid);
  } finally {
    db.close();
  }

  try {
    await goto(page, `/block/${id}`);
    const ignore = page.getByRole("button", { name: "Ignore for now" });
    if (await ignore.isVisible()) await ignore.click();
    await expect(page.locator('[data-rate-range="variable"]')).toHaveText(
      "48 MW avg · 16 MW–80 MW",
    );
  } finally {
    const cleanup = new DatabaseSync(activeProjectDbFile());
    try {
      cleanup.exec("PRAGMA busy_timeout = 5000");
      cleanup
        .prepare(
          `UPDATE recipe_products SET amount = ?, amount_min = ?, amount_max = ?
           WHERE recipe = 'generate-multiblade-turbine-mk01' AND name = 'pyops-electricity'`,
        )
        .run(product.amount, product.amount_min, product.amount_max);
      cleanup.prepare("DELETE FROM blocks WHERE id = ?").run(id);
    } finally {
      cleanup.close();
    }
  }
});

test("recipe picker groups unlocked choices and disables locked buildings", async ({ page }) => {
  await createBlock(page);
  await page.locator('button[title="Add a goal product"]').click();
  const goalDialog = page.getByRole("dialog", { name: "Add a goal product" });
  await goalDialog.getByPlaceholder("Search an item or fluid…").fill("pyops electricity");
  await goalDialog.getByRole("button", { name: "Electricity (MJ)", exact: true }).click();
  await expect(goalDialog).toBeHidden();
  await page.locator('button[aria-label^="Add a recipe that makes "]').click();

  const picker = page.getByRole("dialog", { name: "Recipes that make Electricity (MJ)" });
  const unlocked = picker.getByText("Unlocked now", { exact: true });
  const locked = picker.getByText("Locked or unavailable", { exact: true });
  await expect(unlocked).toBeVisible();
  await expect(locked).toBeVisible();
  expect((await unlocked.boundingBox())!.y).toBeLessThan((await locked.boundingBox())!.y);

  const steam = picker.getByRole("button", { name: /Steam engine power \(150°\)/ });
  await expect(steam).toHaveAttribute("aria-disabled", "false");
  await expect(steam).toContainText("Unlocked now · Steam engine");

  const solar = picker.getByRole("button", { name: /Solar panel power \(peak\)/ });
  await expect(solar).toHaveAttribute("aria-disabled", "true");
  await expect(solar).toContainText("Building locked · Solar panel · Needs Solar energy");
  await solar.click({ force: true });
  await expect(picker).toBeVisible();

  // Py's `-blank` runtime entity uses the same localized name and output. It is
  // an alternate state of this building, not a second recipe choice.
  await expect(
    picker.getByText('Multiblade "fish" turbine power (average)', { exact: true }),
  ).toHaveCount(1);
});
