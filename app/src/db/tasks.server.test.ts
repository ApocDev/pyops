import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db, evictDatabase, switchDatabase } from "./index.server.ts";
import { deleteTask, listTasks, prioritizationInput, setPriorities } from "./tasks.server.ts";
import { makeTestDb, type TestDb } from "./test-helpers.ts";
import { withUndoAction } from "../server/undo-action.server.ts";
import { undoLast } from "../server/undo.server.ts";

let fx: TestDb;

beforeEach(async () => {
  fx = await makeTestDb();
  fx.db.exec(`
    INSERT INTO items (name, display) VALUES ('ore', 'Ore'), ('plate', 'Plate');
    INSERT INTO fluids (name, display) VALUES ('steam', 'Steam');
    INSERT INTO recipes (name, display, kind, hidden) VALUES ('smelt', 'Smelt ore', 'real', 0);
    INSERT INTO technologies (name, display) VALUES ('automation', 'Automation');
    INSERT INTO blocks (id, name, data, icon_kind, icon_name)
      VALUES (10, 'Starter block', '{}', 'item', 'plate');

    INSERT INTO tasks (id, parent_id, title, body, status, done, priority, priority_reason, sort_order)
      VALUES
        (1, NULL, 'Root', 'root body', 'open', 0, 'critical', 'old root', 0),
        (2, 1, 'Child', 'child body', 'in_progress', 0, 'high', 'old child', 0),
        (3, 2, 'Grandchild', 'grandchild body', 'open', 0, 'medium', 'old grandchild', 0),
        (4, NULL, 'Unrelated', 'unrelated body', 'closed', 0, 'low', 'old unrelated', 1);
    INSERT INTO task_steps (id, task_id, text, done, sort_order) VALUES
      (1, 1, 'root step', 0, 0),
      (2, 2, 'child step', 1, 0),
      (3, 4, 'unrelated step', 0, 0);
    INSERT INTO task_links (id, task_id, ref_kind, ref_name, sort_order) VALUES
      (1, 1, 'item', 'ore', 0),
      (2, 1, 'fluid', 'steam', 1),
      (3, 2, 'item', 'plate', 0),
      (4, 2, 'recipe', 'smelt', 1),
      (5, 3, 'technology', 'automation', 0),
      (6, 3, 'block', '10', 1),
      (7, 3, 'location', 'nauvis|1.2|2.6', 2),
      (8, 4, 'item', 'ore', 0);
  `);
  fx.db.close();
  switchDatabase(fx.file);
  // Run the legacy-schema guard before query-shape spies are installed.
  listTasks();
});

afterEach(() => {
  evictDatabase(fx.file);
  fx.cleanup();
});

describe("deleteTask", () => {
  it("deletes a whole subtree in three set-oriented statements and remains undoable", async () => {
    const prepare = vi.spyOn(db.$client, "prepare");
    await withUndoAction("Delete task", () => deleteTask(1));
    const statements = prepare.mock.calls.map(([statement]) => statement.toLowerCase());
    prepare.mockRestore();

    expect(
      statements.filter((statement) => statement.includes("delete from task_steps")),
    ).toHaveLength(1);
    expect(
      statements.filter((statement) => statement.includes("delete from task_links")),
    ).toHaveLength(1);
    expect(statements.filter((statement) => statement.includes("delete from tasks"))).toHaveLength(
      1,
    );
    expect(db.$client.prepare("SELECT id FROM tasks ORDER BY id").all()).toEqual([{ id: 4 }]);
    expect(db.$client.prepare("SELECT id FROM task_steps ORDER BY id").all()).toEqual([{ id: 3 }]);
    expect(db.$client.prepare("SELECT id FROM task_links ORDER BY id").all()).toEqual([{ id: 8 }]);

    expect(await undoLast()).toEqual({ undone: "Delete task", changedBlockIds: [] });
    expect(db.$client.prepare("SELECT id FROM tasks ORDER BY id").all()).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
    ]);
    expect(db.$client.prepare("SELECT id FROM task_steps ORDER BY id").all()).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
    expect(db.$client.prepare("SELECT id FROM task_links ORDER BY id").all()).toHaveLength(8);
  });
});

describe("setPriorities", () => {
  it("applies and clears rankings with one UPDATE, retaining the last duplicate id", () => {
    const prepare = vi.spyOn(db.$client, "prepare");
    setPriorities([
      { id: 1, priority: "high", reason: "first" },
      { id: 2, priority: "not-a-priority", reason: "invalid becomes null" },
      { id: 1, priority: "low", reason: "last" },
    ]);
    const statements = prepare.mock.calls.map(([statement]) => statement.toLowerCase());
    prepare.mockRestore();

    expect(statements.filter((statement) => statement.includes("update tasks set"))).toHaveLength(
      1,
    );
    expect(
      db.$client
        .prepare(
          "SELECT id, priority, priority_reason AS reason, priority_at AS at FROM tasks ORDER BY id",
        )
        .all(),
    ).toEqual([
      { id: 1, priority: "low", reason: "last", at: expect.any(Number) },
      { id: 2, priority: null, reason: "invalid becomes null", at: expect.any(Number) },
      { id: 3, priority: null, reason: null, at: null },
      { id: 4, priority: null, reason: null, at: null },
    ]);
  });

  it("clears every ranking with one UPDATE when the result set is empty", () => {
    const prepare = vi.spyOn(db.$client, "prepare");
    setPriorities([]);
    const statements = prepare.mock.calls.map(([statement]) => statement.toLowerCase());
    prepare.mockRestore();

    expect(statements.filter((statement) => statement.includes("update tasks set"))).toHaveLength(
      1,
    );
    expect(
      db.$client.prepare("SELECT count(*) AS n FROM tasks WHERE priority IS NOT NULL").get(),
    ).toEqual({ n: 0 });
  });
});

describe("prioritizationInput", () => {
  it("batch-loads task links and each reference kind while preserving link order", () => {
    const prepare = vi.spyOn(db.$client, "prepare");
    const input = prioritizationInput();
    const statements = prepare.mock.calls.map(([statement]) => statement.toLowerCase());
    prepare.mockRestore();

    expect(input.map((task) => task.id)).toEqual([1, 2, 3]);
    expect(input.map((task) => task.links)).toEqual([
      ["item:Ore", "fluid:Steam"],
      ["item:Plate", "recipe:Smelt ore"],
      ["technology:Automation", "block:Starter block", "location:nauvis (1, 3)"],
    ]);
    expect(statements.filter((statement) => statement.includes('from "task_links"'))).toHaveLength(
      1,
    );
    for (const table of ["items", "fluids", "recipes", "technologies", "blocks"]) {
      expect(statements.filter((statement) => statement.includes(`from "${table}"`))).toHaveLength(
        1,
      );
    }
  });
});
