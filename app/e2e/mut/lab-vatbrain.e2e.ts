import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, goto, uniqueName } from "./helpers";

/**
 * A science-consumer row, driven through the UI rather than the server API.
 *
 * Pyanodons' lab has ZERO module slots and accepts only the `vatbrain` module
 * category, so every affordance here sits on a path a slots-based gate had
 * closed: the row chip renders only because a beacon can reach a machine with no
 * slots of its own, and "+ Add" enables only because the beacon carrying
 * vatbrains reads as reachable. Server-level tests cover the arithmetic and can
 * see none of that, which is how a dead button shipped.
 *
 * The block is seeded directly so the spec exercises the modules dialog rather
 * than the goal/recipe-picker flow, and skips when the project predates the
 * research recipes (they appear only after a sync on a build that makes them).
 */
test("a lab row offers a vatbrain beacon despite having no module slots", async ({ page }) => {
  const file = activeProjectDbFile();
  const db = new DatabaseSync(file);
  const hasRecipe = db
    .prepare("SELECT name FROM recipes WHERE name = 'research-automation-science-pack'")
    .get();
  const name = uniqueName("Science consumer");
  let id: number | undefined;
  if (hasRecipe) {
    db.prepare("INSERT INTO blocks (name, data) VALUES (?, ?)").run(
      name,
      JSON.stringify({
        goals: [{ name: "pyops-research-automation-science-pack", rate: 40 / 60 }],
        recipes: ["research-automation-science-pack"],
        machines: { "research-automation-science-pack": "lab" },
      }),
    );
    id = (db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
  }
  db.close();
  test.skip(!hasRecipe, "project predates the research recipes — needs a data sync");

  try {
    await goto(page, `/block/${id}`);

    // The chip must exist even though the lab has no module slots: it is the only
    // route into the picker, and a beacon is the lab's one possible modifier.
    const chip = page.locator(
      'button[title*="click to configure"], button[title*="a beacon can reach it"]',
    );
    await expect(chip).toHaveCount(1);
    await chip.click();

    const modal = page.getByRole("dialog", { name: /^Modules — / });
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("No module slots");
    // …and no palette under it: a lab holds no modules of its own, so offering
    // vatbrains there would read as "put one in the lab".
    await expect(modal.locator('button[title^="Vatbrain MK"]')).toHaveCount(0);

    // The whole feature hangs off this being live rather than greyed out.
    const add = modal.getByRole("button", { name: "+ Add" });
    await expect(add).toBeVisible();
    await expect(add).not.toHaveAttribute("aria-disabled", "true");
    await add.click();

    // Only NOW do vatbrains appear — inside the beacon, the one place they can
    // actually go. A lab accepts no other category, so no speed module either.
    await expect(modal.locator('button[title^="Vatbrain MK"]').first()).toBeVisible();
    await expect(modal.locator('button[title^="Speed module ·"]')).toHaveCount(0);
  } finally {
    if (id != null) {
      const cleanup = new DatabaseSync(file);
      cleanup.prepare("DELETE FROM blocks WHERE id = ?").run(id);
      cleanup.close();
    }
  }
});
