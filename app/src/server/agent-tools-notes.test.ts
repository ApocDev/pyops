/**
 * listNotes (#128): a read-only tool over the separate `notes` table (a flat
 * scratch surface distinct from the task tree) so the assistant can see the
 * user's own goals/decisions/reminders when planning.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { switchDatabase } from "../db/index.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { listNotes } from "./agent-tools.server.ts";

type Note = { id: number; title: string | null; body: string | null };

const call = async (): Promise<Note[]> =>
  (await listNotes.execute!({}, { toolCallId: "test", messages: [] })) as Note[];

describe("listNotes", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
  });

  afterEach(() => fx.cleanup());

  it("returns an empty list when there are no notes", async () => {
    fx.db.close();
    switchDatabase(fx.file);
    expect(await call()).toEqual([]);
  });

  it("returns id/title/body only, ordered by sort_order then updated_at desc", async () => {
    fx.db.exec(`
      INSERT INTO notes (id, title, body, sort_order, updated_at) VALUES
        (1, 'First',  'stone furnaces before steel',   1, 100),
        (2, 'Second', 'remember hot-air trick',         2, 200),
        (3, NULL,     'untitled scratch calc',          NULL, 50);
    `);
    fx.db.close();
    switchDatabase(fx.file);

    const notes = await call();
    expect(notes).toEqual([
      { id: 3, title: null, body: "untitled scratch calc" },
      { id: 1, title: "First", body: "stone furnaces before steel" },
      { id: 2, title: "Second", body: "remember hot-air trick" },
    ]);
    // no leaked internal fields
    for (const n of notes) expect(Object.keys(n).sort()).toEqual(["body", "id", "title"]);
  });
});
