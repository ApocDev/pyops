import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { MUT_DATA_DIR, goto, uniqueName } from "./helpers";

/**
 * The project-create dialog: reachable from the switcher, guarded against
 * empty names, cancellable, and actually creating a project — a new db file
 * in the (scratch) data dir — landing on the game-data sync tab. The test
 * switches back to the original project afterwards, since creating one also
 * activates it (server-wide).
 */

const switcher = (page: Page) => page.locator('nav button[title^="project:"]');
const dialog = (page: Page) => page.getByRole("dialog", { name: "New project" });

const openDialog = async (page: Page) => {
  // Retrying, because right after the create dialog closes the radix dropdown
  // can dismiss itself mid-click (exit animation + focus restore) — re-driving
  // the trigger is what a user would do too.
  await expect(async () => {
    if (!(await dialog(page).isVisible())) {
      await switcher(page).click();
      await page.getByRole("menuitem", { name: "new project" }).click({ timeout: 2_000 });
    }
    await expect(dialog(page)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
};

const scratchDbs = () =>
  readdirSync(join(MUT_DATA_DIR, "projects")).filter((f) => f.endsWith(".db"));

// Creating a project also ACTIVATES it, server-wide — so if this spec dies
// mid-test, every later spec would run against the empty new project. This
// safety net always switches back to whatever was active when the test began.
let restoreTo: string | null = null;
test.afterEach(async ({ page }) => {
  if (!restoreTo) return;
  await goto(page, "/");
  await expect(switcher(page)).not.toContainText("…");
  if ((await switcher(page).textContent())?.trim() !== restoreTo) {
    await switcher(page).click();
    await page
      .getByRole("menuitem")
      .filter({ has: page.getByText(restoreTo, { exact: true }) })
      .click();
  }
  await expect(switcher(page)).toContainText(restoreTo);
  restoreTo = null;
});

test("new-project dialog: guarded create, Escape cancels, creating lands on the data tab", async ({
  page,
}) => {
  await goto(page, "/");
  // the switcher shows "…" until the project list loads — wait it out
  await expect(switcher(page)).not.toContainText("…");
  const originalName = (await switcher(page).textContent())?.trim() ?? "";
  expect(originalName).not.toBe("");
  restoreTo = originalName;

  // create is disabled on an empty and on a whitespace-only name
  await openDialog(page);
  const create = dialog(page).getByRole("button", { name: "Create project" });
  await expect(create).toBeDisabled();
  await dialog(page).getByLabel("Name").fill("   ");
  await expect(create).toBeDisabled();

  // Escape cancels
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();

  // actually create one — it writes a fresh db into the scratch data dir and
  // lands on Settings › Game data (the first stop for an empty project)
  const before = scratchDbs();
  const name = uniqueName("e2e proj");
  await openDialog(page);
  await dialog(page).getByLabel("Name").fill(name);
  await create.click();
  await page.waitForURL(/\/settings\?tab=data$/);
  await expect(page.getByRole("button", { name: "Game data", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // creating also switched to it…
  await expect(switcher(page)).toContainText(name);
  // …and its database file exists in the scratch dir
  const added = scratchDbs().filter((f) => !before.includes(f));
  expect(added).toHaveLength(1);

  // switch back so later specs keep running against the seeded project
  await switcher(page).click();
  await page
    .getByRole("menuitem")
    .filter({ has: page.getByText(originalName, { exact: true }) })
    .click();
  await expect(switcher(page)).toContainText(originalName);
});
