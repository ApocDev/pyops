/** Snapshot shapes and the pure diff behind `vp run parity diff` (see parity.ts). */

export type Row = Record<string, string | number>;

export type BlockSnapshot = {
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

export type Snapshot = { commit: string; source: string; blocks: BlockSnapshot[] };

/** How many times each serialized row occurs. The cache tables have no
 * uniqueness constraint, so a duplicated row is a real difference. */
function rowCounts(rows: Row[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = JSON.stringify(r);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Differences between two blocks' snapshots, one line each. A row's extra
 * copies print as `+` (only in head) or `-` (only in base) with a count. */
export function diffBlock(a: BlockSnapshot, b: BlockSnapshot): string[] {
  const lines: string[] = [];
  for (const k of ["name", "broken", "solveStatus", "electricityW", "pollutionPerMin"] as const) {
    if (a[k] !== b[k]) lines.push(`${k}: ${a[k]} → ${b[k]}`);
  }
  for (const k of ["flows", "machines"] as const) {
    const before = rowCounts(a[k]);
    const after = rowCounts(b[k]);
    for (const row of new Set([...before.keys(), ...after.keys()])) {
      const delta = (after.get(row) ?? 0) - (before.get(row) ?? 0);
      if (delta === 0) continue;
      const times = Math.abs(delta) > 1 ? ` (×${Math.abs(delta)})` : "";
      lines.push(`${k} ${delta > 0 ? "+" : "-"} ${row}${times}`);
    }
  }
  return lines;
}

/** Every changed block, keyed by block id, with its difference lines. Blocks
 * present on only one side count as changed. */
export function diffSnapshots(base: Snapshot, head: Snapshot) {
  const headById = new Map(head.blocks.map((b) => [b.id, b]));
  const changed: { id: number; name: string; lines: string[] }[] = [];
  for (const a of base.blocks) {
    const b = headById.get(a.id);
    headById.delete(a.id);
    const lines = b ? diffBlock(a, b) : ["missing from head"];
    if (lines.length) changed.push({ id: a.id, name: a.name, lines });
  }
  for (const b of headById.values()) {
    changed.push({ id: b.id, name: b.name, lines: ["missing from base"] });
  }
  return changed;
}
