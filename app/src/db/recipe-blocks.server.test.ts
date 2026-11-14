import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { evictDatabase, switchDatabase } from "./index.server.ts";
import { blocksUsingRecipe, recipeFocusInfo } from "./recipe-blocks.server.ts";
import { makeTestDb, type TestDb } from "./test-helpers.ts";

let fx: TestDb;

const doc = (recipes: string[], disabledRecipes: string[] = []) =>
  JSON.stringify({ goals: [], recipes, disabledRecipes });

beforeEach(async () => {
  fx = await makeTestDb();
  fx.db.exec(`
    INSERT INTO items (name, display) VALUES ('ore', 'Ore'), ('plate', 'Plate'), ('slag', 'Slag');
    INSERT INTO fluids (name, display) VALUES ('steam', 'Steam');
    INSERT INTO recipes (name, display, kind, hidden, main_product)
      VALUES ('smelt', 'Smelt ore', 'real', 0, 'plate'),
             ('void-steam', NULL, 'real', 0, NULL);
    INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
      ('smelt', 0, 'item', 'slag', 1),
      ('smelt', 1, 'item', 'plate', 1);
    INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount) VALUES
      ('smelt', 0, 'item', 'ore', 1),
      ('void-steam', 0, 'fluid', 'steam', 10);
    INSERT INTO blocks (id, name, data, enabled, sort_order) VALUES
      (1, 'Plates B', '${doc(["smelt"])}', 1, 2),
      (2, 'Plates A', '${doc(["smelt"])}', 1, 1),
      (3, 'Off block', '${doc(["smelt"])}', 0, 0),
      (4, 'Row off', '${doc(["smelt"], ["smelt"])}', 1, 0),
      (5, 'Other', '${doc(["void-steam"])}', 1, 3);
  `);
  fx.db.close();
  switchDatabase(fx.file);
});

afterEach(() => {
  evictDatabase(fx.file);
  fx.cleanup();
});

describe("blocksUsingRecipe", () => {
  it("lists enabled blocks with the recipe as an active row, in sidebar order", () => {
    expect(blocksUsingRecipe("smelt")).toEqual([
      { id: 2, name: "Plates A" },
      { id: 1, name: "Plates B" },
    ]);
    expect(blocksUsingRecipe("missing")).toEqual([]);
  });
});

describe("recipeFocusInfo", () => {
  it("picks the main product over the first product", () => {
    expect(recipeFocusInfo("smelt")).toEqual({
      display: "Smelt ore",
      good: { name: "plate", kind: "item" },
      produced: true,
    });
  });

  it("falls back to the first ingredient and the internal name for a void recipe", () => {
    expect(recipeFocusInfo("void-steam")).toEqual({
      display: "void-steam",
      good: { name: "steam", kind: "fluid" },
      produced: false,
    });
  });

  it("returns null for a recipe the reference data doesn't have", () => {
    expect(recipeFocusInfo("missing")).toBeNull();
  });
});
