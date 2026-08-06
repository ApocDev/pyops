import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { MUT_DATA_DIR, goto } from "./helpers";

/** Settings → Game data → Factorio paths: a custom executable path saves into
 * app-config.json, survives a reload, warns when it doesn't exist on disk, and
 * "Use platform defaults" clears it back to the probed default. */
test("Factorio paths save, persist, and reset to platform defaults", async ({ page }) => {
  const readConfig = (): { factorioBin?: string } => {
    const file = join(MUT_DATA_DIR, "app-config.json");
    return existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as { factorioBin?: string })
      : {};
  };

  await goto(page, "/settings?tab=data");
  const bin = page.getByLabel("Factorio executable");
  await expect(bin).toBeVisible();
  const saveButton = page.getByRole("button", { name: "Save paths" });
  const defaultsButton = page.getByRole("button", { name: "Use platform defaults" });

  // start from a clean slate even on a warm re-run
  if (await defaultsButton.isEnabled()) {
    await defaultsButton.click();
    await expect(bin).toHaveValue("");
  }
  await expect(saveButton).toBeDisabled(); // nothing dirty yet

  // a nonexistent custom path: saves, then flags that it isn't on disk
  const customBin = "/tmp/pyops-e2e/does-not-exist/factorio";
  await bin.fill(customBin);
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(saveButton).toBeDisabled(); // refetch landed — no longer dirty
  await expect(page.getByText(`Not found on disk: ${customBin}`)).toBeVisible();
  expect(readConfig().factorioBin).toBe(customBin);

  // the stored value survives a reload
  await goto(page, "/settings?tab=data");
  await expect(page.getByLabel("Factorio executable")).toHaveValue(customBin);

  // reset: field empties, placeholder shows the probed default, config key drops
  await page.getByRole("button", { name: "Use platform defaults" }).click();
  const cleared = page.getByLabel("Factorio executable");
  await expect(cleared).toHaveValue("");
  await expect(cleared).toHaveAttribute("placeholder", /factorio/i);
  await expect.poll(() => readConfig().factorioBin).toBeUndefined();
});
