import type { SQLInputValue } from "node:sqlite";
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

type Row = Record<string, SQLInputValue>;
/** The fixture's own quality rows and `has_quality` key, put back after each
 * group of tests. The fixture copies the active project, which may or may not
 * have quality, so each group sets the chain it needs. */
let saved: { qualities: Row[]; hasQuality: string | null } | null = null;

/** Save the fixture's quality data, then give it vanilla's quality chain (as
 * a quality-mod dump would) or Py's normal-only chain. */
function setQualityChain(on: boolean) {
  withDb((db) => {
    saved = {
      qualities: db.prepare("SELECT * FROM qualities").all() as Row[],
      hasQuality:
        (db.prepare("SELECT value FROM meta WHERE key = 'has_quality'").get() as Row | undefined)
          ?.value?.toString() ?? null,
    };
    db.exec("DELETE FROM qualities WHERE name NOT IN ('normal', 'quality-unknown')");
    db.exec("DELETE FROM meta WHERE key = 'has_quality'");
    const upsert = db.prepare(
      "INSERT OR REPLACE INTO qualities (name, display, level, next, next_probability, chain_probability) VALUES (?, ?, ?, ?, ?, ?)",
    );
    if (!on) return upsert.run("normal", "Normal", 0, null, 0, 0);
    upsert.run("normal", "Normal", 0, "uncommon", 0.1, 0.1);
    for (const t of TIERS) upsert.run(t.name, t.display, t.level, t.next, t.next ? 0.1 : 0, 0.1);
    db.exec("INSERT INTO meta (key, value) VALUES ('has_quality', '1')");
  });
}

function restoreQualityChain() {
  if (!saved) return;
  const { qualities, hasQuality } = saved;
  withDb((db) => {
    db.exec("DELETE FROM qualities");
    for (const row of qualities) {
      const cols = Object.keys(row);
      db.prepare(
        `INSERT INTO qualities (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      ).run(...cols.map((c) => row[c]));
    }
    if (hasQuality == null) db.exec("DELETE FROM meta WHERE key = 'has_quality'");
    else
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('has_quality', ?)").run(
        hasQuality,
      );
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

test.describe("without a quality chain", () => {
  test.beforeAll(() => setQualityChain(false));
  test.afterAll(restoreQualityChain);

  test("a project without quality shows no quality controls", async ({ page }) => {
  const id = insertBlock(uniqueName("No quality"), {
    goals: [{ name: RECIPE, rate: 1 }],
    recipes: [RECIPE],
  });
  await goto(page, `/block/${id}`);
  await openRowMenu(page);
  await expect(page.getByText("Quality…")).toHaveCount(0);
  });
});

test.describe("with a quality chain", () => {
  test.beforeAll(() => setQualityChain(true));
  test.afterAll(restoreQualityChain);

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
