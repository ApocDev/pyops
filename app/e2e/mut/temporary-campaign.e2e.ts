import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, addGoal, createBlock, expectUndoTop } from "./helpers";

test("temporary campaign derives a finite target and can be completed and reactivated", async ({
  page,
}) => {
  const id = await createBlock(page);
  await addGoal(page, "iron plate", "Iron plate");

  await page.locator('button[aria-label^="Add a recipe that makes "]').click();
  const recipePicker = page.getByRole("dialog", { name: /Recipes that make/ });
  await recipePicker.locator('[data-recipe-candidate="iron-plate"]').click();
  await expect(recipePicker).toBeHidden();

  await page.getByRole("button", { name: "Make this block temporary", exact: true }).click();
  const quantity = page.getByRole("button", { name: "Make 3,600", exact: true });
  await expect(quantity).toBeVisible();
  await quantity.click();
  const quantityInput = page.locator('input[inputmode="decimal"]:focus');
  await quantityInput.fill("5");
  await quantityInput.press("Enter");

  const durationUnit = page.getByTitle(
    "Campaign duration unit — click to cycle seconds / minutes / hours",
  );
  await expect(durationUnit).toHaveText("h");
  await durationUnit.click();
  await expect(durationUnit).toHaveText("s");
  await durationUnit.click();
  await expect(durationUnit).toHaveText("min");
  const duration = page.getByRole("textbox", { name: "Campaign duration" });
  await duration.fill("30");
  await duration.press("Enter");

  const ironImport = page.getByRole("button", { name: /^Iron ore 40 total/ });
  await expect(ironImport).toBeVisible();
  await expect(ironImport.locator("[data-campaign-rate]")).toHaveText("0.022/s");
  const balance = page.locator('[data-slot="card"]').filter({ hasText: "Block balance" });
  await expect(balance.getByText(/^avg /)).toHaveCount(0);
  await expect(balance.getByText("<0.01", { exact: true }).first()).toBeVisible();

  await page.getByRole("combobox", { name: "Campaign confidence" }).click();
  await page.getByRole("option", { name: "90% confidence" }).click();
  const goal = page.locator('[data-goal="iron-plate"]');
  await expect(goal).toContainText(/Make 5/);
  await expect(goal).not.toContainText(/plan |\/s/);
  await expectUndoTop(page, /Set campaign confidence|Edit block/);

  await page.getByRole("button", { name: "Complete temporary campaign", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Reactivate temporary campaign", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /removed from factory planning/ })).toBeVisible();

  const completedDb = new DatabaseSync(activeProjectDbFile(), { readOnly: true });
  try {
    const row = completedDb.prepare("SELECT enabled, data FROM blocks WHERE id = ?").get(id) as {
      enabled: number;
      data: string;
    };
    const data = JSON.parse(row.data) as {
      campaign?: { completedAt?: string; duration?: number };
    };
    expect(row.enabled).toBe(0);
    expect(data.campaign?.duration).toBe(1800);
    expect(data.campaign?.completedAt).toBeTruthy();
  } finally {
    completedDb.close();
  }

  await page
    .getByRole("button", { name: "Reactivate temporary campaign", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Complete temporary campaign", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /campaign reactivated/ })).toBeVisible();

  const activeDb = new DatabaseSync(activeProjectDbFile(), { readOnly: true });
  try {
    const row = activeDb.prepare("SELECT enabled, data FROM blocks WHERE id = ?").get(id) as {
      enabled: number;
      data: string;
    };
    const data = JSON.parse(row.data) as { campaign?: { completedAt?: string } };
    expect(row.enabled).toBe(1);
    expect(data.campaign?.completedAt).toBeUndefined();
  } finally {
    activeDb.close();
  }
});
