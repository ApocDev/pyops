import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { db, evictDatabase, switchDatabase } from "./index.server.ts";
import {
  blockReferenceFingerprint,
  listBlocks,
  saveBlockRow,
  setResearchHorizon,
} from "./queries.server.ts";
import {
  bumpSolveGeneration,
  currentSolveGeneration,
  isCurrentSolveFingerprint,
  markSolveGenerationResolved,
  solveGenerationNeedsRefresh,
  solveProjectionVersionNeedsRefresh,
  stampSolveFingerprint,
} from "./solve-generation.server.ts";
import { makeTestDb, type TestDb } from "./test-helpers.ts";
import { ensureSolvedProjections } from "../server/block-compute.server.ts";

let fx: TestDb;

beforeEach(async () => {
  fx = await makeTestDb();
  fx.db.close();
  switchDatabase(fx.file);
});

afterEach(() => {
  evictDatabase(fx.file);
  fx.cleanup();
});

describe("solve projection generation", () => {
  it("uses SQLite as the generation source of truth", () => {
    expect(currentSolveGeneration()).toBe(1);
    expect(solveGenerationNeedsRefresh()).toBe(true);
    const first = stampSolveFingerprint("recipe-hash");
    expect(first).toBe("g1:recipe-hash");
    expect(isCurrentSolveFingerprint(first)).toBe(true);
    markSolveGenerationResolved();
    expect(solveGenerationNeedsRefresh()).toBe(false);

    expect(bumpSolveGeneration()).toBe(2);
    expect(solveGenerationNeedsRefresh()).toBe(true);
    expect(currentSolveGeneration()).toBe(2);
    expect(isCurrentSolveFingerprint(first)).toBe(false);
    expect(isCurrentSolveFingerprint(stampSolveFingerprint("recipe-hash"))).toBe(true);
    expect(isCurrentSolveFingerprint("legacy-hash")).toBe(false);
  });

  it("refreshes once when the materialized solve algorithm version changes", () => {
    markSolveGenerationResolved();
    expect(solveGenerationNeedsRefresh()).toBe(false);

    db.run(sql`
      UPDATE meta SET value = 'old-version' WHERE key = 'solve_projection_version'
    `);
    expect(solveGenerationNeedsRefresh()).toBe(true);
    expect(solveProjectionVersionNeedsRefresh()).toBe(true);

    markSolveGenerationResolved();
    expect(solveGenerationNeedsRefresh()).toBe(false);
    expect(solveProjectionVersionNeedsRefresh()).toBe(false);
  });

  it("re-solves every block once after a projection algorithm upgrade", async () => {
    db.run(sql`INSERT INTO items (name, display) VALUES ('plate', 'Plate'), ('ore', 'Ore')`);
    db.run(sql`INSERT INTO recipes (name, kind, hidden) VALUES ('smelt', 'real', 0)`);
    db.run(sql`
      INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount)
      VALUES ('smelt', 0, 'item', 'ore', 1)
    `);
    db.run(sql`
      INSERT INTO recipe_products (recipe, idx, kind, name, amount)
      VALUES ('smelt', 0, 'item', 'plate', 1)
    `);
    const data = { goals: [{ name: "plate", rate: 1 }], recipes: ["smelt"] };
    saveBlockRow(
      {
        name: "Smelting",
        iconKind: "item",
        iconName: "plate",
        data,
        electricityW: 0,
        solveStatus: "solved",
        dataFingerprint: blockReferenceFingerprint(data),
      },
      [{ item: "plate", kind: "item", role: "primary", rate: 999 }],
    );
    markSolveGenerationResolved();
    db.run(sql`
      UPDATE meta SET value = 'old-version' WHERE key = 'solve_projection_version'
    `);

    expect(await ensureSolvedProjections()).toBe(1);
    expect(solveGenerationNeedsRefresh()).toBe(false);
    expect(db.all(sql`SELECT rate FROM block_flows WHERE item = 'plate'`)).toEqual([{ rate: 1 }]);
  });

  it("marks and lazily refreshes projections only when research context changes", async () => {
    db.run(sql`INSERT INTO items (name, display) VALUES ('plate', 'Plate'), ('ore', 'Ore')`);
    db.run(sql`
      INSERT INTO recipes (name, kind, hidden) VALUES ('smelt', 'real', 0)
    `);
    db.run(sql`
      INSERT INTO recipe_ingredients (recipe, idx, kind, name, amount)
      VALUES ('smelt', 0, 'item', 'ore', 1)
    `);
    db.run(sql`
      INSERT INTO recipe_products (recipe, idx, kind, name, amount)
      VALUES ('smelt', 0, 'item', 'plate', 1)
    `);
    const data = { goals: [{ name: "plate", rate: 1 }], recipes: ["smelt"] };
    const id = saveBlockRow(
      {
        name: "Smelting",
        iconKind: "item",
        iconName: "plate",
        data,
        electricityW: 0,
        solveStatus: "solved",
        dataFingerprint: blockReferenceFingerprint(data),
      },
      [{ item: "plate", kind: "item", role: "primary", rate: 1 }],
    );
    expect(listBlocks().find((block) => block.id === id)?.stale).toBe(false);

    expect(setResearchHorizon({ mode: "now", researched: ["b", "a"] })).toBe(true);
    expect(currentSolveGeneration()).toBe(2);
    expect(listBlocks().find((block) => block.id === id)).toMatchObject({
      stale: true,
      health: "warn",
    });

    // Sets are canonicalized before comparison, so heartbeat/order noise does
    // not advance the generation or trigger another factory-wide solve.
    expect(setResearchHorizon({ mode: "now", researched: ["a", "b"] })).toBe(false);
    expect(currentSolveGeneration()).toBe(2);

    expect(await ensureSolvedProjections()).toBe(1);
    expect(solveGenerationNeedsRefresh()).toBe(false);
    expect(listBlocks().find((block) => block.id === id)?.stale).toBe(false);
    expect(await ensureSolvedProjections()).toBe(0);
  });
});
