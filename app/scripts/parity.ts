/**
 * Py parity check: prove a solver or schema change leaves every block's solve
 * unchanged. Two commands:
 *
 *   vp run parity snapshot <project.db> <out.json>
 *     Copies the project db to a temp file, re-solves every block with the code
 *     in this checkout, and writes each block's cached solve (status,
 *     electricity, pollution, block_flows, block_machines) to <out.json>. The
 *     source db is only read, never written.
 *
 *   vp run parity diff <base.json> <head.json>
 *     Prints every difference between two snapshots and exits 1 if any.
 *
 * Take one snapshot per code version (e.g. a `main` worktree and your branch)
 * from the same project db, then diff them. See docs/development/solver.md.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

type Row = Record<string, string | number>;

type BlockSnapshot = {
  id: number;
  name: string;
  /** The solve couldn't run (missing reference data); the cache is left as-is. */
  broken: boolean;
  solveStatus: string | null;
  electricityW: number | null;
  pollutionPerMin: number | null;
  flows: Row[];
  machines: Row[];
};

type Snapshot = { commit: string; source: string; blocks: BlockSnapshot[] };

/** A cache row without its block id, with null columns dropped so a column
 * added as nullable (null on every row) doesn't read as a change. */
function cleanRow(row: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "block_id" || v === null) continue;
    out[k] = v as string | number;
  }
  return out;
}

/** Rows in a stable order, so insertion order never shows up as a diff. */
function sortRows(rows: Row[]): Row[] {
  return rows
    .map((r) => [JSON.stringify(r), r] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, r]) => r);
}

function gitCommit(): string {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  try {
    return git("rev-parse", "--short", "HEAD") + (git("status", "--porcelain") ? "+dirty" : "");
  } catch {
    return "unknown";
  }
}

async function snapshot(source: string, out: string) {
  const dir = mkdtempSync(join(tmpdir(), "pyops-parity-"));
  const copy = join(dir, "project.db");
  try {
    // The backup API gives a consistent copy even while the app has the db open.
    const src = new Database(source, { readonly: true, fileMustExist: true });
    await src.backup(copy);
    src.close();

    // The db layer binds to DATABASE_URL when it is first imported, so point it
    // at the copy before loading any server module.
    process.env.DATABASE_URL = copy;
    const { db } = await import("../src/db/index.server.ts");
    const { computeBlock, persistBlock } = await import("../src/server/block-compute.server.ts");
    type SolveInput = Parameters<typeof computeBlock>[0];
    const { withUndoAction } = await import("../src/server/undo-action.server.ts");
    const sqlite = db.$client;

    const rows = sqlite
      .prepare(`SELECT id, name, icon_kind, icon_name, data FROM blocks ORDER BY id`)
      .all() as {
      id: number;
      name: string;
      icon_kind: string | null;
      icon_name: string | null;
      data: string;
    }[];

    const broken = new Set<number>();
    // The same solve + persist the app runs on a re-solve (`resolveAllBlocks`),
    // with undo tracking off because it is a cache refresh, not an edit.
    await withUndoAction(
      "parity snapshot",
      async () => {
        for (const b of rows) {
          const data = JSON.parse(b.data) as SolveInput;
          const r = await computeBlock(data);
          if (r.broken) broken.add(b.id);
          await persistBlock(
            {
              id: b.id,
              name: b.name,
              iconKind: b.icon_kind,
              iconName: b.icon_name,
              keepUpdatedAt: true,
            },
            data,
            r,
          );
        }
      },
      { undo: false },
    );

    const solved = sqlite.prepare(
      `SELECT solve_status, electricity_w, pollution_per_min FROM blocks WHERE id = ?`,
    );
    const flows = sqlite.prepare(`SELECT * FROM block_flows WHERE block_id = ?`);
    const machines = sqlite.prepare(`SELECT * FROM block_machines WHERE block_id = ?`);
    const blocks: BlockSnapshot[] = rows.map((b) => {
      const s = solved.get(b.id) as {
        solve_status: string | null;
        electricity_w: number | null;
        pollution_per_min: number | null;
      };
      return {
        id: b.id,
        name: b.name,
        broken: broken.has(b.id),
        solveStatus: s.solve_status,
        electricityW: s.electricity_w,
        pollutionPerMin: s.pollution_per_min,
        flows: sortRows((flows.all(b.id) as Record<string, unknown>[]).map(cleanRow)),
        machines: sortRows((machines.all(b.id) as Record<string, unknown>[]).map(cleanRow)),
      };
    });
    sqlite.close();

    const snap: Snapshot = { commit: gitCommit(), source, blocks };
    writeFileSync(out, `${JSON.stringify(snap, null, 1)}\n`);
    const count = (k: "flows" | "machines") => blocks.reduce((n, b) => n + b[k].length, 0);
    console.log(
      `${blocks.length} blocks (${broken.size} broken), ${count("flows")} flows, ` +
        `${count("machines")} machine rows at ${snap.commit} → ${out}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Differences between two blocks' snapshots, one line each. */
function diffBlock(a: BlockSnapshot, b: BlockSnapshot): string[] {
  const lines: string[] = [];
  for (const k of ["name", "broken", "solveStatus", "electricityW", "pollutionPerMin"] as const) {
    if (a[k] !== b[k]) lines.push(`${k}: ${a[k]} → ${b[k]}`);
  }
  for (const k of ["flows", "machines"] as const) {
    const before = new Set(a[k].map((r) => JSON.stringify(r)));
    const after = new Set(b[k].map((r) => JSON.stringify(r)));
    for (const r of before) if (!after.has(r)) lines.push(`${k} - ${r}`);
    for (const r of after) if (!before.has(r)) lines.push(`${k} + ${r}`);
  }
  return lines;
}

function diff(basePath: string, headPath: string) {
  const read = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Snapshot;
  const base = read(basePath);
  const head = read(headPath);
  const headById = new Map(head.blocks.map((b) => [b.id, b]));
  let changed = 0;
  for (const a of base.blocks) {
    const b = headById.get(a.id);
    headById.delete(a.id);
    const lines = b ? diffBlock(a, b) : ["missing from head"];
    if (!lines.length) continue;
    changed++;
    console.log(`block ${a.id} "${a.name}"`);
    for (const l of lines) console.log(`  ${l}`);
  }
  for (const b of headById.values()) {
    changed++;
    console.log(`block ${b.id} "${b.name}"\n  missing from base`);
  }
  console.log(
    `${base.commit} → ${head.commit}: ${base.blocks.length} blocks compared, ` +
      `${changed} with differences`,
  );
  if (changed) process.exitCode = 1;
}

const [cmd, a, b] = process.argv.slice(2).filter((arg) => arg !== "--");
if (cmd === "snapshot" && a && b) await snapshot(a, b);
else if (cmd === "diff" && a && b) diff(a, b);
else {
  console.error(
    "usage: vp run parity snapshot <project.db> <out.json>\n" +
      "       vp run parity diff <base.json> <head.json>",
  );
  process.exitCode = 2;
}
