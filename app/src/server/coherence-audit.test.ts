/**
 * Factory-wide coherence audit (#11): cross-block balance shaped for the agent.
 *
 * Fixture factory: block A makes steel @2/s (imports iron-ore), blocks B+C
 * consume steel @9/s total — steel is UNDER-supplied by 7/s. Block B also emits
 * a `tailings` byproduct nothing consumes (a void recipe exists → verdict
 * "void"), block C emits `mystery-gunk` with no consumer and no void (verdict
 * "nowhere"). B's primary `py-sci` is a final product, not waste. iron-ore is
 * an unsourced import with no producing recipe (raw), and the electricity
 * pseudo-good is excluded from the audit entirely.
 *
 * The void classifier is checked against the real Py shapes: a vent (no
 * products) and an incinerator (a fraction of the same item back — `ash-pyvoid`
 * returns 1 ash at probability 0.2 in the dump).
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "../db/index.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { byproductDisposal, coherenceAudit, isVoidRecipeFor } from "./coherence-audit.server.ts";

describe("coherenceAudit (#11)", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    fx.db.exec(`
      INSERT INTO items (name, display) VALUES
        ('steel','Steel'),('iron-ore','Iron ore'),('py-sci','Py science'),('ash','Ash'),
        ('mystery-gunk','Mystery gunk');
      INSERT INTO fluids (name, display) VALUES ('tailings','Tailings');

      -- consuming recipes: one productive consumer of steel, disposal recipes
      -- for tailings/ash, and a productive tailings consumer to keep apart.
      INSERT INTO recipes (name, kind, category, energy_required, enabled, hidden) VALUES
        ('gear','real','crafting',1,1,0),
        ('tailings-pyvoid-fluid','real','py-runoff',1,1,1),
        ('tailings-to-soil','real','crafting',1,1,0),
        ('ash-pyvoid','real','py-incineration',1,1,1),
        ('steam-pyvoid-gas','real','py-venting',1,1,1);
      INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES
        ('gear',0,'item','steel',2),
        ('tailings-pyvoid-fluid',0,'fluid','tailings',100),
        ('tailings-to-soil',0,'fluid','tailings',10),
        ('ash-pyvoid',0,'item','ash',1),
        ('steam-pyvoid-gas',0,'fluid','steam',20000);
      INSERT INTO recipe_products (recipe, idx, kind, name, amount, amount_min, amount_max, probability) VALUES
        ('gear',0,'item','gear-item',1,NULL,NULL,1),
        ('tailings-to-soil',0,'item','soil',1,NULL,NULL,1),
        ('ash-pyvoid',0,'item','ash',NULL,1,1,0.2);

      INSERT INTO blocks (id, name, data, enabled) VALUES
        (1,'Steel','{"goals":[{"name":"steel","rate":2}],"recipes":[]}',1),
        (2,'Science','{"goals":[{"name":"py-sci","rate":1}],"recipes":[]}',1),
        (3,'Gears','{"goals":[{"name":"gear-item","rate":1}],"recipes":[]}',1);
      INSERT INTO block_flows (block_id, item, kind, role, rate) VALUES
        (1,'steel','item','primary',2),
        (1,'iron-ore','item','import',4),
        (1,'pyops-electricity','fluid','import',500000),
        (2,'steel','item','import',6),
        (2,'py-sci','item','primary',1),
        (2,'tailings','fluid','byproduct',3),
        (3,'steel','item','import',3),
        (3,'gear-item','item','primary',1),
        (3,'mystery-gunk','item','byproduct',0.5);
    `);
    fx.db.close();
    switchDatabase(fx.file);
  });

  afterEach(() => fx.cleanup());

  it("classifies vent/void/incinerate disposal recipes without name-matching", () => {
    expect(isVoidRecipeFor("steam-pyvoid-gas", "steam")).toBe(true); // no products
    expect(isVoidRecipeFor("tailings-pyvoid-fluid", "tailings")).toBe(true); // no products
    expect(isVoidRecipeFor("ash-pyvoid", "ash")).toBe(true); // 20% of the item back
    expect(isVoidRecipeFor("tailings-to-soil", "tailings")).toBe(false); // makes soil
    expect(isVoidRecipeFor("gear", "steel")).toBe(false); // real production
  });

  it("reports under-supplied goods with the producer/consumer blocks and rates", () => {
    const audit = coherenceAudit();
    expect(audit.underSupplied).toHaveLength(1);
    const steel = audit.underSupplied[0];
    expect(steel.good).toBe("steel");
    expect(steel.shortPerSec).toBeCloseTo(7); // 9 demanded, 2 made
    expect(steel.producers.map((p) => p.blockId)).toEqual([1]);
    expect(steel.producers[0].rate).toBeCloseTo(2); // reviseBlock input: raise #1 to 9
    expect(steel.consumers.map((c) => c.blockId).sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it("lists unsourced imports but excludes the electricity pseudo-good", () => {
    const audit = coherenceAudit();
    const goods = audit.unsourcedImports.map((u) => u.good);
    expect(goods).toContain("iron-ore");
    expect(goods).not.toContain("pyops-electricity");
    const ore = audit.unsourcedImports.find((u) => u.good === "iron-ore")!;
    expect(ore.craftable).toBe(false); // no recipe produces it — a raw
  });

  it("splits dangling byproducts (with disposal verdicts) from final products", () => {
    const audit = coherenceAudit();
    const dangling = audit.danglingByproducts as {
      good: string;
      disposal: string;
      topConsumers: string[];
      voidRecipes: string[];
    }[];
    const tailings = dangling.find((d) => d.good === "tailings")!;
    // a productive consumer exists → route (the void stays a listed fallback)
    expect(tailings.disposal).toBe("route");
    expect(tailings.topConsumers).toContain("tailings-to-soil");
    expect(tailings.voidRecipes).toContain("tailings-pyvoid-fluid");
    const gunk = dangling.find((d) => d.good === "mystery-gunk")!;
    expect(gunk.disposal).toBe("nowhere"); // no consumer, no void — store/buffer
    // the science block's declared output is a final product, never "dangling"
    expect(dangling.map((d) => d.good)).not.toContain("py-sci");
    expect(audit.finalProducts.map((f) => (f as { good: string }).good)).toContain("py-sci");
  });

  it("byproductDisposal prefers void over nowhere when only a void exists", () => {
    expect(byproductDisposal("ash").disposal).toBe("void");
    expect(byproductDisposal("ash").voidRecipes).toEqual(["ash-pyvoid"]);
  });
});
