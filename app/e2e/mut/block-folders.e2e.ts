import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, expectUndoTop, goto, uniqueName } from "./helpers";

test("a folder context menu creates a block directly inside that folder", async ({ page }) => {
  await goto(page, "/block");
  const folderName = uniqueName("Direct blocks");
  page.once("dialog", (dialog) => void dialog.accept(folderName));
  await page.getByRole("button", { name: "new folder", exact: true }).click();

  const folder = page.getByText(new RegExp(`^${folderName} \\(0\\)$`));
  await expect(folder).toBeVisible();
  await folder.click({ button: "right" });
  await page.getByRole("menuitem", { name: "New block here" }).click();
  await page.waitForURL(/\/block\/\d+$/);

  await expect(page.getByText(new RegExp(`^${folderName} \\(1\\)$`))).toBeVisible();
  await expectUndoTop(page, /Undo: Create block "New block"/);

  const id = Number(new URL(page.url()).pathname.split("/").pop());
  const db = new DatabaseSync(activeProjectDbFile(), { readOnly: true });
  try {
    const row = db
      .prepare(
        `SELECT blocks.group_id AS groupId, block_groups.name AS groupName
         FROM blocks
         LEFT JOIN block_groups ON block_groups.id = blocks.group_id
         WHERE blocks.id = ?`,
      )
      .get(id) as { groupId: number | null; groupName: string | null };
    expect(row.groupId).not.toBeNull();
    expect(row.groupName).toBe(folderName);
  } finally {
    db.close();
  }
});
