import { DatabaseSync } from "node:sqlite";
import { expect, type Page, test } from "@playwright/test";
import { activeProjectDbFile, expectUndoTop, goto, toast, uniqueName } from "./helpers";

async function dismissDataDriftPrompt(page: Page) {
  const ignore = page.getByRole("button", { name: "Ignore for now" });
  try {
    await expect(ignore).toBeVisible({ timeout: 2_000 });
    await ignore.click();
  } catch {
    // Most runs have no reference-data drift prompt.
  }
}

test("goals copy between blocks without replacing existing goals or recipes", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const sourceData = {
    goals: [
      { name: "iron-plate", rate: 2, unit: "min" },
      { name: "copper-plate", rate: 20 / 3600, stock: 20, window: 3600 },
    ],
    recipes: ["iron-plate"],
  };
  const destinationData = {
    goals: [
      { name: "stone-brick", rate: 1 },
      { name: "iron-plate", rate: 99 },
    ],
    recipes: [],
  };
  const db = new DatabaseSync(activeProjectDbFile());
  let sourceId: number;
  let destinationId: number;
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const insert = db.prepare("INSERT INTO blocks (name, data) VALUES (?, ?)");
    sourceId = Number(
      insert.run(uniqueName("Goal clipboard source"), JSON.stringify(sourceData)).lastInsertRowid,
    );
    destinationId = Number(
      insert.run(uniqueName("Goal clipboard destination"), JSON.stringify(destinationData))
        .lastInsertRowid,
    );
  } finally {
    db.close();
  }

  await goto(page, `/block/${sourceId}`);
  await dismissDataDriftPrompt(page);
  await page.getByRole("button", { name: "Copy goals" }).click();
  await expect(toast(page, "Copied 2 goals.")).toBeVisible();

  await goto(page, `/block/${destinationId}`);
  await dismissDataDriftPrompt(page);
  await page.getByRole("button", { name: "Paste goals" }).click();
  await expect(toast(page, "Pasted 1 goal; skipped 1 already present.")).toBeVisible();
  await expect(page.locator("[data-goal]")).toHaveCount(3);
  await expect(page.locator("[data-goal]").nth(0)).toHaveAttribute("data-goal", "stone-brick");
  await expect(page.locator("[data-goal]").nth(1)).toHaveAttribute("data-goal", "iron-plate");
  await expect(page.locator("[data-goal]").nth(2)).toHaveAttribute("data-goal", "copper-plate");
  await expectUndoTop(page, /Undo: Paste 1 goal/);

  const saved = new DatabaseSync(activeProjectDbFile(), { readOnly: true });
  try {
    const row = saved.prepare("SELECT data FROM blocks WHERE id = ?").get(destinationId) as {
      data: string;
    };
    const parsed = JSON.parse(row.data) as typeof destinationData;
    expect(parsed.goals).toEqual([
      { name: "stone-brick", rate: 1 },
      { name: "iron-plate", rate: 99 },
      { name: "copper-plate", rate: 20 / 3600, stock: 20, window: 3600 },
    ]);
    expect(parsed.recipes).toEqual([]);
  } finally {
    saved.close();
  }
});
