/**
 * Multi-goal + keep-in-stock block drafts (#38): submitBlock/submitPlan used to
 * accept only a single `target`+`rate` throughput target. A construction/mall
 * block ("keep 80 vrauks-paddock on hand") has no honest per-second rate to
 * give it — the assistant would either fabricate one or refuse. `blockDraftInput`
 * now also accepts a `goals` array, each entry EITHER a throughput `rate` OR a
 * keep-in-stock `stock` (+ optional `window`, default 600s), with the solver
 * rate DERIVED as stock/window. `goals[0]` still anchors `target`/`rate`/
 * `targetDisplay` for back-compat with the UI card and reviseBlock/submitPlan.
 *
 * Fixture: two independent one-step smelting recipes (iron-plate, copper-plate)
 * on an unmoduled stone-furnace, so the solved building count is exactly
 * rate × energyRequired ÷ speed with no module-fill noise.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "../db/index.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { buildingBill, submitBlock, submitPlan } from "./agent-tools.server.ts";

type Goal = { name: string; rate: number; stock?: number; window?: number };
type Draft = {
  ok: boolean;
  target: string;
  targetDisplay?: string;
  rate: number;
  goals: Goal[];
  buildings: { recipe: string; machine: string; count: number }[];
  byproducts: { good: string; rate: number | null }[];
};

// The tool schemas' real input type defaults `window` to 600 (so its OUTPUT
// type requires the field); these test wrappers accept the looser hand-written
// literal shape a caller would actually send (window omittable) and cast at
// the boundary, same as the AI SDK would after applying the schema's default.
type DraftInput = Parameters<NonNullable<typeof submitBlock.execute>>[0];
type PlanInput = Parameters<NonNullable<typeof submitPlan.execute>>[0];
type BillInput = Parameters<NonNullable<typeof buildingBill.execute>>[0];

const draft = async (input: Record<string, unknown>): Promise<Draft> =>
  (await submitBlock.execute!(input as DraftInput, {
    toolCallId: "test",
    messages: [],
  })) as Draft;

const plan = async (input: Record<string, unknown>): Promise<{ ok: boolean; blocks: Draft[] }> =>
  (await submitPlan.execute!(input as PlanInput, { toolCallId: "test", messages: [] })) as {
    ok: boolean;
    blocks: Draft[];
  };

const bill = async (
  input: Record<string, unknown>,
): Promise<{ machines: { entity: string; count: number }[]; skipped: unknown[] }> =>
  (await buildingBill.execute!(input as BillInput, { toolCallId: "test", messages: [] })) as {
    machines: { entity: string; count: number }[];
    skipped: unknown[];
  };

describe("submitBlock/submitPlan/buildingBill: multi-goal + keep-in-stock goals (#38)", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    fx.db.exec(`
      INSERT INTO items (name, display) VALUES
        ('iron-ore','Iron ore'),('iron-plate','Iron plate'),
        ('copper-ore','Copper ore'),('copper-plate','Copper plate');

      INSERT INTO recipes (name, kind, category, energy_required, enabled, hidden) VALUES
        ('iron-plate','real','smelting',3.2,1,0),
        ('copper-plate','real','smelting',3.2,1,0);
      INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES
        ('iron-plate',0,'item','iron-ore',1),
        ('copper-plate',0,'item','copper-ore',1);
      INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
        ('iron-plate',0,'item','iron-plate',1),
        ('copper-plate',0,'item','copper-plate',1);

      INSERT INTO crafting_machines
        (name, display, kind, crafting_speed, module_slots, energy_usage_w, energy_source)
      VALUES
        ('stone-furnace','Stone furnace','furnace',1,0,90000,'electric');
      INSERT INTO machine_categories (machine, category) VALUES
        ('stone-furnace','smelting');
    `);
    fx.db.close();
    switchDatabase(fx.file);
  });

  afterEach(() => fx.cleanup());

  it("backward compat: the legacy target+rate shorthand still works unchanged", async () => {
    const res = await draft({ target: "iron-plate", rate: 4, recipes: ["iron-plate"] });
    expect(res.ok).toBe(true);
    expect(res.target).toBe("iron-plate");
    expect(res.rate).toBe(4);
    expect(res.goals).toEqual([{ name: "iron-plate", rate: 4 }]);
    expect(res.buildings[0].count).toBeCloseTo(12.8, 2);
  });

  it("a stock goal derives its solver rate as stock/window and carries stock/window in the draft", async () => {
    const res = await draft({
      goals: [{ name: "iron-plate", stock: 80, window: 200 }],
      recipes: ["iron-plate"],
    });
    expect(res.ok).toBe(true);
    // goals[0] still anchors target/rate/targetDisplay for back-compat
    expect(res.target).toBe("iron-plate");
    expect(res.rate).toBeCloseTo(0.4, 5); // 80/200
    expect(res.goals).toEqual([{ name: "iron-plate", rate: 0.4, stock: 80, window: 200 }]);
    // solved against the DERIVED rate (0.4/s), not a fabricated continuous one:
    // 0.4/s x 3.2s/craft = 1.28 furnaces
    expect(res.buildings[0].count).toBeCloseTo(1.28, 2);
  });

  it("a stock goal without an explicit window defaults to 600s (#38 STOCK_WINDOW_DEFAULT)", async () => {
    const res = await draft({
      goals: [{ name: "iron-plate", stock: 60 }],
      recipes: ["iron-plate"],
    });
    expect(res.goals).toEqual([{ name: "iron-plate", rate: 0.1, stock: 60, window: 600 }]);
  });

  it("supports multiple goals in one block — a rate goal and a stock goal together", async () => {
    const res = await draft({
      goals: [
        { name: "iron-plate", rate: 4 },
        { name: "copper-plate", stock: 80, window: 400 },
      ],
      recipes: ["iron-plate", "copper-plate"],
    });
    expect(res.ok).toBe(true);
    expect(res.goals).toEqual([
      { name: "iron-plate", rate: 4 },
      { name: "copper-plate", rate: 0.2, stock: 80, window: 400 },
    ]);
    const byRecipe = Object.fromEntries(res.buildings.map((b) => [b.recipe, b.count]));
    expect(byRecipe["iron-plate"]).toBeCloseTo(12.8, 2); // 4 x 3.2
    expect(byRecipe["copper-plate"]).toBeCloseTo(0.64, 2); // 0.2 x 3.2
    // both goals are solver targets, not surplus — neither shows up as a byproduct
    expect(res.byproducts.map((b) => b.good)).not.toContain("iron-plate");
    expect(res.byproducts.map((b) => b.good)).not.toContain("copper-plate");
  });

  it("submitPlan carries each block's full goals array, including a stock goal", async () => {
    const res = await plan({
      title: "Mall",
      objective: "keep some buildings on hand",
      blocks: [
        {
          name: "Mall block",
          goals: [
            { name: "iron-plate", stock: 80, window: 400 },
            { name: "copper-plate", rate: 1 },
          ],
          recipes: ["iron-plate", "copper-plate"],
        },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.blocks).toHaveLength(1);
    const b = res.blocks[0];
    expect(b.target).toBe("iron-plate"); // goals[0] anchors naming/sizing
    expect(b.rate).toBeCloseTo(0.2, 5);
    expect(b.goals).toEqual([
      { name: "iron-plate", rate: 0.2, stock: 80, window: 400 },
      { name: "copper-plate", rate: 1 },
    ]);
  });

  it("buildingBill accepts the same goals array shape and reflects the derived stock rate", async () => {
    const res = await bill({
      blocks: [
        { goals: [{ name: "iron-plate", stock: 80, window: 200 }], recipes: ["iron-plate"] },
      ],
    });
    expect(res.skipped).toEqual([]);
    expect(res.machines).toHaveLength(1);
    // 0.4/s x 3.2s = 1.28 fractional furnaces -> ceil = 2
    expect(res.machines[0].entity).toBe("stone-furnace");
    expect(res.machines[0].count).toBe(2);
  });
});
