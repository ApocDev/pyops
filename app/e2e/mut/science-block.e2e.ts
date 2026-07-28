import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, goto } from "./helpers";

/**
 * The science-consumer block, driven through the UI.
 *
 * Everything here is reachable only through real interaction: the singleton
 * button that disables itself, the per-pack rate inputs, and the technology
 * helper that writes into them. Server-level tests cover the arithmetic and can
 * see none of it.
 *
 * Skips when the project has no labs, since they arrive only with a data sync on
 * a build that imports them.
 */
const clearScienceBlocks = (file: string) => {
  const db = new DatabaseSync(file);
  const rows = db.prepare("SELECT id, data FROM blocks").all() as { id: number; data: string }[];
  for (const row of rows) {
    try {
      if (JSON.parse(row.data)?.science) db.prepare("DELETE FROM blocks WHERE id = ?").run(row.id);
    } catch {
      /* not JSON — not ours */
    }
  }
  const labs = (db.prepare("SELECT count(*) AS n FROM labs").get() as { n: number }).n;
  db.close();
  return labs > 0;
};

test("creating a science block, typing rates, and deriving them from a technology", async ({
  page,
}) => {
  const file = activeProjectDbFile();
  const hasLabs = clearScienceBlocks(file);
  test.skip(!hasLabs, "project has no lab prototypes — needs a data sync");

  try {
    await goto(page, "/block");

    // ── singleton: create once, then the button locks itself ──
    const create = page.getByRole("button", { name: /^New science block/ });
    await expect(create).toBeEnabled();
    await create.click();

    await expect(page.getByRole("combobox", { name: "Lab" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "This project already has its science block" }),
    ).toBeDisabled();

    // ── rates are the plan: type one directly ──
    const auto = page.getByRole("spinbutton", { name: /^Automation science pack per minute/ });
    await expect(auto).toBeVisible();
    await auto.fill("60");
    await auto.blur();

    // 60/min at the default 60 lab-seconds per pack = 60 labs — ONE pool, not one
    // pool per pack, which is the whole reason this is not a set of recipes
    await expect(page.getByTestId("science-stat-labs")).toContainText("60.00");
    await expect(page.getByTestId("science-stat-total-science")).toContainText("60.00/min");

    // ── the technology helper writes into those same fields ──
    await page.getByRole("button", { name: "Derive from a technology" }).click();
    const dialog = page.getByRole("dialog", { name: "Derive rates from a technology" });
    await expect(dialog).toBeVisible();

    await dialog.getByPlaceholder("Search technologies…").fill("acetylene");
    const tech = dialog.getByRole("button", { name: /Acetylene/ }).first();
    await expect(tech).toBeVisible();
    await tech.click();

    // a preview appears before anything is committed
    await expect(dialog.getByText(/science\/min total/)).toBeVisible();
    await dialog.getByRole("button", { name: "Use these rates" }).click();
    await expect(dialog).toBeHidden();

    // the typed 60 was replaced by the derived figure
    await expect(auto).not.toHaveValue("60");
    await expect(auto).not.toHaveValue("0");
  } finally {
    clearScienceBlocks(file);
  }
});
