import { readFileSync, statSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  addGoal,
  blockNameInput,
  createBlock,
  expectUndoTop,
  uniqueName,
  goto,
} from "./helpers";

/**
 * Backup & share (#82): the project backup download is a real sqlite file,
 * and a single block round-trips through its shareable JSON export — the
 * re-import creates a NEW block with a collision-suffixed name.
 */

test("project backup downloads a real sqlite .db file", async ({ page }, testInfo) => {
  await goto(page, "/settings?tab=backup");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /^Download /, exact: false }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.db$/);
  const file = testInfo.outputPath("backup.db");
  await download.saveAs(file);
  // non-trivial size and the sqlite magic bytes — a real database, not an error page
  expect(statSync(file).size).toBeGreaterThan(100_000);
  const header = readFileSync(file).subarray(0, 16).toString("latin1");
  expect(header).toBe("SQLite format 3\u0000");
});

test("a block's JSON export re-imports as a new ' (2)'-suffixed block", async ({
  page,
}, testInfo) => {
  const name = uniqueName("Share block");
  await createBlock(page);
  await addGoal(page, "iron plate", "Iron plate");
  await blockNameInput(page).fill(name);
  await expectUndoTop(page, new RegExp(`Undo: Edit block "${name}"`));

  // export from the block editor's toolbar
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Export block/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pyops\.json$/);
  const file = testInfo.outputPath("block-export.pyops.json");
  await download.saveAs(file);
  const envelope = JSON.parse(readFileSync(file, "utf8")) as {
    pyops: number;
    kind: string;
    block: { name: string };
  };
  expect(envelope.pyops).toBe(1);
  expect(envelope.kind).toBe("block");
  expect(envelope.block.name).toBe(name);

  // re-import it into the same project from Settings → Backup & share
  await goto(page, "/settings?tab=backup");
  await page.locator('input[type="file"][accept*="json"]').setInputFiles(file);
  await expect(page.getByText("imported 1 block")).toBeVisible();
  // the original still exists, so the copy gets the " (2)" suffix
  const imported = page.getByRole("link", { name: `${name} (2)`, exact: true });
  await expect(imported).toBeVisible();

  // and it's a real block: the link opens its editor
  await imported.click();
  await page.waitForURL(/\/block\/\d+$/);
  await expect(blockNameInput(page)).toHaveValue(`${name} (2)`);
});
