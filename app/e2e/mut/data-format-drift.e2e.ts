import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, goto } from "./helpers";

test("an older imported-data format reuses the shared drift prompt", async ({ page }) => {
  const file = activeProjectDbFile();
  const db = new DatabaseSync(file);
  const original = db
    .prepare("SELECT value FROM meta WHERE key = 'data_format_version'")
    .get() as { value: string | null } | undefined;
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('data_format_version', '0') ON CONFLICT(key) DO UPDATE SET value = '0'",
  ).run();
  db.close();

  try {
    await goto(page, "/");
    const dialog = page.getByRole("dialog", { name: "Reference data is out of date" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("PyOps now reads the Factorio dump differently");
    await expect(dialog).toContainText(/Imported data format: v0 · Current reader: v\d+/);

    await dialog.getByRole("button", { name: "Ignore for now" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("nav").getByRole("button", { name: "Data stale" })).toBeVisible();
  } finally {
    const restore = new DatabaseSync(file);
    if (original) {
      restore
        .prepare(
          "INSERT INTO meta (key, value) VALUES ('data_format_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(original.value);
    } else {
      restore.prepare("DELETE FROM meta WHERE key = 'data_format_version'").run();
    }
    restore.close();
  }
});
