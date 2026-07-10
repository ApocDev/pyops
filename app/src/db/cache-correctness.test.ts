import { rmSync, renameSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { evictDatabase, switchDatabase } from "./index.server.ts";
import {
  getResearchHorizon,
  isExcluded,
  metaAll,
  recipeAvailability,
  setExclusions,
  setResearchHorizon,
} from "./queries.server.ts";
import { makeTestDb, type TestDb } from "./test-helpers.ts";

const fixtures: TestDb[] = [];

async function fixture(): Promise<TestDb> {
  const fx = await makeTestDb();
  fixtures.push(fx);
  return fx;
}

afterEach(() => {
  for (const fx of fixtures.splice(0)) {
    evictDatabase(fx.file);
    fx.cleanup();
  }
});

describe("project-scoped SQLite state", () => {
  it("reads the research horizon from the active project after every switch", async () => {
    const a = await fixture();
    const b = await fixture();
    a.db.close();
    b.db.close();

    switchDatabase(a.file);
    setResearchHorizon({ mode: "now", packs: ["automation-pack"] });
    switchDatabase(b.file);
    setResearchHorizon({ mode: "future" });

    switchDatabase(a.file);
    expect(getResearchHorizon().mode).toBe("now");
    switchDatabase(b.file);
    expect(getResearchHorizon().mode).toBe("future");
  });

  it("does not reuse exclusions from another project", async () => {
    const a = await fixture();
    const b = await fixture();
    a.db.close();
    b.db.close();

    switchDatabase(a.file);
    setExclusions({ globs: ["project-a-*"] });
    switchDatabase(b.file);
    setExclusions({ globs: ["project-b-*"] });

    switchDatabase(a.file);
    expect(isExcluded("project-a-item")).toBe(true);
    expect(isExcluded("project-b-item")).toBe(false);
    switchDatabase(b.file);
    expect(isExcluded("project-a-item")).toBe(false);
    expect(isExcluded("project-b-item")).toBe(true);
  });

  it("observes exclusion changes written directly to SQLite", async () => {
    const fx = await fixture();
    fx.db.close();
    switchDatabase(fx.file);
    setExclusions({ globs: ["before-*"] });
    expect(isExcluded("before-item")).toBe(true);

    const writer = new Database(fx.file);
    writer
      .prepare("UPDATE meta SET value = ? WHERE key = 'excluded'")
      .run(JSON.stringify({ globs: ["after-*"] }));
    writer.close();

    expect(isExcluded("before-item")).toBe(false);
    expect(isExcluded("after-item")).toBe(true);
  });

  it("re-reads technology closures after reference data changes", async () => {
    const fx = await fixture();
    fx.db.exec(`
      INSERT INTO recipes (name, kind, enabled, hidden)
        VALUES ('locked-recipe', 'real', 0, 0);
      INSERT INTO technologies (name, unit_count, enabled, is_turd)
        VALUES ('locked-tech', 1, 1, 0);
      INSERT INTO tech_unlocks (technology, recipe)
        VALUES ('locked-tech', 'locked-recipe');
      INSERT INTO tech_ingredients (technology, name, amount)
        VALUES ('locked-tech', 'pack-a', 1);
    `);
    fx.db.close();
    switchDatabase(fx.file);
    setResearchHorizon({ mode: "now", packs: ["pack-a"] });

    expect(recipeAvailability("locked-recipe", false).avail.research).toBe("available");

    const importer = new Database(fx.file);
    importer.exec(`
      DELETE FROM tech_ingredients WHERE technology = 'locked-tech';
      INSERT INTO tech_ingredients (technology, name, amount)
        VALUES ('locked-tech', 'pack-b', 1);
    `);
    importer.close();

    const refreshed = recipeAvailability("locked-recipe", false).avail;
    expect(refreshed.research).toBe("needs-research");
    expect(refreshed.needs).toEqual(["pack-b"]);
  });
});

describe("database connection eviction", () => {
  it("reopens a project path after the file occupying it is replaced", async () => {
    const original = await fixture();
    const replacement = await fixture();
    original.db.prepare("INSERT INTO meta (key, value) VALUES ('marker', 'old')").run();
    replacement.db.prepare("INSERT INTO meta (key, value) VALUES ('marker', 'new')").run();
    original.db.close();
    replacement.db.close();

    switchDatabase(original.file);
    expect(metaAll().marker).toBe("old");
    expect(evictDatabase(original.file)).toBe(true);

    rmSync(original.file);
    renameSync(replacement.file, original.file);

    expect(metaAll().marker).toBe("new");
    expect(evictDatabase(original.file)).toBe(true);
    expect(evictDatabase(original.file)).toBe(false);
  });
});
