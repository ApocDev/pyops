import { expect, test } from "@playwright/test";
import { addGoal, blockNameInput, createBlock, expectUndoTop, goto, uniqueName } from "./helpers";

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
  await page.locator('button[aria-label^="add a recipe that makes "]').click();
  const picker = page.getByRole("dialog", { name: /Recipes that make/ });
  await picker.getByRole("button", { name: /Mine Antimony field/ }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByText("Mine Antimony field")).toBeVisible();

  // the default machine is the legacy SOLID-burner drill (lowest power wins the
  // tie-break) — switch to the fluid-burning Antimony drill MK 01 (10MW ÷ 10 =
  // 1MW … dump: energy_usage 1MW, energy_source { type "fluid", burns_fluid true })
  await page.locator('button[aria-label^="change "][aria-label$=" building"]').click();
  const buildings = page.getByRole("dialog", { name: /Building for/ });
  await buildings.getByRole("button", { name: /^Antimony drill MK 01(?! \(Legacy\))/ }).click();
  await expect(buildings).toBeHidden();

  // the row carries a non-clickable Fluid fuel chip (MW of pool draw) …
  await expect(page.getByLabel(/^Fluid fuel ·/).first()).toBeVisible();
  // … and the balance lists the pool as a "Fluid fuel (MJ)" import in watts
  await expect(page.getByLabel(/^Fluid fuel \(MJ\) \S+ [MkG]?W/).first()).toBeVisible();
  // the pre-#25 behavior defaulted fluid burners to a petroleum-gas import — gone
  await expect(page.getByLabel(/^Petroleum gas/)).toHaveCount(0);
});

/**
 * Fluid-fuel supplier designation (#115): pinning "Fluid fuel (MJ)" as a goal
 * (fed by a Burn <fluid> conversion) makes the block a factory-scale MJ
 * supplier — the conversion is sized to the pinned MW, the feed fluid becomes
 * the block's import, and the MJ export shows up as a PRIMARY producer on the
 * coherence wiring (matched against other blocks' generic fuel imports).
 */
test("a Fluid fuel goal designates the block as a factory-scale supplier", async ({ page }) => {
  await createBlock(page);
  const name = uniqueName("Fuel farm");
  await blockNameInput(page).fill(name);

  // goal: the pyops-fluid-fuel pseudo-fluid — its rate renders as power (1 MW)
  await page.locator('button[title="add a goal product"]').click();
  const goalDialog = page.getByRole("dialog", { name: "Add a goal product" });
  await goalDialog.getByPlaceholder("search an item or fluid…").fill("fluid fuel");
  await goalDialog.getByRole("button", { name: "Fluid fuel (MJ)", exact: true }).click();
  await expect(goalDialog).toBeHidden();
  await expect(page.locator('button[title^="click to edit the goal rate"]')).toHaveText("1 MW");

  // feed it with the Burn Kerosene conversion (1 kerosene → 1.5 MJ)
  await page.locator('button[aria-label^="add a recipe that makes "]').click();
  const picker = page.getByRole("dialog", { name: /Recipes that make/ });
  await picker.getByRole("button", { name: /^Burn Kerosene/ }).click();
  await expect(picker).toBeHidden();
  await expect(page.locator('span[title="Burn Kerosene"]')).toBeVisible();

  // the conversion is sized to the goal: 1 MJ/s ÷ 1.5 MJ = 0.67 kerosene/s import
  await expect(page.getByLabel(/^Kerosene 0\.67\/s/).first()).toBeVisible();

  // once the save lands (undo top names this block's last edit), the coherence
  // wiring lists it as a PRIMARY producer of Fluid fuel (MJ) — the supplier
  // designation at factory scale
  await expectUndoTop(page, new RegExp(`^Undo: .*${name}`));
  await goto(page, "/coherence");
  const producer = page.locator(`[title="${name} · primary"]`);
  await expect(producer).toBeVisible();
  await expect(producer).toContainText("1 MW");
});
