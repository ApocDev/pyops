import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { activeProjectDbFile, goto } from "./helpers";

test("an import is marked only while no other enabled block produces it", async ({ page }) => {
  const db = new DatabaseSync(activeProjectDbFile());
  let blockId: number;
  let item: string;
  let producerIds: number[];
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const candidate = db
      .prepare(
        `SELECT import_flow.block_id AS blockId, import_flow.item
         FROM block_flows AS import_flow
         INNER JOIN blocks AS consumer ON consumer.id = import_flow.block_id
         WHERE consumer.enabled = 1
           AND import_flow.role = 'import'
           AND EXISTS (
             SELECT 1
             FROM block_flows AS producer_flow
             INNER JOIN blocks AS producer ON producer.id = producer_flow.block_id
             WHERE producer.enabled = 1
               AND producer_flow.block_id <> import_flow.block_id
               AND producer_flow.item = import_flow.item
               AND producer_flow.role IN ('primary', 'stock', 'byproduct')
           )
         ORDER BY import_flow.block_id, import_flow.item
         LIMIT 1`,
      )
      .get() as { blockId: number; item: string } | undefined;
    expect(candidate).toBeTruthy();
    blockId = candidate!.blockId;
    item = candidate!.item;
    producerIds = (
      db
        .prepare(
          `SELECT DISTINCT producer_flow.block_id AS id
           FROM block_flows AS producer_flow
           INNER JOIN blocks AS producer ON producer.id = producer_flow.block_id
           WHERE producer.enabled = 1
             AND producer_flow.block_id <> ?
             AND producer_flow.item = ?
             AND producer_flow.role IN ('primary', 'stock', 'byproduct')`,
        )
        .all(blockId, item) as { id: number }[]
    ).map((row) => row.id);
    expect(producerIds.length).toBeGreaterThan(0);
    const disable = db.prepare("UPDATE blocks SET enabled = 0 WHERE id = ?");
    for (const id of producerIds) disable.run(id);
  } finally {
    db.close();
  }

  try {
    await goto(page, `/block/${blockId!}`);
    const marker = page.locator(`[data-unsourced-import="${item!}"]`);
    await expect(marker).toBeVisible();

    const restore = new DatabaseSync(activeProjectDbFile());
    try {
      const enable = restore.prepare("UPDATE blocks SET enabled = 1 WHERE id = ?");
      for (const id of producerIds!) enable.run(id);
    } finally {
      restore.close();
    }

    await page.reload();
    await expect(page.locator(`[data-unsourced-import="${item!}"]`)).toBeHidden();
  } finally {
    const restore = new DatabaseSync(activeProjectDbFile());
    try {
      const enable = restore.prepare("UPDATE blocks SET enabled = 1 WHERE id = ?");
      for (const id of producerIds!) enable.run(id);
    } finally {
      restore.close();
    }
  }
});
