import { expect, test } from "@playwright/test";
import { goto, toast, undoButton } from "./helpers";

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
  await expect(page.getByText("Block changes", { exact: false }).first()).toBeVisible({
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
  await dialog.getByRole("button", { name: /^Apply to \d+ block/ }).click();
  // the apply iterates the solve to convergence across every touched block, so the
  // dialog can sit in its "applying…" state for a while before it closes
  await expect(dialog).toBeHidden({ timeout: 45_000 });

  // the whole batch reports as one action, with an Undo affordance
  await expect(toast(page, /Re-balanced \d+ block/)).toBeVisible({ timeout: 30_000 });
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
