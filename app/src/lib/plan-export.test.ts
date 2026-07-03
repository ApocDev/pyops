import { describe, expect, it } from "vite-plus/test";
import type { BlockData } from "../db/schema.ts";
import {
  PYOPS_EXPORT_VERSION,
  exportFileName,
  parseExportEnvelope,
  resolveImport,
  uniqueName,
  type BlockEnvelope,
  type PlanEnvelope,
} from "./plan-export";

const doc: BlockData = {
  goals: [{ name: "iron-plate", rate: 2 }],
  recipes: ["iron-plate", "iron-ore-mining"],
  machines: { "iron-plate": "stone-furnace" },
  fuels: { "iron-plate": "coal" },
  modules: { "iron-plate": [] },
  dispositions: { "iron-ore": "import" },
};

const blockEnv: BlockEnvelope = {
  pyops: PYOPS_EXPORT_VERSION,
  kind: "block",
  exportedAt: "2026-07-02T00:00:00.000Z",
  block: { name: "Iron plates", icon: { kind: "item", name: "iron-plate" }, enabled: true, doc },
};

const planEnv: PlanEnvelope = {
  pyops: PYOPS_EXPORT_VERSION,
  kind: "plan",
  exportedAt: "2026-07-02T00:00:00.000Z",
  name: "My base",
  blocks: [
    { name: "Iron plates", icon: null, enabled: true, doc, group: 7 },
    { name: "Gears", icon: null, enabled: false, doc: { goals: [], recipes: [] } },
  ],
  groups: [
    { id: 7, name: "Smelting" },
    { id: 9, name: "Nested", parent: 7 },
  ],
};

