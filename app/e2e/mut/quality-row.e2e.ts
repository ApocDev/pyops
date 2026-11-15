import { expect, type Page, test } from "@playwright/test";
import { goto, insertBlock, uniqueName, withDb } from "./helpers";

/**
 * Row quality (#267): when the project's data has a quality chain, a recipe
 * row's menu offers "Quality…". Its editor sets the qualities the row runs at,
 * the row then shows its range pill, and the setting is saved. A project
 * without quality (the Py fixture as seeded) shows none of it.
 */

const RECIPE = "iron-gear-wheel";
const TIERS = [
  { name: "uncommon", display: "Uncommon", level: 1, next: "rare" },
  { name: "rare", display: "Rare", level: 2, next: "epic" },
  { name: "epic", display: "Epic", level: 3, next: "legendary" },
  { name: "legendary", display: "Legendary", level: 5, next: null },
];

/** Give the fixture vanilla's quality chain, as a quality-mod dump would. */
function seedQualityChain() {
  withDb((db) => {
    db.exec(
      "UPDATE qualities SET display = 'Normal', next = 'uncommon', next_probability = 0.1 WHERE name = 'normal'",
    );
    const insert = db.prepare(
      "INSERT INTO qualities (name, display, level, next, next_probability, chain_probability) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const t of TIERS) insert.run(t.name, t.display, t.level, t.next, t.next ? 0.1 : 0, 0.1);
    db.exec("INSERT INTO meta (key, value) VALUES ('has_quality', '1')");
  });
}

function clearQualityChain() {
  withDb((db) => {
    db.exec("DELETE FROM qualities WHERE name IN ('uncommon', 'rare', 'epic', 'legendary')");
    db.exec(
      "UPDATE qualities SET display = NULL, next = NULL, next_probability = 0 WHERE name = 'normal'",
    );
    db.exec("DELETE FROM meta WHERE key = 'has_quality'");
  });
}

function savedRowQuality(id: number): unknown {
  return withDb((db) => {
    const row = db.prepare("SELECT data FROM blocks WHERE id = ?").get(id) as { data: string };
    return JSON.parse(row.data).rowQuality ?? null;
  });
}

async function openRowMenu(page: Page) {
  await page.locator(`[data-recipe-row-icon="${RECIPE}"]`).click({ button: "right" });
  await expect(page.getByText("Pins — count / cap / route…")).toBeVisible();
}

test("a project without quality shows no quality controls", async ({ page }) => {
  const id = insertBlock(uniqueName("No quality"), {
    goals: [{ name: RECIPE, rate: 1 }],
    recipes: [RECIPE],
  });
  await goto(page, `/block/${id}`);
  await openRowMenu(page);
  await expect(page.getByText("Quality…")).toHaveCount(0);
});

test.describe("with a quality chain", () => {
  test.beforeAll(seedQualityChain);
  test.afterAll(clearQualityChain);

  test("set a row's quality range from its menu, and it is saved", async ({ page }) => {
    const id = insertBlock(uniqueName("Quality row"), {
      goals: [{ name: RECIPE, rate: 1 }],
      recipes: [RECIPE],
    });
    await goto(page, `/block/${id}`);
    await openRowMenu(page);
    await page.getByText("Quality…").click();

    const dialog = page.getByRole("dialog", { name: /Quality — Iron gear wheel/ });
    await dialog.getByRole("group", { name: "Highest" }).getByRole("button", { name: "Epic" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();

    const pill = page.getByRole("button", { name: "Runs at Normal to Epic. Edit quality" });
    await expect(pill).toBeVisible();
    await expect.poll(() => savedRowQuality(id)).toEqual({ [RECIPE]: { max: "epic" } });

    await page.reload();
    await expect(pill).toBeVisible();
  });
});
