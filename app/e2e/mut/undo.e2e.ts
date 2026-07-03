import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import {
  activeProjectDbFile,
  addGoal,
  createBlock,
  expectUndoTop,
  goalRateButton,
  setGoalRate,
  toast,
  undoButton,
  goto,
} from "./helpers";

/**
 * The undo subsystem end-to-end (#90): a real edit lands in the server's
 * undo log, the nav affordance names it, Ctrl+Z reverts it — rehydrating the
 * OPEN editor so its auto-save can't write the pre-undo value straight back —
 * and the empty stack degrades to a quiet "Nothing to undo" toast.
 */

test("Ctrl+Z on an empty stack shows the nothing-to-undo toast", async ({ page }) => {
  // Arrange the empty stack directly in the scratch db (it's OURS — that's the
  // point of the isolated server): the copied project may carry real undo
  // history, and other specs in this suite push actions of their own.
  const db = new DatabaseSync(activeProjectDbFile());
  try {
    db.exec("PRAGMA busy_timeout = 5000; DELETE FROM undo_log; DELETE FROM undo_actions;");
  } finally {
    db.close();
  }

  await goto(page, "/");
  await expect(undoButton(page)).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(toast(page, "Nothing to undo")).toBeVisible();
  await expect(undoButton(page)).toBeDisabled();
});

test("editing a goal rate is undoable: named in the nav, reverted in the open editor, persisted", async ({
  page,
}) => {
  await createBlock(page);
  await addGoal(page, "iron plate", "Iron plate"); // pins the goal at 1/s
  // the goal-add save names the block after the goal
  await expectUndoTop(page, /Undo: Edit block "Iron plate"/);

  await setGoalRate(page, "2");
  // the debounced save lands with the descriptive action name…
  await expectUndoTop(page, /Undo: Set "Iron plate" rate — Iron plate/);

  // …and Ctrl+Z (from outside any input) reverts exactly that action
  await page.locator("nav").getByRole("link", { name: "PyOps" }).focus();
  await page.keyboard.press("Control+z");
  await expect(toast(page, 'Undid: Set "Iron plate" rate — Iron plate')).toBeVisible();
  // the OPEN editor rehydrated to the pre-edit value — no reload needed
  await expect(goalRateButton(page)).toHaveText("1");

  // outlive the editor's 700ms auto-save debounce, then reload: the reverted
  // value persisted (a stale editor doc did NOT re-save the pre-undo "2")
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(goalRateButton(page)).toHaveText("1");
});
