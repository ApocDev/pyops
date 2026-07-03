import { describe, expect, it } from "vite-plus/test";

import { type JournalEntry, pendingEntries, readJournal } from "./db-migrations.server.ts";

const journal: JournalEntry[] = [
  { tag: "0000_baseline", when: 1000 },
  { tag: "0001_add_column", when: 2000 },
  { tag: "0002_add_index", when: 3000 },
];

describe("pendingEntries", () => {
  it("reports nothing pending when the last applied matches the newest entry", () => {
    expect(pendingEntries(journal, 3000)).toEqual([]);
  });

  it("reports entries newer than the last applied timestamp, oldest first", () => {
    expect(pendingEntries(journal, 1000).map((e) => e.tag)).toEqual([
      "0001_add_column",
      "0002_add_index",
    ]);
  });

  it("reports the whole journal pending against an empty migrations table", () => {
    // an empty `__drizzle_migrations` reads as lastApplied 0
    expect(pendingEntries(journal, 0)).toHaveLength(3);
  });

  it("mirrors drizzle's strict comparison (equal timestamps count as applied)", () => {
    expect(pendingEntries(journal, 2000).map((e) => e.tag)).toEqual(["0002_add_index"]);
  });
});

describe("readJournal", () => {
  it("parses the bundled drizzle journal into tag/when entries", () => {
    // vitest runs from app/, so MIGRATIONS_DIR resolves to the real drizzle/
    const entries = readJournal();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(typeof e.tag).toBe("string");
      expect(typeof e.when).toBe("number");
    }
    // journal order is generation order — `when` must be ascending
    const whens = entries.map((e) => e.when);
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
  });
});
