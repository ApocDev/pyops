/**
 * Assistant tool alignment tests (#115): submitBlock surfaces a generic
 * fluid-fuel draw as an EXPLICIT `pyops-fluid-fuel` import (it's a matched
 * block-to-block flow at factory scale now), while electricity/heat stay
 * dropped from the import list (they're surfaced separately as powerW/heatW).
 *
 * Seeds mirror the #25 block-compute fixtures: an unfiltered fluid-burning
 * glassworks (10MW, pool draw) and a kerosene fuel-farm chain with the
 * synthesized burn-fluid-kerosene conversion (1 kerosene → 1.5 MJ).
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "../db/index.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { submitBlock } from "./agent-tools.server.ts";

type Draft = {
  ok: boolean;
  imports: string[];
  importsExternal: string[];
  byproducts: { good: string; rate: number | null }[];
  rates: Record<string, number>;
  powerW: number | null;
};

const draft = async (input: { target: string; rate: number; recipes: string[] }): Promise<Draft> =>
  (await submitBlock.execute!(input, { toolCallId: "test", messages: [] })) as Draft;

describe("submitBlock fluid-fuel alignment (#115)", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    fx.db.exec(`
      INSERT INTO fluids (name, display, fuel_value_j) VALUES
        ('pyops-fluid-fuel','Fluid fuel (MJ)',NULL),
        ('crude','Crude',NULL),
        ('kerosene','Kerosene',1500000),
        ('molten-glass','Molten glass',NULL);
      INSERT INTO items (name, display) VALUES ('sand','Sand');

      INSERT INTO recipes (name, kind, category, energy_required, enabled, hidden) VALUES
        ('glass','real','glassworks',4,1,0),
        ('make-kerosene','real','distillation',2,1,0),
        ('burn-fluid-kerosene','burning',NULL,1,1,0);
      INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES
        ('glass',0,'item','sand',20),
        ('make-kerosene',0,'fluid','crude',10),
        ('burn-fluid-kerosene',0,'fluid','kerosene',1);
      INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
        ('glass',0,'fluid','molten-glass',20),
        ('make-kerosene',0,'fluid','kerosene',5),
        ('burn-fluid-kerosene',0,'fluid','pyops-fluid-fuel',1.5);

      INSERT INTO crafting_machines
        (name, display, kind, crafting_speed, module_slots, energy_usage_w, energy_source, burns_fluid, fluid_fuel_filter)
      VALUES
        ('glassworks-mk01','Glassworks MK 01','assembling-machine',1,0,10000000,'fluid',1,NULL),
        ('distillery','Distillery','assembling-machine',1,0,1000000,'electric',NULL,NULL);
      INSERT INTO machine_categories (machine, category) VALUES
        ('glassworks-mk01','glassworks'),
        ('distillery','distillation');
    `);
    fx.db.close();
    switchDatabase(fx.file);
  });

  afterEach(() => fx.cleanup());

  it("surfaces a generic fluid-fuel draw as an explicit import with its MJ/s rate", async () => {
    const res = await draft({ target: "molten-glass", rate: 20, recipes: ["glass"] });
    expect(res.ok).toBe(true);
    // 4 glassworks × 10MW = 40 MJ/s from the pool — explicit demand, not dropped
    expect(res.imports).toContain("pyops-fluid-fuel");
    expect(res.importsExternal).toContain("pyops-fluid-fuel");
    expect(res.rates["pyops-fluid-fuel"]).toBeCloseTo(40);
  });

  it("still drops electricity from the import list (surfaced as powerW)", async () => {
    const res = await draft({ target: "kerosene", rate: 5, recipes: ["make-kerosene"] });
    expect(res.ok).toBe(true);
    expect(res.imports).toEqual(["crude"]);
    expect(res.powerW).toBeGreaterThan(0); // 2 distilleries × 1MW
  });

  it("a supplier draft (MJ target) keeps the pool out of the byproduct list", async () => {
    const res = await draft({
      target: "pyops-fluid-fuel",
      rate: 30,
      recipes: ["make-kerosene", "burn-fluid-kerosene"],
    });
    expect(res.ok).toBe(true);
    expect(res.imports).toEqual(["crude"]);
    expect(res.rates["crude"]).toBeCloseTo(40);
    // the MJ goal is the block's product, not a dangling byproduct
    expect(res.byproducts.map((b) => b.good)).not.toContain("pyops-fluid-fuel");
  });
});
