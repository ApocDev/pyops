import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, expectUndoTop, goto, uniqueName } from "./helpers";

test("a folder context menu creates a block directly inside that folder", async ({ page }) => {
  await goto(page, "/block");
  const folderName = uniqueName("Direct blocks");
  page.once("dialog", (dialog) => void dialog.accept(folderName));
  await page.getByRole("button", { name: "New folder", exact: true }).click();

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

test("creating a block scrolls its sidebar row into view", async ({ page }) => {
  const db = new DatabaseSync(activeProjectDbFile());
  const fillerIds: number[] = [];
  const prefix = uniqueName("Scroll filler");
  try {
    const insert = db.prepare("INSERT INTO blocks (name, data) VALUES (?, '{}')");
    for (let i = 0; i < 80; i += 1) {
      const result = insert.run(`000 ${prefix} ${String(i).padStart(2, "0")}`);
      fillerIds.push(Number(result.lastInsertRowid));
    }
  } finally {
    db.close();
  }

  try {
    await page.addInitScript(() => localStorage.removeItem("pyops.collapsedGroups"));
    await goto(page, "/block");
    const nav = page.locator("[data-block-nav-scroll]");
    await expect(nav).toBeVisible();

    await page.locator('[title="New block"]').click();
    await page.waitForURL(/\/block\/\d+$/);
    const id = Number(new URL(page.url()).pathname.split("/").pop());
    const row = nav.locator(`[data-block-nav-id="${id}"]`);

    await expect(row).toBeInViewport({ ratio: 1 });
    await expect.poll(() => nav.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  } finally {
    const cleanup = new DatabaseSync(activeProjectDbFile());
    try {
      const remove = cleanup.prepare("DELETE FROM blocks WHERE id = ?");
      for (const id of fillerIds) remove.run(id);
    } finally {
      cleanup.close();
    }
  }
});
