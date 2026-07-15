import { expect, test } from "@playwright/test";
import { addGoal, createBlock } from "./helpers";

/**
 * The right-click context menu rides the Radix `DropdownMenu` primitive
 * (#81/#86): opening one gives a real `role="menu"` with focus containment,
 * and — the daily papercut this fixes — Escape and outside-click both dismiss
 * it. Exercised on a block goal cell (the GoalMenu), the shared shell all the
 * block menus share (`components/context-menu.tsx`).
 */
test("a good's context menu opens as a role=menu and dismisses on Escape / outside click", async ({
  page,
}) => {
  await createBlock(page);
  await addGoal(page); // goal: Iron plate

  // the goal cell wraps the goal's icon+rate; right-click opens the GoalMenu
  const goalCell = page
    .locator('button[aria-label^="Add a recipe that makes "]')
    .first();
  await expect(goalCell).toBeVisible();
  await goalCell.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const changeItem = page.getByRole("menuitem", { name: "Change item" });
  await expect(changeItem).toBeVisible();

  // Escape closes it (the win over the old hand-rolled backdrop)
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // reopen, then an outside click also dismisses
  await goalCell.click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.getByRole("menu")).toBeHidden();
});
