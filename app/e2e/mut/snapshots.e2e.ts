import { expect, test, type Page } from "@playwright/test";
import {
  addGoal,
  createBlock,
  expectUndoTop,
  goalRateButton,
  setGoalRate,
  uniqueName,
} from "./helpers";

/**
 * Block snapshots (#85): manual labelled restore points in the history drawer,
 * the snapshot-vs-current diff (from → to), restore rehydrating the open
 * editor, and the automatic "before restore" point a restore leaves behind.
 */

const sheet = (page: Page) => page.getByRole("dialog").filter({ hasText: "Snapshots" });

const openSheet = async (page: Page) => {
  await page.getByRole("button", { name: /^Snapshots — / }).click();
  await expect(sheet(page)).toBeVisible();
};

const closeSheet = async (page: Page) => {
  await sheet(page).getByRole("button", { name: "Close" }).click();
  await expect(sheet(page)).toBeHidden();
};

test("snapshot → edit → diff → restore round-trip", async ({ page }) => {
  await createBlock(page);
  await addGoal(page, "iron plate", "Iron plate");
  await expectUndoTop(page, /Undo: Edit block "Iron plate"/);

  // take a manual labelled snapshot of the 1/s state
  const label = uniqueName("before rate bump");
  await openSheet(page);
  await sheet(page).getByPlaceholder(/Label \(optional\)/).fill(label);
  await sheet(page).getByRole("button", { name: "Snapshot now" }).click();
  const row = sheet(page)
    .locator("div")
    .filter({ has: page.getByText(label, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Restore" }) })
    .last();
  await expect(row).toBeVisible();
  await expect(row.getByText("Manual", { exact: true })).toBeVisible();
  await expect(row).toContainText("1 goal");
  await closeSheet(page);

  // change the goal rate, so the snapshot now differs from the editor
  await setGoalRate(page, "5");
  await expectUndoTop(page, /Undo: Set "Iron plate" rate/);

  // the diff names the goal and shows the from → to rates
  await openSheet(page);
  await row.getByRole("button", { name: "Diff", exact: true }).click();
  await expect(row).toContainText("Goals");
  await expect(row).toContainText("Iron plate");
  await expect(row).toContainText("1/s");
  await expect(row).toContainText("5/s");

  // restore: the open editor rehydrates to the snapshot state…
  await row.getByRole("button", { name: "Restore" }).click();
  // …and the restore auto-snapshotted the pre-restore state first
  await expect(sheet(page).getByText(/Auto · before restore/)).toBeVisible();
  await closeSheet(page);
  await expect(goalRateButton(page)).toHaveText("1");
});
