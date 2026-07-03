/**
 * Integration tests for block/plan import/export (#82) against a real
 * schema-migrated db: fresh ids + suffixed names on collision, folder
 * recreation, missing-reference flagging (the drift degrade path), and the
 * export → import → export round trip of the block doc.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "../db/index.server.ts";
import { getBlock, listBlocks, listGroups } from "../db/queries.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import type { BlockData } from "../db/schema.ts";
import { PYOPS_EXPORT_VERSION, type PlanEnvelope } from "../lib/plan-export";
import { buildBlockExport, buildPlanExport, importEnvelope } from "./export.server.ts";

let fx: TestDb;

beforeEach(async () => {
  fx = await makeTestDb();
  // minimal reference data: one item with one producing recipe
  fx.db.exec(`
    INSERT INTO items (name, display) VALUES ('plate','Plate');
    INSERT INTO recipes (name, display, kind) VALUES ('smelt-plate','Smelt plate','real');
    INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
      ('smelt-plate',0,'item','plate',1);
  `);
  switchDatabase(fx.file);
});

afterEach(() => fx.cleanup());

const doc: BlockData = {
  goals: [{ name: "plate", rate: 2 }],
  recipes: ["smelt-plate"],
};

const plan = (blocks: PlanEnvelope["blocks"], groups: PlanEnvelope["groups"]): PlanEnvelope => ({
  pyops: PYOPS_EXPORT_VERSION,
  kind: "plan",
  exportedAt: new Date().toISOString(),
  name: "test plan",
  blocks,
  groups,
});

describe("importEnvelope", () => {
  it("creates new blocks + folders and remaps group references", async () => {
    const r = await importEnvelope(
      plan(
        [
          { name: "Plates", icon: null, enabled: true, doc, group: 5 },
          { name: "Loose", icon: null, enabled: false, doc },
        ],
        [{ id: 5, name: "Smelting" }],
      ),
    );
    expect(r.kind).toBe("plan");
    expect(r.groupsCreated).toBe(1);
    expect(r.blocks.map((b) => b.name)).toEqual(["Plates", "Loose"]);
    expect(r.blocks.every((b) => !b.broken)).toBe(true);

    const groups = listGroups();
    expect(groups.map((g) => g.name)).toEqual(["Smelting"]);
    const rows = listBlocks();
    expect(rows.map((b) => b.name).sort()).toEqual(["Loose", "Plates"]);
    const plates = rows.find((b) => b.name === "Plates")!;
    expect(plates.groupId).toBe(groups[0].id);
    const loose = rows.find((b) => b.name === "Loose")!;
    expect(loose.groupId).toBeNull();
    expect(loose.enabled).toBe(false);
  });

  it("suffixes names when the import collides with existing blocks/folders", async () => {
    const env = plan(
      [{ name: "Plates", icon: null, enabled: true, doc, group: 1 }],
      [{ id: 1, name: "Smelting" }],
    );
    await importEnvelope(env);
    const r = await importEnvelope(env);
    expect(r.blocks[0].name).toBe("Plates (2)");
    expect(
      listGroups()
        .map((g) => g.name)
        .sort(),
    ).toEqual(["Smelting", "Smelting (2)"]);
    // both blocks exist under their own folder copy
    const rows = listBlocks();
    expect(rows.map((b) => b.name).sort()).toEqual(["Plates", "Plates (2)"]);
    const first = rows.find((b) => b.name === "Plates")!;
    const second = rows.find((b) => b.name === "Plates (2)")!;
    expect(first.groupId).not.toBe(second.groupId);
  });

  it("imports blocks whose recipes/goods are missing, flagged broken", async () => {
    const r = await importEnvelope({
      pyops: 1,
      kind: "block",
      exportedAt: "",
      block: {
        name: "Foreign",
        icon: null,
        enabled: true,
        doc: { goals: [{ name: "unobtainium", rate: 1 }], recipes: ["smelt-plate", "alien-tech"] },
      },
    });
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].broken).toBe(true);
    expect(r.blocks[0].missing).toEqual({ recipes: ["alien-tech"], goods: ["unobtainium"] });
    // the block exists with its doc intact — nothing was dropped
    const row = getBlock(r.blocks[0].id)!;
    expect(row.data.recipes).toEqual(["smelt-plate", "alien-tech"]);
    expect(row.data.goals).toEqual([{ name: "unobtainium", rate: 1 }]);
  });

  it("rejects an unreadable envelope", async () => {
    await expect(importEnvelope({ hello: 1 })).rejects.toThrow(/not a PyOps export/);
  });

  it("round-trips a block doc through export → import → export", async () => {
    const first = await importEnvelope({
      pyops: 1,
      kind: "block",
      exportedAt: "",
      block: { name: "Plates", icon: { kind: "item", name: "plate" }, enabled: true, doc },
    });
    const exported = buildBlockExport(first.blocks[0].id);
    expect(exported.pyops).toBe(PYOPS_EXPORT_VERSION);
    expect(exported.block.doc).toEqual(doc);
    expect(exported.block.icon).toEqual({ kind: "item", name: "plate" });

    const again = await importEnvelope(exported);
    expect(again.blocks[0].name).toBe("Plates (2)");
    expect(buildBlockExport(again.blocks[0].id).block.doc).toEqual(doc);
  });

  it("exports the whole plan with folder membership intact", async () => {
    await importEnvelope(
      plan(
        [{ name: "Plates", icon: null, enabled: true, doc, group: 1 }],
        [{ id: 1, name: "Smelting" }],
      ),
    );
    const env = buildPlanExport();
    expect(env.kind).toBe("plan");
    expect(env.blocks).toHaveLength(1);
    expect(env.groups.map((g) => g.name)).toEqual(["Smelting"]);
    expect(env.blocks[0].group).toBe(env.groups[0].id);
    expect(env.blocks[0].doc).toEqual(doc);
  });
});
