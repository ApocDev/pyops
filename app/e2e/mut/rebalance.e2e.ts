import { DatabaseSync } from "node:sqlite";
import { expect, type Page, test } from "@playwright/test";
import { activeProjectDbFile, goto, toast, undoButton, uniqueName } from "./helpers";

async function dismissDataDriftPrompt(page: Page) {
  const ignore = page.getByRole("button", { name: "Ignore for now" });
  try {
    await expect(ignore).toBeVisible({ timeout: 2_000 });
    await ignore.click();
  } catch {
    // Most seeded runs match the installed mods and have no prompt.
  }
}

test("factory pins can add and persist a consumption target", async ({ page }) => {
  await goto(page, "/factory/scenario");
  await dismissDataDriftPrompt(page);

  await page.getByRole("button", { name: "Pin good" }).click();
  const dialog = page.getByRole("dialog", { name: "Add factory pin" });
  await dialog.getByPlaceholder("search an item or fluid…").fill("acetaldehyde");
  await dialog.getByRole("button", { name: "Acetaldehyde", exact: true }).click();

  const input = page.getByRole("spinbutton", { name: "Acetaldehyde factory pin" });
  await expect(input).toBeVisible();
  await input.fill("-2");
  await input.blur();
  await expect(input).toHaveValue("-2");
  await expect
    .poll(() => {
      const db = new DatabaseSync(activeProjectDbFile(), { readOnly: true });
      try {
        const row = db.prepare("SELECT value FROM meta WHERE key = 'factory_pins_v1'").get() as
          | { value: string }
          | undefined;
        return row?.value ?? "";
      } finally {
        db.close();
      }
    })
    .toContain('"rate":-2');

  await page.reload();
  const persisted = page.getByRole("spinbutton", { name: "Acetaldehyde factory pin" });
  await expect(persisted).toHaveValue("-2");
  await page.getByRole("button", { name: "Remove Acetaldehyde factory pin" }).click();
  await expect(persisted).toBeHidden();
});

