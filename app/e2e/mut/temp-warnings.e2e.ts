import { expect, test } from "@playwright/test";
import { createBlock } from "./helpers";

/**
 * Per-producer fluid-temperature warnings (#110 interim): the solver pools all
 * temperature variants of a fluid by name, so a producer whose output
 * temperature a consumer can't accept is silently blended in. Build the
 * issue's real fusion block — the MHD generator (accepts neutron @4000° only)
 * fed by dt-he3 (neutron @3000°) — and check the mismatch is flagged on the
 * balance card and both rows' chips. Then add b-h (neutron @4000°, satisfies
 * the range) and check the warning STAYS — the old block-level check went
 * silent as soon as any one producer matched.
 */
test("fluid-temp mismatch flags the 3000° producer feeding a 4000° generator", async ({
  page,
}) => {
  await createBlock(page);

  // goal: the pyops-electricity pseudo-fluid (rate irrelevant to the warning)
  await page.locator('button[title="add a goal product"]').click();
  const goalDialog = page.getByRole("dialog", { name: "Add a goal product" });
  await goalDialog.getByPlaceholder("search an item or fluid…").fill("pyops electricity");
  await goalDialog.getByRole("button", { name: "Electricity (MJ)", exact: true }).click();
  await expect(goalDialog).toBeHidden();

  // add the 4000°-only MHD generator as the goal's producer
  await page.locator('button[aria-label^="add a recipe that makes "]').click();
  const elecPicker = page.getByRole("dialog", { name: /Recipes that make/ });
  await elecPicker
    .getByRole("button", { name: /Magnetohydrodynamic \(MHD\) generator power \(4000°\)/ })
    .click();
  await expect(elecPicker).toBeHidden();
  // the row's name span (title = display) — scoped so the closing picker's
  // candidate text can never double-match
  await expect(
    page.locator('span[title="Magnetohydrodynamic (MHD) generator power (4000°)"]'),
  ).toBeVisible();

  // feed it dt-he3 — which makes neutron at 3000°, outside the 4000° range
  await page.getByRole("button", { name: /^Neutron/ }).first().click();
  const neutronPicker = page.getByRole("dialog", { name: /Recipes that make/ });
  await neutronPicker.getByRole("button", { name: /Fuse deuterium and helium-3/ }).click();
  await expect(neutronPicker).toBeHidden();

  // the mismatch is named on the balance card and on both rows' chips
  await expect(page.getByText(/makes Neutron at 3k°, but/)).toBeVisible();
  await expect(page.getByText("gets 3k°", { exact: true })).toBeVisible(); // consumer row's ingredient chip
  await expect(page.getByText("needs 4k°", { exact: true })).toBeVisible(); // producer row's product chip

  // add b-h (neutron @4000°, satisfies the generator): the dt-he3 mismatch
  // must STAY flagged — one matching producer used to mask it entirely.
  await page
    .getByRole("button", { name: /^Neutron.*linked/ })
    .first()
    .click();
  await neutronPicker.getByRole("button", { name: /Fuse boron with a proton/ }).click();
  await expect(neutronPicker).toBeHidden();
  await expect(page.locator('span[title="Fuse boron with a proton"]')).toBeVisible();
  await expect(page.getByText(/makes Neutron at 3k°, but/)).toBeVisible();
  await expect(page.getByText("gets 3k°", { exact: true })).toBeVisible();
  await expect(page.getByText("needs 4k°", { exact: true })).toBeVisible();
});
