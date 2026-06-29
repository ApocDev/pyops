import { describe, expect, it } from "vite-plus/test";
import { strToU8, zipSync } from "fflate";
import {
  type BlockShape,
  applyRenames,
  hasRenames,
  migrationsFromZip,
  parseMigrationJson,
} from "./migrations.ts";
import type { BlockData } from "../db/schema.ts";

describe("parseMigrationJson", () => {
  it("parses recipe/item/fluid/entity pairs, collapsing item+fluid into good", () => {
    const r = parseMigrationJson({
      recipe: [["old-rec", "new-rec"]],
      item: [["old-item", "new-item"]],
      fluid: [["old-fluid", "new-fluid"]],
      entity: [["old-ent", "new-ent"]],
    });
    expect(r.recipe.get("old-rec")).toBe("new-rec");
    expect(r.good.get("old-item")).toBe("new-item");
    expect(r.good.get("old-fluid")).toBe("new-fluid");
    expect(r.entity.get("old-ent")).toBe("new-ent");
  });

  it("ignores identity renames and malformed pairs", () => {
    const r = parseMigrationJson({
      recipe: [["same", "same"], ["only-one"], "nope", [1, 2]],
      technology: [["a", "b"]], // not a block-referenceable type
    });
    expect(hasRenames(r)).toBe(false);
  });

  it("tolerates non-object input", () => {
    expect(hasRenames(parseMigrationJson(null))).toBe(false);
    expect(hasRenames(parseMigrationJson("garbage"))).toBe(false);
  });
});

const block = (data: Partial<BlockData>, icon?: { kind: string; name: string }): BlockShape => ({
  data: { goals: [], recipes: [], ...data },
  iconKind: icon?.kind ?? null,
  iconName: icon?.name ?? null,
});

describe("applyRenames", () => {
  it("renames every block field the rename touches", () => {
    const r = parseMigrationJson({
      recipe: [["old-smelt", "new-smelt"]],
      item: [
        ["old-plate", "new-plate"],
        ["old-mod", "new-mod"],
        ["old-fuel", "new-fuel"],
      ],
      entity: [
        ["old-furnace", "new-furnace"],
        ["old-beacon", "new-beacon"],
      ],
    });
    const input = block(
      {
        goals: [
          { name: "old-plate", rate: 1 },
          { name: "old-fuel", rate: 2 },
        ],
        recipes: ["old-smelt"],
        dispositions: { "old-plate": "export" },
        machines: { "old-smelt": "old-furnace" },
        fuels: { "old-smelt": "old-fuel" },
        modules: { "old-smelt": ["old-mod", "old-mod"] },
        beacons: { "old-smelt": [{ beacon: "old-beacon", modules: ["old-mod"], count: 2 }] },
      },
      { kind: "item", name: "old-plate" },
    );
    const { block: out, changed } = applyRenames(input, r);
    expect(changed).toBe(true);
    expect(out.data.goals).toEqual([
      { name: "new-plate", rate: 1 },
      { name: "new-fuel", rate: 2 },
    ]);
    expect(out.data.recipes).toEqual(["new-smelt"]);
    expect(out.data.dispositions).toEqual({ "new-plate": "export" });
    expect(out.data.machines).toEqual({ "new-smelt": "new-furnace" });
    expect(out.data.fuels).toEqual({ "new-smelt": "new-fuel" });
    expect(out.data.modules).toEqual({ "new-smelt": ["new-mod", "new-mod"] });
    expect(out.data.beacons).toEqual({
      "new-smelt": [{ beacon: "new-beacon", modules: ["new-mod"], count: 2 }],
    });
    expect(out.iconName).toBe("new-plate");
  });

  it("leaves a block untouched when nothing matches", () => {
    const r = parseMigrationJson({ recipe: [["x", "y"]] });
    const input = block({ goals: [{ name: "plate", rate: 1 }], recipes: ["smelt"] });
    const { changed, block: out } = applyRenames(input, r);
    expect(changed).toBe(false);
    expect(out.data).toEqual(input.data);
  });

  it("only renames the icon when its kind matches the rename type", () => {
    const r = parseMigrationJson({ item: [["shared", "renamed"]] });
    // a recipe-kind icon named "shared" must NOT follow an item rename
    const recipeIcon = applyRenames(block({ recipes: [] }, { kind: "recipe", name: "shared" }), r);
    expect(recipeIcon.block.iconName).toBe("shared");
    const itemIcon = applyRenames(block({ recipes: [] }, { kind: "item", name: "shared" }), r);
    expect(itemIcon.block.iconName).toBe("renamed");
  });
});

describe("migrationsFromZip", () => {
  it("extracts only migrations/*.json, ignoring .lua and other files", () => {
    const zip = zipSync({
      "pyfoo_1.2.3/info.json": strToU8('{"name":"pyfoo"}'),
      "pyfoo_1.2.3/migrations/1.0.0.json": strToU8('{"recipe":[["a","b"]]}'),
      "pyfoo_1.2.3/migrations/1.1.0.lua": strToU8("-- procedural, ignored"),
      "pyfoo_1.2.3/data.lua": strToU8("-- nope"),
    });
    const got = migrationsFromZip(zip);
    expect(got).toHaveLength(1);
    expect(got[0].file).toBe("1.0.0.json");
    expect(parseMigrationJson(got[0].json).recipe.get("a")).toBe("b");
  });
});
