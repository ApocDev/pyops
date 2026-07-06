/**
 * `logisticsFor` (#126): the agent tool wrapper around `logisticsForGood` —
 * belts/inserters/loaders to move ONE good at ONE rate, gated to entities
 * unlocked under the research horizon. The query-layer test
 * (`db/queries.test.ts`'s `logisticsForGood` describe block) already covers
 * the gating/math in detail, so this only asserts the tool wires through
 * correctly and both short-circuit branches (fluid, unknown good).
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "../db/index.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { logisticsFor } from "./agent-tools.server.ts";

const call = async (good: string, rate: number) =>
  logisticsFor.execute!({ good, rate }, { toolCallId: "test", messages: [] });

describe("logisticsFor tool (#126)", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    fx.db.exec(`
      INSERT INTO items (name, display) VALUES ('iron-plate','Iron plate'),('transport-belt','Transport belt'),('inserter','Inserter');
      INSERT INTO belts (name, display, speed) VALUES ('transport-belt','Transport belt',0.03125);
      INSERT INTO inserters (name, display, rotation_speed, extension_speed, pickup_x, pickup_y, drop_x, drop_y, bulk, base_stack_bonus, max_belt_stack_size)
        VALUES ('inserter','Inserter',0.02,0.035,0,-1,0,1.19921875,0,0,1);
      INSERT INTO recipes (name, kind, category, energy_required, enabled, hidden) VALUES
        ('craft-transport-belt','real','crafting',0.5,1,0),
        ('craft-inserter','real','crafting',0.5,1,0);
      INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
        ('craft-transport-belt',0,'item','transport-belt',1),
        ('craft-inserter',0,'item','inserter',1);
      INSERT INTO fluids (name, display) VALUES ('molten-iron','Molten iron');
    `);
    fx.db.close();
    switchDatabase(fx.file);
  });

  afterEach(() => fx.cleanup());

  it("returns belt + inserter counts for an item", async () => {
    const r = (await call("iron-plate", 22.5)) as any;
    expect(r.kind).toBe("item");
    expect(r.belts[0].belt).toBe("transport-belt");
    expect(r.belts[0].count).toBe(2);
    expect(r.inserters[0].inserter).toBe("inserter");
  });

  it("short-circuits a fluid to a note", async () => {
    const r = (await call("molten-iron", 10)) as any;
    expect(r.kind).toBe("fluid");
    expect(r.note).toMatch(/pipe/i);
  });

  it("errors on an unknown good", async () => {
    const r = (await call("no-such-good", 5)) as any;
    expect(r.error).toMatch(/no good/);
  });
});
