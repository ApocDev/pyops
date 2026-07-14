import { expect, test } from "@playwright/test";
import { goto } from "./helpers";

test("Advanced settings captures a structured Scenario solver trace", async ({ page }) => {
  test.setTimeout(120_000);
  await goto(page, "/settings?tab=advanced");
  const ignoreDrift = page.getByRole("button", { name: "Ignore for now" });
  await ignoreDrift.click({ timeout: 10_000 }).catch(() => undefined);
  const capture = page.getByRole("switch", { name: /Capture structured solver traces/ });
  await expect(capture).toBeVisible();

  try {
    if ((await capture.getAttribute("data-state")) !== "checked") await capture.click();
    await expect(capture).toHaveAttribute("data-state", "checked");

    await page.setViewportSize({ width: 3840, height: 1080 });
    await goto(page, "/factory/scenario");
    await expect(page.getByText("Raw inputs", { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
    const workspace = await page.getByTestId("scenario-workspace").boundingBox();
    expect(workspace?.width).toBeLessThanOrEqual(1600);
    expect(workspace?.x).toBeGreaterThan(1_000);
    // Free energy boundaries stay outside material-demand reachability, but an
    // existing generator goal must remain fixed instead of becoming a 0 W
    // Scenario change.
    await expect(page.getByRole("link", { name: /^Electricity .* 0 W / })).toHaveCount(0);
    // A reached byproduct with a configured waste block is a closed balance:
    // Scenario must scale that consumer instead of discarding the material and
    // proposing a zero rate.
    await expect(page.getByRole("link", { name: /^Ash .* 0 / })).toHaveCount(0);
    await expect(page.getByText("Electricity", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Fluid fuel", { exact: true }).first()).toBeVisible();

    await goto(page, "/settings?tab=advanced");
    await page.getByRole("button", { name: "Refresh" }).click();
    const trace = page.locator("pre");
    await expect(trace).toContainText('"source": "scenario-preview"');
    await expect(trace).toContainText('"type": "pinned-model"');
    await expect(trace).toContainText('"required"');
  } finally {
    await goto(page, "/settings?tab=advanced");
    const current = page.getByRole("switch", { name: /Capture structured solver traces/ });
    if ((await current.getAttribute("data-state")) === "checked") await current.click();
    await page.getByRole("button", { name: "Clear" }).click();
  }
});
