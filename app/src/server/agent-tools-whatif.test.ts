/**
 * whatIf (#127): wraps factoryWhatIf (the What-if page's factory-wide LP) as
 * an agent/MCP tool. Reuses the existing solver + q.blocksWithFlows() — this
 * is a thin reshape, not a new calculation, so the fixture exercises the same
 * plates→gears ripple as factory-solve.test.ts, but through real DB rows.
 *
 * A real "sink" block (per block-compute.server.ts's boundaryFlows) records
 * its OWN output as a "byproduct" role, not "primary" — a sink block has no
 * pinned goal of its own, just a sink goal (recorded as an import) for the
 * good it consumes. The fixture's Slag sink block mirrors that shape so it's
 * correctly excluded from the demand chain (not misclassified as a final
 * product) and picked up by `overproduced[].absorb`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "../db/index.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { markSolveGenerationResolved } from "../db/solve-generation.server.ts";
import { agentTools, whatIf } from "./agent-tools.server.ts";

type WhatIfResult = {
  status: string;
  blocksToResize: {
    blockId: number;
    name: string;
    good: string | null;
    currentRate: number;
    rate: number;
    scale: number;
    delta: number;
  }[];
  ignoredOverrides: { good: string; note: string }[];
  demands: { good: string; kind: string; current: number; target: number }[];
  rawsNeeded: { good: string; kind: string; current: number; projected: number }[];
  overproduced: {
    good: string;
    kind: string;
    cls: string;
    projected: number;
    absorb: { blockId: number; name: string; scale: number } | null;
  }[];
};

const run = async (overrides: { good: string; rate: number }[]): Promise<WhatIfResult> =>
  (await whatIf.execute!({ overrides }, { toolCallId: "test", messages: [] })) as WhatIfResult;

describe("whatIf (#127)", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    fx.db.exec(`
      INSERT INTO items (name, display) VALUES
        ('plate','Plate'),('gear','Gear'),('ore','Ore'),
        ('slag','Slag'),('slag-brick','Slag brick');
      INSERT INTO fluids (name, display) VALUES ('pyops-electricity','Electricity');

      INSERT INTO blocks (id, name, data, enabled) VALUES
        (1,'Plates','{"goals":[{"name":"plate","rate":2}],"recipes":[]}',1),
        (2,'Gears','{"goals":[{"name":"gear","rate":1}],"recipes":[]}',1),
        (3,'Power','{"goals":[{"name":"pyops-electricity","rate":100}],"recipes":[]}',1),
        (4,'Slag sink','{"goals":[],"recipes":[]}',1);

      INSERT INTO block_flows (block_id, item, kind, role, rate) VALUES
        (1,'plate','item','primary',2),
        (1,'ore','item','import',8),
        (1,'slag','item','byproduct',1),
        (1,'pyops-electricity','fluid','import',20),
        (2,'gear','item','primary',1),
        (2,'plate','item','import',2),
        (2,'pyops-electricity','fluid','import',10),
        (3,'pyops-electricity','fluid','primary',100),
        (4,'slag-brick','item','byproduct',0.5),
        (4,'slag','item','import',1);
    `);
    fx.db.close();
    switchDatabase(fx.file);
    markSolveGenerationResolved();
  });

  afterEach(() => fx.cleanup());

  it("registers in agentTools", () => {
    expect("whatIf" in agentTools).toBe(true);
  });

  it("reports the ripple with reviseBlock-ready blockId/rate pairs", async () => {
    const r = await run([{ good: "gear", rate: 2 }]);
    expect(r.status).toBe("Optimal");

    // Power (pinned, electricity is a free good) and Slag sink (byproduct-only,
    // scale pinned at 1) are unaffected — only Plates and Gears resize.
    expect(r.blocksToResize.map((b) => b.blockId).sort((a, b) => a - b)).toEqual([1, 2]);

    const gears = r.blocksToResize.find((b) => b.blockId === 2)!;
    expect(gears).toMatchObject({ blockId: 2, currentRate: 1, rate: 2, scale: 2 });

    // ripples upstream to feed the doubled gear demand
    const plates = r.blocksToResize.find((b) => b.blockId === 1)!;
    expect(plates).toMatchObject({ blockId: 1, currentRate: 2, rate: 4, scale: 2 });

    expect(r.ignoredOverrides).toEqual([]);
  });

  it("surfaces an override on a non-demand good as ignored, not silently applied", async () => {
    // 'ore' is a raw (never produced) and 'plate' is an intermediate (consumed by
    // Gears) — neither is a `demand` good, so the solver can't honor an override
    // on either one; both must come back in ignoredOverrides with NO block change.
    const oreResult = await run([{ good: "ore", rate: 50 }]);
    expect(oreResult.ignoredOverrides).toEqual([{ good: "ore", note: expect.any(String) }]);
    expect(oreResult.blocksToResize).toEqual([]);

    const plateResult = await run([{ good: "plate", rate: 10 }]);
    expect(plateResult.ignoredOverrides).toEqual([{ good: "plate", note: expect.any(String) }]);
    expect(plateResult.blocksToResize).toEqual([]);
  });

  it("reports raw draw and byproduct surplus with an absorb hint", async () => {
    const r = await run([{ good: "gear", rate: 2 }]);

    const ore = r.rawsNeeded.find((g) => g.good === "ore")!;
    expect(ore).toMatchObject({ good: "ore", projected: 16 }); // 8 * scale 2

    const slag = r.overproduced.find((g) => g.good === "slag")!;
    expect(slag.absorb).toMatchObject({ blockId: 4, name: "Slag sink", scale: expect.any(Number) });
  });
});
