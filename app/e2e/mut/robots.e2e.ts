import { expect, test, type Page } from "@playwright/test";
import { expectUndoTop, goto, insertBlock, uniqueName, withDb } from "./helpers";

// The Logistics dialog's robot prefs are project-wide; put them back afterwards.
const ROBOT_PREFS = [
  "logistics_show_robots",
  "logistics_robot",
  "logistics_roboport",
  "logistics_robot_distance",
];
test.afterEach(() =>
  withDb((db) => {
    for (const key of ROBOT_PREFS) db.prepare("DELETE FROM meta WHERE key = ?").run(key);
  }),
);

const strip = (page: Page) => page.locator("[data-robot-strip]");
const total = async (page: Page) =>
  Number(await strip(page).locator("[data-robot-total]").textContent());

async function openLogistics(page: Page) {
  await page.getByRole("button", { name: /^Logistics/ }).click();
  return page.getByRole("dialog", { name: "Logistics throughput" });
}

test("robot counts follow the factory distance and a block's override", async ({ page }) => {
  const id = insertBlock(uniqueName("Robots"), {
    goals: [{ name: "small-parts-01", rate: 1 }],
    recipes: ["small-parts-01"],
  });
  await goto(page, `/block/${id}`);
  await expect(page.getByText("Solved", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(strip(page)).toBeHidden();

  // Factory-wide: turn robots on, pick MK 01 bots charging at a MK 01 roboport,
  // and set a 60-tile trip.
  let logistics = await openLogistics(page);
  await logistics.getByRole("switch", { name: "Robots" }).click();
  await logistics.getByRole("button", { name: "Logistic pynobot MK 01" }).click();
  await logistics.getByRole("button", { name: "Py roboport MK 01" }).click();
  const distance = logistics.getByLabel("Robot trip distance");
  await distance.fill("60");
  await distance.press("Enter");
  await page.keyboard.press("Escape");
  await expect(logistics).toBeHidden();

  // The block total and a count under every boundary item chip
  await expect(strip(page)).toContainText("· 60 tiles");
  const at60 = await total(page);
  expect(at60).toBeGreaterThan(0);
  await expect(page.locator("[data-robots]").first()).toBeVisible();

  // A longer factory trip needs more bots.
  logistics = await openLogistics(page);
  await logistics.getByLabel("Robot trip distance").fill("120");
  await logistics.getByLabel("Robot trip distance").press("Enter");
  await page.keyboard.press("Escape");
  await expect(strip(page)).toContainText("· 120 tiles");
  const at120 = await total(page);
  expect(at120).toBeGreaterThan(at60);

  // Override this block's distance; it saves with the block and survives a reload.
  await strip(page).getByRole("button", { name: "Set distance" }).click();
  const blockDistance = strip(page).getByLabel("Block robot trip distance");
  await blockDistance.fill("240");
  await blockDistance.press("Enter");
  await expectUndoTop(page, /Set robot trip distance to 240/);
  const at240 = await total(page);
  expect(at240).toBeGreaterThan(at120);

  await page.reload();
  await expect(strip(page).getByLabel("Block robot trip distance")).toHaveValue("240", {
    timeout: 30_000,
  });
  expect(await total(page)).toBe(at240);

  // Back to the factory default.
  await strip(page).getByRole("button", { name: "Default" }).click();
  await expect(strip(page)).toContainText("· 120 tiles");
  expect(await total(page)).toBe(at120);
});
