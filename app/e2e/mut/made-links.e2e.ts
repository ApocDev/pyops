import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, createBlock, goto, uniqueName } from "./helpers";

/**
 * The v2 link model (#91): a good's made state is toggled from its right-click
 * menu (the made set drives the solve but is not shown in a strip — the recipe
 * rows show what's produced). A made mark with no in-block producer degrades
 * silently to an import — no warning strip (the #91 nitpick). This drives the
 * import chip's menu and asserts the good stays an import either way.
 */
test("marking an import made without a producer keeps it a silent import", async ({ page }) => {
  await createBlock(page);

  // goal: iron plate (a real Py chain); its recipe consumes iron ore, an import
  await page.locator('button[title="add a goal product"]').click();
  const goalDialog = page.getByRole("dialog", { name: "Add a goal product" });
  await goalDialog.getByPlaceholder("search an item or fluid…").fill("iron plate");
  await goalDialog.getByRole("button", { name: "Iron plate", exact: true }).first().click();
  await expect(goalDialog).toBeHidden();

  await page.locator('button[aria-label^="add a recipe that makes "]').click();
  const platePicker = page.getByRole("dialog", { name: /Recipes that make/ });
  await platePicker.locator('[data-recipe-candidate="iron-plate"]').click();
  await expect(platePicker).toBeHidden();

  const oreImport = page.getByRole("button", { name: /^Iron ore.*(raw input|craftable)/ }).first();
  await expect(oreImport).toBeVisible();

  // right-click the import → the good menu offers the made gesture
  await oreImport.click({ button: "right" });
  const markItem = page.getByRole("menuitem", {
    name: /Require in-block production|Make in this block/,
  });
  await expect(markItem).toBeVisible();
  await markItem.click();

  // no producer exists for it, so marking made is a non-event: NO "no recipe
  // yet" strip, and the good still shows as an import
  await expect(page.getByText(/no recipe yet/)).toBeHidden();
  await expect(
    page.getByRole("button", { name: /^Iron ore.*(raw input|craftable)/ }).first(),
  ).toBeVisible();

  // the menu now reads "made" — unmarking it back is available and harmless
  await page
    .getByRole("button", { name: /^Iron ore.*(raw input|craftable)/ })
    .first()
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: /click to import instead/ }),
  ).toBeVisible();
});

test("adding a coke consumer drains exported pitch and keeps a solved building count", async ({
  page,
}) => {
  // Arrange the real pre-consumer Tar chain directly in the isolated scratch
  // project. Its six recipes export 13.405 pitch/s; the browser action below is
  // the behavior under test, including the persisted drain and fresh solve.
  const data = {
    recipes: [
      "tar-refining",
      "tar-refining-tops",
      "light-oil-aromatics",
      "naphthalene-oil-creosote",
      "anthracene-gasoline-cracking",
      "carbolic-oil-creosote",
    ],
    made: [
      "anthracene-oil",
      "carbolic-oil",
      "light-oil",
      "middle-oil",
      "naphthalene-oil",
      "pitch",
    ],
    pins: [
      { kind: "drain", recipe: "tar-refining", item: "tar" },
      { kind: "drain", recipe: "tar-refining-tops", item: "middle-oil" },
      { kind: "drain", recipe: "light-oil-aromatics", item: "light-oil" },
      { kind: "drain", recipe: "naphthalene-oil-creosote", item: "naphthalene-oil" },
      { kind: "drain", recipe: "anthracene-gasoline-cracking", item: "anthracene-oil" },
      { kind: "drain", recipe: "carbolic-oil-creosote", item: "carbolic-oil" },
    ],
    machines: {
      "tar-refining": "tar-processing-unit",
      "tar-refining-tops": "tar-processing-unit",
      "light-oil-aromatics": "distilator",
      "naphthalene-oil-creosote": "tar-processing-unit",
      "anthracene-gasoline-cracking": "distilator",
      "carbolic-oil-creosote": "tar-processing-unit",
    },
    goals: [{ name: "tar", rate: -9.575 }],
  };
  const db = new DatabaseSync(activeProjectDbFile());
  let id: number;
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const inserted = db
      .prepare("INSERT INTO blocks (name, data) VALUES (?, ?)")
      .run(uniqueName("Pitch drain"), JSON.stringify(data));
    id = Number(inserted.lastInsertRowid);
  } finally {
    db.close();
  }

  await goto(page, `/block/${id}`);
  const pitch = page.getByRole("button", { name: /^Pitch 13\.4.*export/ }).first();
  await expect(pitch).toBeVisible();
  await pitch.click();

  const picker = page.getByRole("dialog", { name: /Recipes that consume Pitch/ });
  await picker.getByRole("button", { name: /^Coke/ }).click();
  await expect(picker).toBeHidden();

  // Pitch is fully consumed. The row shows a drain-routing marker—not the `%`
  // share marker—and its building count remains the ordinary solver result.
  await expect(page.getByRole("button", { name: /^Pitch .*export/ }).first()).toBeHidden();
  await expect(page.getByLabel("routes all surplus Pitch")).toBeVisible();
  await expect(page.getByLabel("routes all surplus Pitch").locator("svg")).toBeVisible();
  await expect(
    page.getByLabel("change Destructive distillation column MK 01 building").last(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "0.67", exact: true })).toBeVisible();
});

test("adding a cyclic consumer processes surplus that returns to the sink goal", async ({
  page,
}) => {
  // This is the real Ash separation -> Soot separation shape. Soot separation
  // returns a little Ash to the explicit Ash sink; selecting it from the Soot
  // export must still be the complete "process this surplus here" gesture.
  const data = {
    recipes: ["ash-separation"],
    made: [],
    pins: [{ kind: "drain", recipe: "ash-separation", item: "ash" }],
    machines: { "ash-separation": "solid-separator" },
    goals: [{ name: "ash", rate: -48.717 }],
  };
  const db = new DatabaseSync(activeProjectDbFile());
  let id: number;
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const inserted = db
      .prepare("INSERT INTO blocks (name, data) VALUES (?, ?)")
      .run(uniqueName("Ash soot cycle"), JSON.stringify(data));
    id = Number(inserted.lastInsertRowid);
  } finally {
    db.close();
  }

  await goto(page, `/block/${id}`);
  const soot = page.getByRole("button", { name: /^Soot 4\.87.*export/ }).first();
  await expect(soot).toBeVisible();
  await soot.click();

  const picker = page.getByRole("dialog", { name: /Recipes that consume Soot/ });
  await picker.getByRole("button", { name: /^Soot separation/ }).click();
  await expect(picker).toBeHidden();

  await expect(page.getByRole("button", { name: /^Soot .*export/ }).first()).toBeHidden();
  await expect(page.getByLabel("routes all surplus Soot")).toBeVisible();
  await expect(page.getByRole("button", { name: "2.56", exact: true })).toBeVisible();
});
