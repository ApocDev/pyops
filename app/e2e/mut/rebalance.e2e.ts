import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, goto, toast, undoButton, uniqueName } from "./helpers";

test("what-if target stays editable while the factory re-solves", async ({ page }) => {
  await goto(page, "/factory/scenario");

  const firstDemand = page.getByRole("spinbutton").first();
  await expect(firstDemand).toBeVisible();
  await firstDemand.selectText();
  await firstDemand.pressSequentially("12.34", { delay: 100 });

  // Each character starts another solve. The demand list must remain mounted,
  // preserving both the in-progress value and keyboard focus throughout them.
  await expect(firstDemand).toBeFocused();
  await expect(firstDemand).toHaveValue("12.34");
  await expect(page.getByText("Goal changes", { exact: false }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(firstDemand).toBeFocused();
  await expect(firstDemand).toHaveValue("12.34");
});

/**
 * What-if "Apply all" (whole-factory re-balance): overriding a final product's
 * target surfaces the per-block changes, and Apply all commits every one of them
 * in a single undoable step. Drives the real flow end-to-end against the isolated
 * mut server, then undoes the factory-wide change so the shared scratch db is left
 * as it was.
 *
 * A change only shows when a block's scale is off by more than the ~1% "balanced"
 * floor (rounding), so the test forces a genuine change by DOUBLING a demand — far
 * above the floor — rather than depending on the seed happening to be imbalanced.
 */
test("what-if 'apply all' re-balances the factory in one undoable step", async ({ page }) => {
  // applying + undoing a whole-factory re-balance re-solves every touched block, so
  // give the round trips generous room over the default per-test budget
  test.setTimeout(120_000);
  await goto(page, "/factory/scenario");

  // the Final products card is the only place with numeric (spinbutton) inputs
  const firstDemand = page.getByRole("spinbutton").first();
  await expect(firstDemand).toBeVisible();
  const current = Number(await firstDemand.inputValue());
  // 2× + 1 guarantees a real increase even if the current target reads 0
  await firstDemand.fill(String(current * 2 + 1));

  // the doubled demand cascades into real per-block changes → Apply all enables
  const applyAll = page.getByRole("button", { name: "Apply all" });
  await expect(applyAll).toBeEnabled({ timeout: 15_000 });
  await applyAll.click();

  // confirm dialog summarizes the change; commit it
  const dialog = page.getByRole("dialog", { name: /Re-balance the whole factory/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^Apply \d+ change/ }).click();
  // the apply iterates the solve to convergence across every touched block, so the
  // dialog can sit in its "applying…" state for a while before it closes
  await expect(dialog).toBeHidden({ timeout: 45_000 });

  // the whole batch reports as one undoable action. The success toast is brief
  // and can expire while the final query invalidations settle; the undo label is
  // the durable proof that the write completed.
  await expect(undoButton(page)).toHaveAccessibleName(/Undo: Re-balance factory/, {
    timeout: 15_000,
  });

  // one undo reverts this whole batch, leaving the shared scratch db as it was.
  // Assert the undo RAN via its toast rather than that the label clears — the seed
  // is a copy of the live project and may already carry an unrelated
  // "Re-balance factory" action, so the label needn't return to something else.
  await expect(undoButton(page)).toBeEnabled();
  await undoButton(page).click();
  await expect(toast(page, /Undid: Re-balance factory/)).toBeVisible({ timeout: 30_000 });

});

test("Scenario applies a secondary consume goal independently", async ({ page }) => {
  test.setTimeout(120_000);
  // Resolve the copied project's existing projections before inserting the two
  // self-contained test blocks and their cached factory boundary flows.
  await goto(page, "/factory/scenario");

  const sourceName = uniqueName("Acetaldehyde surplus");
  const sinkName = uniqueName("Secondary sink");
  const db = new DatabaseSync(activeProjectDbFile());
  let sourceId: number;
  let sinkId: number;
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    sourceId = Number(
      db
        .prepare("INSERT INTO blocks (name, data, solve_status) VALUES (?, ?, 'solved')")
        .run(
          sourceName,
          JSON.stringify({ goals: [{ name: "water", rate: 1 }], recipes: [] }),
        ).lastInsertRowid,
    );
    sinkId = Number(
      db
        .prepare("INSERT INTO blocks (name, data, solve_status) VALUES (?, ?, 'solved')")
        .run(
          sinkName,
          JSON.stringify({
            goals: [
              { name: "water", rate: -1 },
              { name: "acetaldehyde", rate: -2 },
            ],
            recipes: ["spoil-acetaldehyde"],
          }),
        ).lastInsertRowid,
    );
    const insertFlow = db.prepare(
      "INSERT INTO block_flows (block_id, item, kind, role, rate) VALUES (?, ?, ?, ?, ?)",
    );
    insertFlow.run(sourceId, "acetaldehyde", "item", "byproduct", 10);
    insertFlow.run(sinkId, "acetaldehyde", "item", "import", 2);
  } finally {
    db.close();
  }

  await goto(page, "/factory/scenario");
  const change = page.getByRole("link", { name: /^Acetaldehyde / });
  await expect(change).toContainText("-2");
  await expect(change).toContainText("-10");

  await page.getByRole("button", { name: "Apply all" }).click();
  const dialog = page.getByRole("dialog", { name: /Re-balance the whole factory/ });
  await dialog.getByRole("button", { name: /^Apply \d+ change/ }).click();
  await expect(dialog).toBeHidden({ timeout: 45_000 });
  await expect(toast(page, /Re-balanced \d+ block/)).toBeVisible({ timeout: 15_000 });
  await expect(undoButton(page)).toHaveAccessibleName(/Undo: Re-balance factory/, {
    timeout: 15_000,
  });

  const saved = new DatabaseSync(activeProjectDbFile(), { readOnly: true });
  try {
    const row = saved.prepare("SELECT data FROM blocks WHERE id = ?").get(sinkId) as {
      data: string;
    };
    const doc = JSON.parse(row.data) as { goals: { name: string; rate: number }[] };
    expect(doc.goals.find((goal) => goal.name === "acetaldehyde")?.rate).toBe(-10);
    expect(doc.goals.find((goal) => goal.name === "water")?.rate).toBe(-1);
  } finally {
    saved.close();
  }

  await undoButton(page).click();
  await expect(toast(page, /Undid: Re-balance factory/)).toBeVisible({ timeout: 30_000 });

  const cleanup = new DatabaseSync(activeProjectDbFile());
  try {
    cleanup.exec("PRAGMA busy_timeout = 5000");
    cleanup.prepare("DELETE FROM block_flows WHERE block_id IN (?, ?)").run(sourceId, sinkId);
    cleanup.prepare("DELETE FROM block_machines WHERE block_id IN (?, ?)").run(sourceId, sinkId);
    cleanup.prepare("DELETE FROM blocks WHERE id IN (?, ?)").run(sourceId, sinkId);
  } finally {
    cleanup.close();
  }
});
