import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { currentDatabaseFile, db, evictDatabase, switchDatabase } from "../db/index.server.ts";
import { configureSqliteConnection, migrateToLatest, SQLITE_BUSY_TIMEOUT_MS } from "./provision.ts";

const originalDatabase = currentDatabaseFile();
const tempDirs: string[] = [];

function projectFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pyops-sqlite-policy-"));
  tempDirs.push(dir);
  return join(dir, `${name}.db`);
}

function expectProjectPolicy(): void {
  const sqlite = db.$client;
  expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
  expect(sqlite.pragma("busy_timeout", { simple: true })).toBe(SQLITE_BUSY_TIMEOUT_MS);
  expect(sqlite.pragma("synchronous", { simple: true })).toBe(1);
  expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
}

afterEach(() => {
  switchDatabase(originalDatabase);
  for (const dir of tempDirs.splice(0)) {
    for (const name of ["a.db", "b.db"]) evictDatabase(join(dir, name));
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("SQLite project connection policy", () => {
  it("configures every active connection without affecting project switching", () => {
    const a = projectFile("a");
    const b = projectFile("b");
    migrateToLatest(a);
    migrateToLatest(b);

    switchDatabase(a);
    expectProjectPolicy();
    db.$client.prepare("INSERT INTO meta (key, value) VALUES ('marker', 'a')").run();

    switchDatabase(b);
    expectProjectPolicy();
    db.$client.prepare("INSERT INTO meta (key, value) VALUES ('marker', 'b')").run();

    switchDatabase(a);
    expectProjectPolicy();
    expect(db.$client.prepare("SELECT value FROM meta WHERE key = 'marker'").pluck().get()).toBe(
      "a",
    );
  });

  it("does not change journal or durability settings on read-only handles", () => {
    const file = projectFile("a");
    const writer = new Database(file);
    writer.exec("CREATE TABLE marker (value TEXT)");
    writer.close();

    const reader = new Database(file, { readonly: true, fileMustExist: true });
    try {
      configureSqliteConnection(reader, { readonly: true });
      expect(reader.pragma("journal_mode", { simple: true })).toBe("delete");
      expect(reader.pragma("busy_timeout", { simple: true })).toBe(SQLITE_BUSY_TIMEOUT_MS);
      expect(reader.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally {
      reader.close();
    }
  });
});
