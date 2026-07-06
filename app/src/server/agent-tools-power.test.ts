/**
 * Factory-wide electric power rollup (#129): factoryPower sums each enabled
 * block's cached consumption (electricityW) and its net production of the
 * pyops-electricity pseudo-good (block_flows, producer-end roles only — never
 * "import") — the same data every solved block already caches, no re-solve.
 *
 * Fixture: a pure consumer block (Iron mall, 5MW draw, no generation), a pure
 * generator block (Turbine farm, 0 draw, 50MW declared net export via role
 * "primary"), a MIXED block (Reactor, 3MW internal draw AND 100MW net export
 * via role "byproduct" — proving demand/generation are independent, not
 * netted per block), and a DISABLED block with a huge draw that must be
 * excluded entirely from the rollup.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "../db/index.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { factoryPower } from "./agent-tools.server.ts";

type Rollup = {
  blocks: number;
  totalDemandW: number;
  totalGenerationW: number;
  netW: number;
  topConsumers: { blockId: number; name: string; watts: number }[];
  generators: { blockId: number; name: string; watts: number }[];
};

const run = async (limit?: number): Promise<Rollup> =>
  (await factoryPower.execute!(
    { limit: limit ?? 10 },
    { toolCallId: "test", messages: [] },
  )) as Rollup;

describe("factoryPower (#129)", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    fx.db.exec(`
      INSERT INTO blocks (id, name, data, enabled, electricity_w) VALUES
        (1,'Iron mall','{"goals":[],"recipes":[]}',1,5000000),
        (2,'Turbine farm','{"goals":[],"recipes":[]}',1,0),
        (3,'Reactor','{"goals":[],"recipes":[]}',1,3000000),
        (4,'Disabled smelter','{"goals":[],"recipes":[]}',0,999000000);
      INSERT INTO block_flows (block_id, item, kind, role, rate) VALUES
        (1,'pyops-electricity','fluid','import',5),
        (2,'pyops-electricity','fluid','primary',50),
        (3,'pyops-electricity','fluid','import',2),
        (3,'pyops-electricity','fluid','byproduct',100),
        (4,'pyops-electricity','fluid','primary',999);
    `);
    fx.db.close();
    switchDatabase(fx.file);
  });

  afterEach(() => fx.cleanup());

  it("excludes disabled blocks entirely from both demand and generation", async () => {
    const r = await run();
    expect(r.blocks).toBe(3);
    expect(r.topConsumers.some((c) => c.blockId === 4)).toBe(false);
    expect(r.generators.some((g) => g.blockId === 4)).toBe(false);
  });

  it("sums demand from electricityW, ignoring the import-role flow row", async () => {
    const r = await run();
    expect(r.totalDemandW).toBe(8_000_000); // Iron mall 5MW + Reactor 3MW; Turbine farm 0
    expect(r.topConsumers.map((c) => c.blockId)).toEqual([1, 3]); // desc: 5MW, 3MW
  });

  it("sums generation from producer-role flows only, scaled MW -> W", async () => {
    const r = await run();
    expect(r.totalGenerationW).toBe(150_000_000); // Reactor 100MW + Turbine farm 50MW
    expect(r.generators.map((g) => g.blockId)).toEqual([3, 2]); // desc: 100MW, 50MW
    expect(r.generators.find((g) => g.blockId === 3)!.watts).toBe(100_000_000);
  });

  it("a block can be both a consumer and a generator — not netted per block", async () => {
    const r = await run();
    expect(r.topConsumers.find((c) => c.blockId === 3)!.watts).toBe(3_000_000);
    expect(r.generators.find((g) => g.blockId === 3)!.watts).toBe(100_000_000);
  });

  it("netW is generation minus demand", async () => {
    const r = await run();
    expect(r.netW).toBe(150_000_000 - 8_000_000);
  });

  it("limit caps topConsumers", async () => {
    const r = await run(1);
    expect(r.topConsumers).toHaveLength(1);
    expect(r.topConsumers[0].blockId).toBe(1);
  });
});
