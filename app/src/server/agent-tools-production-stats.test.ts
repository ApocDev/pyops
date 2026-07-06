/**
 * The productionStats tool mirrors gameProduction's shape but reads the SYNCED
 * `production_stats` snapshot (works with the game closed). setProductionStats
 * always replaces the full snapshot and drops near-zero rows before inserting,
 * so once any sync has landed, a good's absence from the table means ~0 flow —
 * not "unknown". The only real unknown is whether a sync has ever landed at
 * all, tracked in `meta.stats_synced_at`/`stats_synced_count` and surfaced at
 * the batch level (not per-good) on the tool's result.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "../db/index.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { productionStats } from "./agent-tools.server.ts";

type Result = {
  syncedAt: string | null;
  syncedCount: number | null;
  stats: {
    name: string;
    display: string | null;
    kind: "item" | "fluid" | null;
    produced: number;
    consumed: number;
  }[];
};

const call = async (goods: string[]): Promise<Result> =>
  (await productionStats.execute!({ goods }, { toolCallId: "test", messages: [] })) as Result;

describe("productionStats (synced game stats)", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    fx.db.exec(`
      INSERT INTO items (name, display) VALUES
        ('iron-plate','Iron plate'), ('copper-plate','Copper plate');
      INSERT INTO fluids (name, display) VALUES
        ('sulfuric-acid','Sulfuric acid');
      INSERT INTO production_stats (name, kind, produced, consumed) VALUES
        ('iron-plate','item',12.5,10.0),
        ('sulfuric-acid','fluid',0.0,3.2);
      INSERT INTO meta (key, value) VALUES
        ('stats_synced_at','2026-07-06T12:00:00.000Z'),
        ('stats_synced_count','2');
    `);
    fx.db.close();
    switchDatabase(fx.file);
  });

  afterEach(() => fx.cleanup());

  it("returns synced actuals for a known good with nonzero flow", async () => {
    const res = await call(["iron-plate"]);
    expect(res.syncedAt).toBe("2026-07-06T12:00:00.000Z");
    expect(res.syncedCount).toBe(2);
    expect(res.stats).toEqual([
      { name: "iron-plate", display: "Iron plate", kind: "item", produced: 12.5, consumed: 10 },
    ]);
  });

  it("reports zero, not an error, for a known good absent from the snapshot", async () => {
    const res = await call(["copper-plate"]);
    expect(res.stats).toEqual([
      { name: "copper-plate", display: "Copper plate", kind: "item", produced: 0, consumed: 0 },
    ]);
  });

  it("resolves fluid kind correctly", async () => {
    const res = await call(["sulfuric-acid"]);
    expect(res.stats).toEqual([
      {
        name: "sulfuric-acid",
        display: "Sulfuric acid",
        kind: "fluid",
        produced: 0,
        consumed: 3.2,
      },
    ]);
  });

  it("returns nulls for an unknown good name", async () => {
    const res = await call(["no-such-good"]);
    expect(res.stats).toEqual([
      { name: "no-such-good", display: null, kind: null, produced: 0, consumed: 0 },
    ]);
  });

  it("handles a batch of mixed known/unknown goods in one call, preserving order", async () => {
    const res = await call(["iron-plate", "copper-plate", "sulfuric-acid", "no-such-good"]);
    expect(res.stats).toEqual([
      { name: "iron-plate", display: "Iron plate", kind: "item", produced: 12.5, consumed: 10 },
      { name: "copper-plate", display: "Copper plate", kind: "item", produced: 0, consumed: 0 },
      {
        name: "sulfuric-acid",
        display: "Sulfuric acid",
        kind: "fluid",
        produced: 0,
        consumed: 3.2,
      },
      { name: "no-such-good", display: null, kind: null, produced: 0, consumed: 0 },
    ]);
  });
});

describe("productionStats (never synced)", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    fx.db.exec(`
      INSERT INTO items (name, display) VALUES ('iron-plate','Iron plate');
      INSERT INTO production_stats (name, kind, produced, consumed) VALUES
        ('copper-plate','item',5.0,1.0);
    `);
    fx.db.close();
    switchDatabase(fx.file);
  });

  afterEach(() => fx.cleanup());

  it("reports syncedAt/syncedCount as null when no sync has ever landed, while stats still resolve to zero", async () => {
    const res = await call(["iron-plate"]);
    expect(res.syncedAt).toBeNull();
    expect(res.syncedCount).toBeNull();
    expect(res.stats).toEqual([
      { name: "iron-plate", display: "Iron plate", kind: "item", produced: 0, consumed: 0 },
    ]);
  });
});
