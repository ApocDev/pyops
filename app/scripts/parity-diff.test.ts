import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { type BlockSnapshot, type Snapshot, diffSnapshots } from "./parity-diff.ts";

const ash = { item: "ash", kind: "item", role: "import", rate: 6 };
const furnace = { machine: "stone-furnace", recipe: "brick", count: 2 };

const block = (rows: Pick<BlockSnapshot, "flows" | "machines">): BlockSnapshot => ({
  id: 1,
  name: "Bricks",
  broken: false,
  solveStatus: "solved",
  electricityW: 0,
  pollutionPerMin: 1,
  ...rows,
});
const snap = (b: BlockSnapshot): Snapshot => ({ commit: "x", source: "x", blocks: [b] });

describe("parity diff", () => {
  it("counts duplicated rows instead of treating them as one", () => {
    const base = snap(block({ flows: [ash], machines: [furnace, furnace, furnace] }));
    const head = snap(block({ flows: [ash, ash, ash], machines: [furnace] }));
    expect(diffSnapshots(base, head)).toEqual([
      {
        id: 1,
        name: "Bricks",
        lines: [
          `flows + ${JSON.stringify(ash)} (×2)`,
          `machines - ${JSON.stringify(furnace)} (×2)`,
        ],
      },
    ]);
    expect(diffSnapshots(base, base)).toEqual([]);
  });

  it("exits 1 when the only difference is a duplicated row", () => {
    const dir = mkdtempSync(join(tmpdir(), "pyops-parity-test-"));
    try {
      const basePath = join(dir, "base.json");
      const headPath = join(dir, "head.json");
      writeFileSync(basePath, JSON.stringify(snap(block({ flows: [ash], machines: [] }))));
      writeFileSync(headPath, JSON.stringify(snap(block({ flows: [ash, ash], machines: [] }))));
      const run = spawnSync(
        process.execPath,
        ["--import", "tsx", join(import.meta.dirname, "parity.ts"), "diff", basePath, headPath],
        { encoding: "utf8" },
      );
      expect(run.stdout).toContain(`flows + ${JSON.stringify(ash)}`);
      expect(run.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to write a snapshot over the source db, even through a symlink", () => {
    const dir = mkdtempSync(join(tmpdir(), "pyops-parity-test-"));
    try {
      const db = join(dir, "project.db");
      const out = join(dir, "out.json");
      writeFileSync(db, "not really a db");
      symlinkSync(db, out);
      const run = spawnSync(
        process.execPath,
        ["--import", "tsx", join(import.meta.dirname, "parity.ts"), "snapshot", db, out],
        { encoding: "utf8" },
      );
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain("refusing to write the snapshot over the source db");
      expect(readFileSync(db, "utf8")).toBe("not really a db");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
