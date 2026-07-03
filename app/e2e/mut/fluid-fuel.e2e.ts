import { expect, test } from "@playwright/test";
import { addGoal, createBlock } from "./helpers";

/**
 * Fungible fluid fuel (#25): a machine whose energy source burns UNFILTERED
 * fluid (Py's antimony drill — energy_source { type "fluid", burns_fluid true,
 * no filter }) accepts any fuel-valued fluid, so its demand is the shared
 * "Fluid fuel (MJ)" pool (satisfied by a Burn <fluid> conversion recipe), not a
 * per-row fluid pick like the old behavior (which defaulted to petroleum-gas).
 */
test("a fluid-burning drill demands the Fluid fuel pool, not a picked fluid", async ({ page }) => {
  await createBlock(page);
  await addGoal(page, "antimony ore", "Antimony ore");

  // several recipes make Antimony ore → the picker opens; take the drill's one
  await page.locator('button[title^="click to add a recipe that makes this goal"]').click();
  const picker = page.getByRole("dialog", { name: /Recipes that make/ });
  await picker.getByRole("button", { name: /Mine Antimony field/ }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByText("Mine Antimony field")).toBeVisible();

  // the default machine is the legacy SOLID-burner drill (lowest power wins the
  // tie-break) — switch to the fluid-burning Antimony drill MK 01 (10MW ÷ 10 =
  // 1MW … dump: energy_usage 1MW, energy_source { type "fluid", burns_fluid true })
  await page.locator('button[title*="click to change building"]').click();
  const buildings = page.getByRole("dialog", { name: /Building for/ });
  await buildings.getByRole("button", { name: /^Antimony drill MK 01(?! \(Legacy\))/ }).click();
  await expect(buildings).toBeHidden();

  // the row carries a non-clickable Fluid fuel chip (MW of pool draw) …
  await expect(page.locator('[title^="Fluid fuel"]').first()).toBeVisible();
  // … and the balance lists the pool as a "Fluid fuel (MJ)" import in watts
  await expect(page.getByLabel(/^Fluid fuel \(MJ\) \S+ [MkG]?W/).first()).toBeVisible();
  // the pre-#25 behavior defaulted fluid burners to a petroleum-gas import — gone
  await expect(page.getByLabel(/^Petroleum gas/)).toHaveCount(0);
});