test("what-if target stays editable while the factory re-solves", async ({ page }) => {
  await goto(page, "/factory/scenario");
  await dismissDataDriftPrompt(page);

  const firstDemand = page.getByRole("spinbutton").first();
  await expect(firstDemand).toBeVisible();
  await firstDemand.selectText();
  await firstDemand.pressSequentially("12.34", { delay: 100 });

  // Each character starts another solve. The demand list must remain mounted,
  // preserving both the in-progress value and keyboard focus throughout them.
  await expect(firstDemand).toBeFocused();
  await expect(firstDemand).toHaveValue("12.34");
  await expect(page.getByText("Goal changes", { exact: false }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(firstDemand).toBeFocused();
  await expect(firstDemand).toHaveValue("12.34");
});

/**
 * Applying a Scenario target: overriding a final product's target surfaces the
 * per-block changes, and Apply scenario commits every one of them
 * in a single undoable step. Drives the real flow end-to-end against the isolated
 * mut server, then undoes the factory-wide change so the shared scratch db is left
 * as it was.
 *
 * A change only shows when a block's scale is off by more than the ~1% "balanced"
 * floor (rounding), so the test forces a genuine change by DOUBLING a demand — far
 * above the floor — rather than depending on the seed happening to be imbalanced.
 */
test("applying a scenario re-balances the factory in one undoable step", async ({ page }) => {
  // applying + undoing a whole-factory re-balance re-solves every touched block, so
  // give the round trips generous room over the default per-test budget
  test.setTimeout(120_000);
  await goto(page, "/factory/scenario");
  await dismissDataDriftPrompt(page);

  // the Factory pins card is the first place with numeric (spinbutton) inputs
  const firstDemand = page.getByRole("spinbutton").first();
  await expect(firstDemand).toBeVisible();
  const current = Number(await firstDemand.inputValue());
  // 2× + 1 guarantees a real increase even if the current target reads 0
  await firstDemand.fill(String(current * 2 + 1));

  // the doubled demand cascades into real per-block changes → Apply scenario enables
  const applyAll = page.getByRole("button", { name: "Apply scenario" });
  await expect(applyAll).toBeEnabled({ timeout: 15_000 });
  await applyAll.click();

  // confirm dialog summarizes the change; commit it
  const dialog = page.getByRole("dialog", { name: /Apply this factory scenario/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^Apply \d+ change/ }).click();
  // the apply iterates the solve to convergence across every touched block, so the
  // dialog can sit in its "applying…" state for a while before it closes
  await expect(dialog).toBeHidden({ timeout: 45_000 });

  // the whole batch reports as one undoable action. The success toast is brief
  // and can expire while the final query invalidations settle; the undo label is
  // the durable proof that the write completed.
  await expect(undoButton(page)).toHaveAccessibleName(/Undo: Balance pinned factory/, {
    timeout: 15_000,
  });
  await expect(page.getByText("Goal changes (0)", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  // one undo reverts this whole batch, leaving the shared scratch db as it was.
  // Assert the undo RAN via its toast rather than that the label clears — the seed
  // is a copy of the live project and may already carry an unrelated
  // earlier factory action, so the label needn't return to something else.
  await expect(undoButton(page)).toBeEnabled();
  await undoButton(page).click();
  await expect(toast(page, /Undid: Balance pinned factory/)).toBeVisible({ timeout: 30_000 });
});

test("Scenario zeros an unpinned consume goal without saving the preview", async ({ page }) => {
  test.setTimeout(120_000);
  // Resolve the copied project's existing projections before inserting the two
  // self-contained test blocks and their cached factory boundary flows.
  await goto(page, "/factory/scenario");
  await dismissDataDriftPrompt(page);

  const sourceName = uniqueName("Acetaldehyde surplus");
  const sinkName = uniqueName("Secondary sink");
  const db = new DatabaseSync(activeProjectDbFile());
  let sourceId: number;
  let sinkId: number;
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    sourceId = Number(
      db
        .prepare("INSERT INTO blocks (name, data, solve_status) VALUES (?, ?, 'solved')")
        .run(
          sourceName,
          JSON.stringify({ goals: [{ name: "water", rate: 1 }], recipes: [] }),
        ).lastInsertRowid,
    );
    sinkId = Number(
      db
        .prepare("INSERT INTO blocks (name, data, solve_status) VALUES (?, ?, 'solved')")
        .run(
          sinkName,
          JSON.stringify({
            goals: [
              { name: "water", rate: -1 },
              { name: "acetaldehyde", rate: -2 },
            ],
            recipes: ["spoil-acetaldehyde"],
          }),
        ).lastInsertRowid,
    );
    const insertFlow = db.prepare(
      "INSERT INTO block_flows (block_id, item, kind, role, rate) VALUES (?, ?, ?, ?, ?)",
    );
    insertFlow.run(sourceId, "acetaldehyde", "item", "byproduct", 10);
    insertFlow.run(sinkId, "acetaldehyde", "item", "import", 2);
  } finally {
    db.close();
  }

  try {
    await goto(page, "/factory/scenario");
    const change = page.getByRole("link", { name: /^Acetaldehyde / });
    await expect(change).toContainText("-2");
    await expect(change).toContainText("next goal/s0");

    const saved = new DatabaseSync(activeProjectDbFile(), { readOnly: true });
    try {
      const row = saved.prepare("SELECT data FROM blocks WHERE id = ?").get(sinkId) as {
        data: string;
      };
      const doc = JSON.parse(row.data) as { goals: { name: string; rate: number }[] };
      expect(doc.goals.find((goal) => goal.name === "acetaldehyde")?.rate).toBe(-2);
      expect(doc.goals.find((goal) => goal.name === "water")?.rate).toBe(-1);
    } finally {
      saved.close();
    }
  } finally {
    const cleanup = new DatabaseSync(activeProjectDbFile());
    try {
      cleanup.exec("PRAGMA busy_timeout = 5000");
      cleanup.prepare("DELETE FROM block_flows WHERE block_id IN (?, ?)").run(sourceId, sinkId);
      cleanup.prepare("DELETE FROM block_machines WHERE block_id IN (?, ?)").run(sourceId, sinkId);
      cleanup.prepare("DELETE FROM blocks WHERE id IN (?, ?)").run(sourceId, sinkId);
    } finally {
      cleanup.close();
    }
  }
});

test("Scenario scales a goal beyond recovered coproduct supply", async ({ page }) => {
  test.setTimeout(120_000);
  const db = new DatabaseSync(activeProjectDbFile());
  const pins = db.prepare("SELECT value FROM meta WHERE key = 'factory_pins_v1'").get() as
    | { value: string }
    | undefined;
  const coalGas = db.prepare("SELECT 1 FROM blocks WHERE id = 83").get();
  if (!coalGas) {
    db.close();
    throw new Error("seed is missing the Coal gas material-conflict fixture (block 83)");
  }
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('factory_pins_v1', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(
    JSON.stringify([
      { good: "automation-science-pack", kind: "item", rate: 1.5 },
      { good: "py-science-pack-1", kind: "item", rate: 1 },
    ]),
  );
  db.close();

  try {
    await goto(page, "/factory/scenario");
    await dismissDataDriftPrompt(page);

    await expect(page.getByRole("link", { name: /^Creosote / })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("scenario-validation")).toBeHidden();
    await expect(page.getByRole("button", { name: "Balance factory" })).toBeEnabled();
  } finally {
    const cleanup = new DatabaseSync(activeProjectDbFile());
    if (pins)
      cleanup
        .prepare("UPDATE meta SET value = ? WHERE key = 'factory_pins_v1'")
        .run(pins.value);
    else cleanup.prepare("DELETE FROM meta WHERE key = 'factory_pins_v1'").run();
    cleanup.close();
  }
});

test("Scenario explains which proposed block goals failed validation", async ({ page }) => {
  test.setTimeout(120_000);
  const db = new DatabaseSync(activeProjectDbFile());
  const row = db.prepare("SELECT data FROM blocks WHERE id = 83").get() as
    | { data: string }
    | undefined;
  if (!row) {
    db.close();
    throw new Error("seed is missing the Coal gas validation fixture (block 83)");
  }
  const original = row.data;
  const doc = JSON.parse(original) as {
    pins?: { kind: string; recipe: string; count?: number }[];
  };
  doc.pins = [
    ...(doc.pins ?? []).filter((pin) => pin.recipe !== "distilled-raw-coal"),
    { kind: "cap", recipe: "distilled-raw-coal", count: 1 },
  ];
  db.prepare("UPDATE blocks SET data = ? WHERE id = 83").run(JSON.stringify(doc));
  db.close();

  try {
    await goto(page, "/factory/scenario");
    await dismissDataDriftPrompt(page);

    const diagnostic = page.getByTestId("scenario-validation");
    await expect(diagnostic.getByText("Scenario validation failed")).toBeVisible({
      timeout: 60_000,
    });
    await expect(diagnostic.getByRole("link", { name: "Coal gas" })).toBeVisible();
    await expect(diagnostic.getByText("block solve: infeasible")).toBeVisible();
    await expect(diagnostic.getByText("Proposed goals on validation pass")).toBeVisible();
    await expect(diagnostic.getByText("Coke")).toBeVisible();
  } finally {
    const cleanup = new DatabaseSync(activeProjectDbFile());
    cleanup.prepare("UPDATE blocks SET data = ? WHERE id = 83").run(original);
    cleanup.close();
  }
});