describe("parseExportEnvelope", () => {
  it("round-trips a block envelope through JSON", () => {
    const r = parseExportEnvelope(JSON.stringify(blockEnv));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.envelope).toEqual(blockEnv);
  });

  it("round-trips a plan envelope (object input)", () => {
    const r = parseExportEnvelope(JSON.parse(JSON.stringify(planEnv)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.envelope).toEqual(planEnv);
  });

  it("rejects non-JSON text and non-envelope values", () => {
    expect(parseExportEnvelope("{nope").ok).toBe(false);
    expect(parseExportEnvelope(null).ok).toBe(false);
    expect(parseExportEnvelope({ hello: 1 }).ok).toBe(false);
    expect(parseExportEnvelope(42).ok).toBe(false);
  });

  it("rejects a newer export version with a helpful error", () => {
    const r = parseExportEnvelope({ ...blockEnv, pyops: 2 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("newer");
    expect(r.error).toContain("2");
  });

  it("rejects unknown kinds and invalid versions", () => {
    expect(parseExportEnvelope({ ...blockEnv, kind: "factory" }).ok).toBe(false);
    expect(parseExportEnvelope({ ...blockEnv, pyops: 0 }).ok).toBe(false);
  });

  it("migrates a legacy { target, rate } doc on import", () => {
    const legacy = {
      pyops: 1,
      kind: "block",
      block: { name: "Old", doc: { target: "iron-plate", rate: 3, recipes: ["iron-plate"] } },
    };
    const r = parseExportEnvelope(legacy);
    expect(r.ok).toBe(true);
    if (!r.ok || r.envelope.kind !== "block") return;
    expect(r.envelope.block.doc.goals).toEqual([{ name: "iron-plate", rate: 3 }]);
    expect(r.envelope.block.enabled).toBe(true); // absent → default true
  });

  it("scrubs malformed goals/recipes and drops dangling group refs", () => {
    const messy = {
      pyops: 1,
      kind: "plan",
      name: "  messy  ",
      blocks: [
        {
          name: "A",
          doc: {
            goals: [
              { name: "ok", rate: 1 },
              { name: "", rate: 1 },
              { name: "nan", rate: "x" },
            ],
            recipes: ["r1", 5, null],
          },
          group: 99, // not in groups → dropped
        },
        { name: "no doc" }, // unreadable → dropped
      ],
      groups: [
        { id: 1, name: "G", parent: 123 }, // dangling parent → dropped
        { id: 2, name: "H", parent: 2 }, // self-parent → dropped
        { bad: true },
      ],
    };
    const r = parseExportEnvelope(messy);
    expect(r.ok).toBe(true);
    if (!r.ok || r.envelope.kind !== "plan") return;
    expect(r.envelope.name).toBe("messy");
    expect(r.envelope.blocks).toHaveLength(1);
    expect(r.envelope.blocks[0].doc.goals).toEqual([{ name: "ok", rate: 1 }]);
    expect(r.envelope.blocks[0].doc.recipes).toEqual(["r1"]);
    expect(r.envelope.blocks[0].group).toBeUndefined();
    expect(r.envelope.groups).toEqual([
      { id: 1, name: "G" },
      { id: 2, name: "H" },
    ]);
  });

  it("rejects a plan with no readable blocks", () => {
    expect(parseExportEnvelope({ pyops: 1, kind: "plan", blocks: [], groups: [] }).ok).toBe(false);
  });

  it("strips a group ref from a lone-block envelope", () => {
    const r = parseExportEnvelope({
      pyops: 1,
      kind: "block",
      block: { name: "A", doc: { goals: [], recipes: [] }, group: 3 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok || r.envelope.kind !== "block") return;
    expect(r.envelope.block.group).toBeUndefined();
  });
});

describe("uniqueName", () => {
  it("keeps a free name and claims it", () => {
    const taken = new Set(["other"]);
    expect(uniqueName("Iron", taken)).toBe("Iron");
    expect(taken.has("Iron")).toBe(true);
  });

  it("suffixes (2), (3), … on collision, staying unique across calls", () => {
    const taken = new Set(["Iron"]);
    expect(uniqueName("Iron", taken)).toBe("Iron (2)");
    expect(uniqueName("Iron", taken)).toBe("Iron (3)");
    expect(uniqueName("Iron", taken)).toBe("Iron (4)");
  });
});

describe("resolveImport", () => {
  it("suffixes colliding block and group names, keeping local group refs", () => {
    const r = resolveImport(planEnv, ["Iron plates"], ["Smelting", "Smelting (2)"]);
    expect(r.blocks.map((b) => b.name)).toEqual(["Iron plates (2)", "Gears"]);
    expect(r.blocks[0].group).toBe(7); // still the plan-local id — caller remaps
    expect(r.groups).toEqual([
      { localId: 7, name: "Smelting (3)" },
      { localId: 9, name: "Nested", parent: 7 },
    ]);
  });

  it("de-collides duplicate names WITHIN one import", () => {
    const env: PlanEnvelope = {
      ...planEnv,
      blocks: [
        { name: "Same", icon: null, enabled: true, doc },
        { name: "Same", icon: null, enabled: true, doc },
      ],
      groups: [],
    };
    const r = resolveImport(env, [], []);
    expect(r.blocks.map((b) => b.name)).toEqual(["Same", "Same (2)"]);
  });

  it("treats a block envelope as a single-block import with no groups", () => {
    const r = resolveImport(blockEnv, ["Iron plates"], []);
    expect(r.groups).toEqual([]);
    expect(r.blocks.map((b) => b.name)).toEqual(["Iron plates (2)"]);
  });
});

describe("exportFileName", () => {
  it("slugs the block/plan name", () => {
    expect(exportFileName(blockEnv)).toBe("iron-plates.pyops.json");
    expect(exportFileName(planEnv)).toBe("my-base.pyops.json");
  });

  it("falls back to the kind when the name has no usable characters", () => {
    expect(exportFileName({ ...blockEnv, block: { ...blockEnv.block, name: "×××" } })).toBe(
      "block.pyops.json",
    );
  });
});
