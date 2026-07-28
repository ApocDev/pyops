import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, goto } from "./helpers";

/** The sync prompt offers re-importing the dump already in script-output instead
 * of running a headless Factorio. Drives the prompt open the same way the
 * data-format spec does, then exercises the option WITHOUT starting a sync — a
 * real run would rewrite this project's reference data. */
test("the sync prompt offers reusing the dump already on disk", async ({ page }) => {
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

    const reuse = dialog.getByRole("checkbox", { name: "Reuse the dump already on disk" });
    await expect(reuse).toBeVisible();

    // The status line resolves to either the dump's age/size or an explicit
    // "no dump" — never a blank row while the query is in flight.
    const row = dialog.locator("label", { hasText: "Reuse the dump already on disk" });
    await expect(row).toContainText(/Dumped .+ · \d+ MB|No dump found/);

    // Opting in retargets the primary action: an import, not a re-dump.
    await expect(dialog.getByRole("button", { name: "Re-sync now" })).toBeVisible();
    if (await reuse.isEnabled()) {
      await reuse.check();
      await expect(dialog.getByRole("button", { name: "Re-import now" })).toBeVisible();
      await reuse.uncheck();
      await expect(dialog.getByRole("button", { name: "Re-sync now" })).toBeVisible();
    }

    await dialog.getByRole("button", { name: "Ignore for now" }).click();
    await expect(dialog).toBeHidden();
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
