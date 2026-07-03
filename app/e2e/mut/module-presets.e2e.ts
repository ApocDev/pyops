import { expect, test } from "@playwright/test";
import { addGoal, createBlock, uniqueName } from "./helpers";

/**
 * Module templates (#99): save a loadout as a preset from the modules dialog,
 * star it as the DEFAULT template, and see a compatible new recipe row start
 * with that loadout baked in (instead of empty/auto-fill).
 *
 * Uses Py's distilator family: "Coal gas from coal" (coal-gas) and "Gravel
 * distillation" (stone-distilation) both run in a distilator (1 module slot,
 * allow_productivity on both recipes), so a productivity-module template is
 * compatible with each.
 */
test("module template: save → set default → auto-applies to a new compatible row", async ({
  page,
}) => {
  const presetName = uniqueName("Prod everywhere");

  // ── block 1: configure a loadout by hand and save it as a default template ──
  await createBlock(page);
  await addGoal(page, "coal gas", "Coal gas");
  await page.locator('button[title^="click to add a recipe that makes this goal"]').click();
  const picker = page.getByRole("dialog", { name: "Recipes that make Coal gas" });
  await picker.getByRole("button", { name: "Coal gas from coal" }).click();
  await expect(picker).toBeHidden();

  // the fresh row has no loadout — open the modules dialog
  // (title differs with the payback auto-fill on/off, so match both)
  const emptyChip = page.locator(
    'button[title*="click to configure"], button[title*="click to override"]',
  );
  await expect(emptyChip).toHaveCount(1);
  await emptyChip.click();
  const modal = page.getByRole("dialog", { name: /^Modules — / });
  await expect(modal).toBeVisible();

  // palette click fills the next slot: 1 productivity module → 1/1 slots
  await modal.locator('button[title^="Productivity module ·"]').click();
  await expect(modal.getByText(/1\/1 slots/)).toBeVisible();
  await expect(modal.getByText("+10% productivity")).toBeVisible();

  // save the loadout as a preset (name comes from the window.prompt)
  page.once("dialog", (d) => void d.accept(presetName));
  await modal.getByRole("button", { name: "+ save" }).click();
  const chip = modal.getByRole("button", { name: presetName });
  await expect(chip).toBeVisible();
  // the chip carries the template icon (the module it applies)
  await expect(chip.locator("span[style]").first()).toBeVisible();

  // star it: default template for new rows
  await chip.locator('span[title="make this the default template for new rows"]').click();
  await expect(chip.locator('span[title^="default template"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();

  // ── block 2: a compatible new row starts with the template, not empty ──
  await createBlock(page);
  await addGoal(page, "coarse", "Coarse fraction");
  await page.locator('button[title^="click to add a recipe that makes this goal"]').click();
  const picker2 = page.getByRole("dialog", { name: "Recipes that make Coarse fraction" });
  await picker2.getByRole("button", { name: "Gravel distillation" }).click();
  await expect(picker2).toBeHidden();
  await expect(page.getByText("Gravel distillation").first()).toBeVisible();

  // the template was baked in at add time: the row's modules chip is configured
  // (the success-tinted loadout chip), not the dashed empty one
  const loadoutChip = page.locator("button.bg-muted\\/50.text-success");
  await expect(loadoutChip).toHaveCount(1);
  await expect(
    page.locator('button[title*="click to configure"], button[title*="click to override"]'),
  ).toHaveCount(0);

  // and it holds exactly the template's loadout
  await loadoutChip.click();
  const modal2 = page.getByRole("dialog", { name: /^Modules — Gravel distillation/ });
  await expect(modal2).toBeVisible();
  await expect(modal2.getByText(/1\/1 slots/)).toBeVisible();
  await expect(modal2.getByText("+10% productivity")).toBeVisible();
});
