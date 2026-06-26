import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { ELECTRICITY, HEAT, synthesizePass2 } from "./synthesize.ts";
import { type TestDb, makeTestDb } from "./test-helpers.ts";

let fx: TestDb;
beforeEach(async () => {
  fx = await makeTestDb();
});
afterEach(() => fx.cleanup());

// minimal data.raw slice: one drill, two resources, one offshore pump
const raw = {
  "mining-drill": {
    "electric-drill": {
      resource_categories: ["basic-solid"],
      mining_speed: 0.5,
      module_slots: 2,
    },
  },
  resource: {
    "iron-ore": {
      category: "basic-solid",
      minable: { mining_time: 1, result: "iron-ore", count: 1 },
    },
    "copper-ore": {
      category: "basic-solid",
      minable: { mining_time: 2, results: [{ type: "item", name: "copper-ore", amount: 3 }] },
    },
    "uranium-ore": {
      // category nothing can mine → no recipe
      category: "hard-solid",
      minable: { mining_time: 2, result: "uranium-ore" },
    },
  },
  "offshore-pump": {
    "offshore-pump": { pumping_speed: 20 },
  },
};
const ctx = {
  display: () => null,
  parseSI: (s: unknown) => (typeof s === "number" ? s : null),
};

const get = <T = Record<string, unknown>>(sql: string, ...args: unknown[]) =>
  fx.db.prepare(sql).get(...args) as T | undefined;

describe("synthesizePass2", () => {
  it("always defines the electricity and heat pseudo-fluids", () => {
    synthesizePass2(fx.db, raw, ctx);
    expect(get(`SELECT name FROM fluids WHERE name = ?`, ELECTRICITY)).toBeTruthy();
    expect(get(`SELECT name FROM fluids WHERE name = ?`, HEAT)).toBeTruthy();
  });

  it("creates a mining recipe per minable resource a drill can reach", () => {
    const counts = synthesizePass2(fx.db, raw, ctx);
    expect(counts.mining).toBe(2); // iron + copper; uranium unreachable

    const iron = get<{ kind: string; category: string; energy: number; src: string }>(
      `SELECT kind, category, energy_required energy, source_entity src FROM recipes WHERE name = 'mine-iron-ore'`,
    );
    expect(iron).toMatchObject({
      kind: "mining",
      category: "mine:basic-solid",
      energy: 1,
      src: "iron-ore",
    });
    // result + amount land in recipe_products (results[] form averaged correctly)
    expect(
      get(
        `SELECT amount FROM recipe_products WHERE recipe = 'mine-copper-ore' AND name = 'copper-ore'`,
      ),
    ).toMatchObject({ amount: 3 });
    // mining recipes are productivity-eligible
    expect(
      get<{ ap: number }>(`SELECT allow_productivity ap FROM recipes WHERE name = 'mine-iron-ore'`)!
        .ap,
    ).toBe(1);
  });

  it("skips resources no drill category can mine", () => {
    synthesizePass2(fx.db, raw, ctx);
    expect(get(`SELECT name FROM recipes WHERE name = 'mine-uranium-ore'`)).toBeUndefined();
  });

  it("registers the drill as a machine in its mining category", () => {
    synthesizePass2(fx.db, raw, ctx);
    const drill = get<{ kind: string; speed: number; slots: number }>(
      `SELECT kind, crafting_speed speed, module_slots slots FROM crafting_machines WHERE name = 'electric-drill'`,
    );
    expect(drill).toMatchObject({ kind: "mining-drill", speed: 0.5, slots: 2 });
    expect(
      get(`SELECT category FROM machine_categories WHERE machine = 'electric-drill'`),
    ).toMatchObject({ category: "mine:basic-solid" });
  });

  it("creates a pumping recipe producing water at pumping_speed × 60", () => {
    const counts = synthesizePass2(fx.db, raw, ctx);
    expect(counts.pumping).toBe(1);
    expect(
      get(
        `SELECT amount FROM recipe_products WHERE recipe = 'pump-offshore-pump' AND name = 'water'`,
      ),
    ).toMatchObject({ amount: 1200 }); // 20 × 60
  });
});
