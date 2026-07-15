import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, goto, uniqueName } from "./helpers";

test("probabilistic recipe products show their chance and solve from expected yield", async ({
  page,
}) => {
  const data = {
    recipes: ["kicalk-mk04-breeder"],
    goals: [{ name: "kicalk-mk04", rate: 1 }],
    machines: { "kicalk-mk04-breeder": "kicalk-plantation-mk01" },
  };
  const db = new DatabaseSync(activeProjectDbFile());
  let id: number;
  try {
    const inserted = db
      .prepare("INSERT INTO blocks (name, data) VALUES (?, ?)")
      .run(uniqueName("Probabilistic kicalk"), JSON.stringify(data));
    id = Number(inserted.lastInsertRowid);
  } finally {
    db.close();
  }

  await goto(page, `/block/${id}`);
  const row = page.locator('[data-recipe-row="kicalk-mk04-breeder"]');
  await expect(row).toContainText("0.16/s");

  const optionalMk04 = row.getByRole("button", {
    name: /^Kicalk MK 04 0\.19\/s · 40% chance/,
  });
  await expect(optionalMk04).toBeVisible();
  await expect(optionalMk04.locator("[data-product-probability]")).toHaveText("40%");

  await optionalMk04.hover();
  await expect(page.getByText("40% chance per craft", { exact: true })).toBeVisible();
  await expect(page.getByText("3 on success · 1.2 expected per craft", { exact: true })).toBeVisible();

  await row.getByLabel("Variable recipe results").hover();
  const variableResult = page.getByText(
    /Kicalk MK 04: 3 on success · 40% chance · 1.2 expected\/craft/,
  );
  await expect(variableResult).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(variableResult).toBeHidden();
  await row.getByText("Grow kicalk gen 4", { exact: true }).hover();
  const recipeCard = page.getByText("kicalk-mk04-breeder", { exact: true }).locator("..");
  await expect(recipeCard.getByText("40% chance", { exact: false }).first()).toBeVisible();
});
