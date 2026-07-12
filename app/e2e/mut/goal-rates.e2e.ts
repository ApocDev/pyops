import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, expectUndoTop, goto, uniqueName } from "./helpers";

test("a secondary goal accepts and persists a negative consume rate", async ({ page }) => {
  // Block 38's shape: Tar remains the primary sink while Shale oil is added as
  // another goal and changed from the default production rate to consumption.
  const data = {
    recipes: [],
    goals: [
      { name: "tar", rate: -9.575 },
      { name: "scrude", rate: 1 },
    ],
  };
  const db = new DatabaseSync(activeProjectDbFile());
  let id: number;
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const inserted = db
      .prepare("INSERT INTO blocks (name, data) VALUES (?, ?)")
      .run(uniqueName("Secondary sink"), JSON.stringify(data));
    id = Number(inserted.lastInsertRowid);
  } finally {
    db.close();
  }

  await goto(page, `/block/${id}`);
  await page.getByRole("button", { name: "1", exact: true }).click();
  const input = page.locator("input:focus");
  await input.fill("-2.5");
  await input.press("Enter");

  await expect(page.getByRole("button", { name: "-2.5", exact: true })).toBeVisible();
  await expectUndoTop(page, /Set "Shale oil" rate/);

  const addConsumer = page.getByRole("button", {
    name: "add a recipe that consumes Shale oil",
  });
  await expect(addConsumer).toBeVisible();
  await addConsumer.click();
  await expect(page.getByRole("dialog", { name: "Recipes that consume Shale oil" })).toBeVisible();

  const saved = new DatabaseSync(activeProjectDbFile(), { readOnly: true });
  try {
    const row = saved.prepare("SELECT data FROM blocks WHERE id = ?").get(id) as { data: string };
    const parsed = JSON.parse(row.data) as { goals: { name: string; rate: number }[] };
    expect(parsed.goals.find((goal) => goal.name === "scrude")?.rate).toBe(-2.5);
  } finally {
    saved.close();
  }
});
