import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, goto, uniqueName } from "./helpers";

test("keyboard focus on a balance chip opens its item card", async ({ page }) => {
  const db = new DatabaseSync(activeProjectDbFile());
  let id: number;
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const inserted = db
      .prepare("INSERT INTO blocks (name, data) VALUES (?, ?)")
      .run(
        uniqueName("Hover card focus"),
        JSON.stringify({ recipes: [], goals: [{ name: "iron-plate", rate: 1 }] }),
      );
    id = Number(inserted.lastInsertRowid);
  } finally {
    db.close();
  }

  await goto(page, `/block/${id}`);
  const chip = page.getByRole("button", { name: "Iron plate · Target", exact: true });
  const card = page.locator("[data-hover-card]");

  // Tab onto the chip from its neighbour so the browser treats it as keyboard focus.
  await chip.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(chip).toBeFocused();
  await expect(card).toContainText("Iron plate");

  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();

  // Enter still opens the recipe picker, as a click does.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(card).toBeHidden();
});
