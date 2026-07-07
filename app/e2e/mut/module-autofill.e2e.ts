import { expect, test } from "@playwright/test";
import { addGoal, createBlock } from "./helpers";

/**
 * Module auto-fill as suggestion + explicit apply: the solve computes a
 * suggested fill per row (prod where allowed, else speed→floor→efficiency) but
 * NEVER applies it. A fresh row starts empty, shows the ✨ hint and the
 * toolbar's whole-block apply; clicking the hint bakes the suggestion into the
 * doc as ordinary stored picks, after which both affordances disappear.
 *
 * Uses "Coal gas from coal" (distilator, 1 slot, allow_productivity). The
 * suggestion pool only contains modules unlocked in the research horizon, so
 * the spec first pins the horizon to FUTURE — every producible module counts —
 * making the hint deterministic regardless of the seed's research state. The
 * scratch data dir is reseeded per run, so no restore is needed.
 */
test("module auto-fill: fresh row suggests, hint click applies, affordances clear", async ({
  page,
}) => {
  await page.goto("/settings");
  const future = page.getByRole("button", { name: "Future", exact: true });
  await expect(future).toBeVisible();
  await future.click();
  await expect(future).toHaveAttribute("aria-pressed", "true");

  await createBlock(page);
  await addGoal(page, "coal gas", "Coal gas");
  await page.locator('button[title^="click to add a recipe that makes this goal"]').click();
  const picker = page.getByRole("dialog", { name: "Recipes that make Coal gas" });
  await picker.getByRole("button", { name: "Coal gas from coal" }).click();
  await expect(picker).toBeHidden();

  // fresh row: EMPTY chip (nothing auto-applied) + the suggestion affordances
  const emptyChip = page.locator('button[title*="click to configure"]');
  const hint = page.locator('button[title^="better modules available"]');
  const blockFill = page.getByRole("button", { name: /^Auto-fill modules/ });
  await expect(emptyChip).toHaveCount(1);
  await expect(hint).toHaveCount(1);
  await expect(blockFill).toBeVisible();
  await expect(blockFill).toContainText("1"); // one row with a differing suggestion

  // the modules dialog previews the same suggestion with its own apply button
  await emptyChip.click();
  const modal = page.getByRole("dialog", { name: /^Modules — / });
  await expect(modal).toBeVisible();
  await expect(modal.getByText("suggested")).toBeVisible();
  await expect(modal.getByRole("button", { name: "apply" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();

  // clicking the hint applies the fill as stored picks…
  await hint.click();
  const loadoutChip = page.locator("button.bg-muted\\/50.text-success");
  await expect(loadoutChip).toHaveCount(1);
  // …and the row now matches its suggestion, so hint + toolbar apply vanish
  await expect(hint).toHaveCount(0);
  await expect(blockFill).toHaveCount(0);
  await expect(emptyChip).toHaveCount(0);
});
