import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, goto } from "./helpers";

type MachineRow = { block_id: number; machine: string; recipe: string; count: number };
type BuiltRow = { name: string; recipe: string; count: number };

test("Home moves an operating block from unbuilt to partial recipe coverage", async ({ page }) => {
  await goto(page, "/"); // settle any stale cached projections before the direct arrangement
  const file = activeProjectDbFile();
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout = 5000");
  const originalMachines = db
    .prepare("SELECT block_id, machine, recipe, count FROM block_machines")
    .all() as MachineRow[];
  const originalBuilt = db
    .prepare("SELECT name, recipe, count FROM built_machines")
    .all() as BuiltRow[];
  const originalBuiltSync = db
    .prepare("SELECT value FROM meta WHERE key = 'built_synced_at'")
    .get() as { value: string | null } | undefined;
  const originalStatsSync = db
    .prepare("SELECT value FROM meta WHERE key = 'stats_synced_at'")
    .get() as { value: string | null } | undefined;
  const originalDismissed = db
    .prepare("SELECT value FROM meta WHERE key = 'home_dismissed_actions'")
    .get() as { value: string | null } | undefined;
  const target = db
    .prepare("SELECT id, name FROM blocks WHERE enabled = 1 ORDER BY sort_order, name LIMIT 1")
    .get() as { id: number; name: string };
  const machine = db
    .prepare(
      "SELECT name FROM crafting_machines WHERE kind IN ('assembling-machine','furnace','rocket-silo','mining-drill') ORDER BY name LIMIT 1",
    )
    .get() as { name: string };
  const recipes = [`pyops-e2e-home-a-${target.id}`, `pyops-e2e-home-b-${target.id}`];
  try {
    db.exec("BEGIN");
    db.exec("DELETE FROM block_machines; DELETE FROM built_machines;");
    const insertRequired = db.prepare(
      "INSERT INTO block_machines (block_id, machine, recipe, count) VALUES (?, ?, ?, 10)",
    );
    for (const recipe of recipes) insertRequired.run(target.id, machine.name, recipe);
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('built_synced_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(new Date().toISOString());
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('stats_synced_at', '2000-01-01T00:00:00.000Z') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run();
    db.prepare("DELETE FROM meta WHERE key = 'home_dismissed_actions'").run();
    db.exec("COMMIT");
    db.close();

    await page.reload();
    const action = page.locator("[data-home-action]");
    await expect(action).toHaveAttribute("data-home-action", "unbuilt");
    await expect(action).toContainText(`Start ${target.name}`);
    await expect(action).toContainText("2 required steps");

    await action.getByRole("button", { name: "Dismiss for now" }).click();
    await expect(action).not.toContainText(`Start ${target.name}`);
    const restoreDismissed = action.getByRole("button", { name: "Restore 1 dismissed" });
    await expect(restoreDismissed).toBeVisible();
    await restoreDismissed.click();
    await expect(action).toContainText(`Start ${target.name}`);

    const partial = new DatabaseSync(file);
    partial.exec("PRAGMA busy_timeout = 5000");
    partial
      .prepare("INSERT INTO built_machines (name, recipe, count) VALUES (?, ?, 1)")
      .run(machine.name, recipes[0]);
    partial.close();

    await page.reload();
    await expect(action).toHaveAttribute("data-home-action", "partial");
    await expect(action).toContainText(`Finish ${target.name}`);
    await expect(action).toContainText("1 of 2 required steps");
  } finally {
    const restore = new DatabaseSync(file);
    restore.exec("PRAGMA busy_timeout = 5000; BEGIN; DELETE FROM block_machines; DELETE FROM built_machines;");
    const insertMachine = restore.prepare(
      "INSERT INTO block_machines (block_id, machine, recipe, count) VALUES (?, ?, ?, ?)",
    );
    for (const row of originalMachines)
      insertMachine.run(row.block_id, row.machine, row.recipe, row.count);
    const insertBuilt = restore.prepare(
      "INSERT INTO built_machines (name, recipe, count) VALUES (?, ?, ?)",
    );
    for (const row of originalBuilt) insertBuilt.run(row.name, row.recipe, row.count);
    const restoreMeta = (key: string, original: { value: string | null } | undefined) => {
      if (original)
        restore
          .prepare(
            "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          )
          .run(key, original.value);
      else restore.prepare("DELETE FROM meta WHERE key = ?").run(key);
    };
    restoreMeta("built_synced_at", originalBuiltSync);
    restoreMeta("stats_synced_at", originalStatsSync);
    restoreMeta("home_dismissed_actions", originalDismissed);
    restore.exec("COMMIT");
    restore.close();
  }
});
