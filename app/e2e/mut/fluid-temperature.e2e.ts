import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, goto, uniqueName } from "./helpers";

/** A recipe whose steam ingredient has no explicit prototype range shows its
 * effective ≥default range. The player can bind that one row to a real produced
 * temperature, and the exact choice survives the persisted document. */
test("pin a fluid ingredient to an exact produced temperature", async ({ page }) => {
  const db = new DatabaseSync(activeProjectDbFile());
  const name = uniqueName("Tin temperature");
  const defaultName = uniqueName("Favorite steam temperature");
  const wideName = uniqueName("Wide steam temperature");
  const previousFavorite = db
    .prepare("SELECT value FROM meta WHERE key = 'favorite_fluid_temperatures'")
    .get() as { value: string } | undefined;
  const previousResearchMode = db
    .prepare("SELECT value FROM meta WHERE key = 'research_mode'")
    .get() as { value: string } | undefined;
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('research_mode', 'future') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run();
  const inserted = db
    .prepare("INSERT INTO blocks (name, data) VALUES (?, ?)")
    .run(
      name,
      JSON.stringify({
        goals: [{ name: "ore-tin", rate: 1 }],
        recipes: ["mining-tin"],
      }),
    );
  const id = Number(inserted.lastInsertRowid);
  const defaultInserted = db
    .prepare("INSERT INTO blocks (name, data) VALUES (?, ?)")
    .run(
      defaultName,
      JSON.stringify({
        goals: [{ name: "ore-tin", rate: 1 }],
        recipes: [],
      }),
    );
  const defaultId = Number(defaultInserted.lastInsertRowid);
  const wideInserted = db
    .prepare("INSERT INTO blocks (name, data) VALUES (?, ?)")
    .run(
      wideName,
      JSON.stringify({
        goals: [{ name: "ore-tin", rate: 1 }],
        recipes: ["mining-tin"],
      }),
    );
  const wideId = Number(wideInserted.lastInsertRowid);
  db.close();

  try {
    await goto(page, `/block/${id}`);
    const picker = page.locator('[data-fluid-temperature="mining-tin:steam"]');
    await expect(picker).toHaveText("≥15°");

    await picker.click();
    await page.getByRole("menuitem").filter({ hasText: "250°" }).click();
    await expect(picker).toHaveText("250°");

    await picker.click();
    const setFavorite = page.getByRole("button", {
      name: "Set 250° as favorite for Steam",
      exact: true,
    });
    const clearFavorite = page.getByRole("button", {
      name: "Clear 250° as favorite for Steam",
      exact: true,
    });
    if (await setFavorite.isVisible()) await setFavorite.click();
    else await expect(clearFavorite).toBeVisible();
    await page.keyboard.press("Escape");
    await expect
      .poll(() => {
        const favoritesDb = new DatabaseSync(activeProjectDbFile(), { readOnly: true });
        const meta = favoritesDb
          .prepare("SELECT value FROM meta WHERE key = 'favorite_fluid_temperatures'")
          .get() as { value: string } | undefined;
        favoritesDb.close();
        return meta ? JSON.parse(meta.value).steam : null;
      })
      .toBe(250);

    await page.waitForTimeout(1200);
    await page.reload();
    await expect(picker).toHaveText("250°");

    await goto(page, "/factory");
    await expect(
      page.getByRole("button").filter({ hasText: "Steam 250°" }).first(),
    ).toBeVisible();

    await goto(page, `/block/${defaultId}`);
    await page.getByRole("button", { name: /Add a recipe that makes Tin ore/ }).click();
    const recipeRow = page.locator('[data-recipe-row="mining-tin"]');
    const candidate = page.locator('[data-recipe-candidate="mining-tin"]');
    await expect(recipeRow.or(candidate)).toBeVisible();
    if (await candidate.isVisible()) await candidate.click();
    await expect(recipeRow.locator('[data-fluid-temperature="mining-tin:steam"]')).toHaveText(
      "250°",
    );

    await page.getByTitle("Add a goal product", { exact: true }).click();
    await page.getByPlaceholder("Search an item or fluid…").fill("Steam");
    await page.getByTitle("Steam", { exact: true }).click();
    const goalTemperature = page.locator('[data-goal-temperature="steam"]');
    await expect(goalTemperature).toHaveText("250°");

    await goto(page, `/block/${wideId}`);
    const widePicker = page.locator('[data-fluid-temperature="mining-tin:steam"]');
    await expect(widePicker).toHaveText("≥15°");
    await widePicker.click();
    await page.getByRole("menuitem").filter({ hasText: "Recipe range" }).click();
    await page.waitForTimeout(1200);

    await goto(page, "/factory");
    await page.getByRole("button").filter({ hasText: "Steam 250°" }).first().click();
    const exactDrawer = page.getByRole("dialog");
    await expect(exactDrawer).toContainText(name);
    await expect(exactDrawer).not.toContainText(wideName);
    await exactDrawer.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button").filter({ hasText: "Steam ≥15°" }).first().click();
    const rangeDrawer = page.getByRole("dialog");
    await expect(rangeDrawer).toContainText(wideName);
    await expect(rangeDrawer).not.toContainText(name);
    await rangeDrawer.getByRole("button", { name: "Close" }).click();

    await page.waitForTimeout(1200);
    const defaultSaved = new DatabaseSync(activeProjectDbFile(), { readOnly: true });
    const defaultRow = defaultSaved.prepare("SELECT data FROM blocks WHERE id = ?").get(defaultId) as {
      data: string;
    };
    defaultSaved.close();
    expect(JSON.parse(defaultRow.data).fluidTemperatures).toEqual({
      "mining-tin": { steam: 250 },
    });
    expect(JSON.parse(defaultRow.data).goals).toContainEqual({
      name: "steam",
      rate: 1,
      temperature: 250,
    });

    const saved = new DatabaseSync(activeProjectDbFile(), { readOnly: true });
    const row = saved.prepare("SELECT data FROM blocks WHERE id = ?").get(id) as { data: string };
    saved.close();
    expect(JSON.parse(row.data).fluidTemperatures).toEqual({ "mining-tin": { steam: 250 } });
  } finally {
    const cleanup = new DatabaseSync(activeProjectDbFile());
    cleanup.prepare("DELETE FROM block_flows WHERE block_id = ?").run(id);
    cleanup.prepare("DELETE FROM block_flows WHERE block_id = ?").run(defaultId);
    cleanup.prepare("DELETE FROM block_flows WHERE block_id = ?").run(wideId);
    cleanup.prepare("DELETE FROM block_machines WHERE block_id = ?").run(id);
    cleanup.prepare("DELETE FROM block_machines WHERE block_id = ?").run(defaultId);
    cleanup.prepare("DELETE FROM block_machines WHERE block_id = ?").run(wideId);
    cleanup.prepare("DELETE FROM blocks WHERE id = ?").run(id);
    cleanup.prepare("DELETE FROM blocks WHERE id = ?").run(defaultId);
    cleanup.prepare("DELETE FROM blocks WHERE id = ?").run(wideId);
    if (previousFavorite) {
      cleanup
        .prepare(
          "INSERT INTO meta (key, value) VALUES ('favorite_fluid_temperatures', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(previousFavorite.value);
    } else {
      cleanup.prepare("DELETE FROM meta WHERE key = 'favorite_fluid_temperatures'").run();
    }
    if (previousResearchMode) {
      cleanup
        .prepare(
          "INSERT INTO meta (key, value) VALUES ('research_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(previousResearchMode.value);
    } else {
      cleanup.prepare("DELETE FROM meta WHERE key = 'research_mode'").run();
    }
    cleanup.close();
  }
});

test("omit temperature controls for a fluid with no variants", async ({ page }) => {
  const db = new DatabaseSync(activeProjectDbFile());
  const name = uniqueName("Single temperature fluid");
  const inserted = db
    .prepare("INSERT INTO blocks (name, data) VALUES (?, ?)")
    .run(
      name,
      JSON.stringify({
        goals: [{ name: "bedding", rate: 1 }],
        recipes: ["bedding-improve"],
      }),
    );
  const id = Number(inserted.lastInsertRowid);
  db.close();

  try {
    await goto(page, `/block/${id}`);
    const formicAcid = page.getByRole("button", { name: /Formic acid .*Craftable/ });

    await expect(formicAcid.first()).toBeVisible();
    const count = await formicAcid.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index++) {
      await expect(formicAcid.nth(index)).not.toContainText("°");
    }
  } finally {
    const cleanup = new DatabaseSync(activeProjectDbFile());
    cleanup.prepare("DELETE FROM block_flows WHERE block_id = ?").run(id);
    cleanup.prepare("DELETE FROM block_machines WHERE block_id = ?").run(id);
    cleanup.prepare("DELETE FROM blocks WHERE id = ?").run(id);
    cleanup.close();
  }
});

test("show the default temperature of a temperature-sensitive fluid product", async ({ page }) => {
  const db = new DatabaseSync(activeProjectDbFile());
  const name = uniqueName("Offshore water temperature");
  const inserted = db
    .prepare("INSERT INTO blocks (name, data) VALUES (?, ?)")
    .run(
      name,
      JSON.stringify({
        goals: [{ name: "water", rate: 100 }],
        recipes: ["pump-offshore-pump"],
      }),
    );
  const id = Number(inserted.lastInsertRowid);
  db.close();

  try {
    await goto(page, `/block/${id}`);
    const product = page
      .locator('[data-recipe-row="pump-offshore-pump"]')
      .getByRole("button", { name: /Water .*Target/ });

    await expect(product).toBeVisible();
    await expect(product).toContainText("15°");
  } finally {
    const cleanup = new DatabaseSync(activeProjectDbFile());
    cleanup.prepare("DELETE FROM block_flows WHERE block_id = ?").run(id);
    cleanup.prepare("DELETE FROM block_machines WHERE block_id = ?").run(id);
    cleanup.prepare("DELETE FROM blocks WHERE id = ?").run(id);
    cleanup.close();
  }
});
