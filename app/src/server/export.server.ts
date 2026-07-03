/**
 * Block/plan export + import against the active project db (#82). The pure
 * envelope logic (validation, collision suffixing) lives in lib/plan-export.ts;
 * this module reads/writes the db and re-solves imported blocks so their cached
 * flows are fresh. Server-only (import protection keeps it off the client).
 */
import * as q from "../db/queries.server.ts";
import { primaryGoal } from "../lib/goals";
import {
  PYOPS_EXPORT_VERSION,
  parseExportEnvelope,
  resolveImport,
  type BlockEnvelope,
  type ExportedBlock,
  type PlanEnvelope,
} from "../lib/plan-export";
import { computeBlock, persistBlock, type SolveInput } from "./block-compute.server.ts";

type BlockRow = NonNullable<ReturnType<typeof q.getBlock>>;

function toExportedBlock(row: BlockRow): ExportedBlock {
  return {
    name: row.name,
    icon: row.iconKind && row.iconName ? { kind: row.iconKind, name: row.iconName } : null,
    enabled: row.enabled,
    doc: row.data, // getBlock normalizes legacy shapes on read
  };
}

/** One block as a self-contained shareable document. */
export function buildBlockExport(id: number): BlockEnvelope {
  const row = q.getBlock(id);
  if (!row) throw new Error(`block ${id} not found`);
  return {
    pyops: PYOPS_EXPORT_VERSION,
    kind: "block",
    exportedAt: new Date().toISOString(),
    block: toExportedBlock(row),
  };
}

/** The whole plan (every block + sidebar folder), or one folder's subtree when
 * `groupId` is given. Group/parent references use the db ids as plan-local ids —
 * they're remapped to fresh rows on import. */
export function buildPlanExport(groupId?: number): PlanEnvelope {
  const allGroups = q.listGroups();
  let included: Set<number> | null = null; // null = everything
  if (groupId != null) {
    included = new Set([groupId]);
    // walk the (parent_id) tree — children of included groups join the set
    for (let grew = true; grew; ) {
      grew = false;
      for (const g of allGroups) {
        if (g.parentId != null && included.has(g.parentId) && !included.has(g.id)) {
          included.add(g.id);
          grew = true;
        }
      }
    }
  }
  const groups = allGroups.filter((g) => included === null || included.has(g.id));
  const groupIds = new Set(groups.map((g) => g.id));
  const blocks: ExportedBlock[] = [];
  for (const b of q.listBlocks()) {
    if (included !== null && (b.groupId == null || !included.has(b.groupId))) continue;
    const row = q.getBlock(b.id);
    if (!row) continue;
    blocks.push({
      ...toExportedBlock(row),
      ...(row.groupId != null && groupIds.has(row.groupId) ? { group: row.groupId } : {}),
    });
  }
  const name =
    groupId != null
      ? (allGroups.find((g) => g.id === groupId)?.name ?? "plan")
      : (q.metaAll().project_name ?? "plan");
  return {
    pyops: PYOPS_EXPORT_VERSION,
    kind: "plan",
    exportedAt: new Date().toISOString(),
    name,
    blocks,
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      ...(g.parentId != null && groupIds.has(g.parentId) ? { parent: g.parentId } : {}),
    })),
  };
}

export type ImportedBlockReport = {
  id: number;
  name: string;
  /** referenced recipes/goods missing from this project's data — imported anyway,
   * flagged broken (the mod-drift degrade path) */
  missing: { recipes: string[]; goods: string[] };
  broken: boolean;
};

export type ImportResult = {
  kind: "block" | "plan";
  blocks: ImportedBlockReport[];
  groupsCreated: number;
};

/** Import a block/plan envelope: create NEW blocks (fresh ids, names suffixed on
 * collision) and new sidebar folders, re-solve each block so its cached flows are
 * current, and report which imports reference recipes/goods this project's data
 * doesn't have (created broken rather than rejected). */
export async function importEnvelope(input: unknown): Promise<ImportResult> {
  const parsed = parseExportEnvelope(input);
  if (!parsed.ok) throw new Error(parsed.error);
  const env = parsed.envelope;

  const resolved = resolveImport(
    env,
    q.listBlocks().map((b) => b.name),
    q.listGroups().map((g) => g.name),
  );

  // groups first (two passes: create all, then wire parents — a parent may come
  // later in the file than its child)
  const groupIds = new Map<number, number>();
  for (const g of resolved.groups) groupIds.set(g.localId, q.createGroup(g.name));
  for (const g of resolved.groups) {
    const id = groupIds.get(g.localId);
    const parent = g.parent != null ? groupIds.get(g.parent) : undefined;
    if (id != null && parent != null) q.setGroupParent(id, parent);
  }

  const report: ImportedBlockReport[] = [];
  for (const b of resolved.blocks) {
    const doc = b.doc as SolveInput;
    const missing = q.blockMissingRefs(doc);
    const primary = primaryGoal(doc)?.name ?? "";
    const icon =
      b.icon ?? (primary ? { kind: q.getFluid(primary) ? "fluid" : "item", name: primary } : null);
    const meta = {
      name: b.name,
      iconKind: icon?.kind ?? null,
      iconName: icon?.name ?? null,
    };
    let id: number;
    try {
      // solve so the factory-level caches (flows/machines/power) are fresh; a
      // broken solve persists the doc with no cache (persistBlock's degrade path)
      const r = await computeBlock(doc);
      id = await persistBlock(meta, doc, r);
    } catch {
      // solver blew up on foreign data — still import the doc, just unsolved
      id = q.saveBlockRow(
        {
          ...meta,
          data: doc,
          electricityW: null,
          dataFingerprint: q.blockReferenceFingerprint(doc),
        },
        null,
        null,
      );
    }
    if (b.group != null) {
      const gid = groupIds.get(b.group);
      if (gid != null) q.setBlockGroup(id, gid);
    }
    if (!b.enabled) q.setBlockEnabled(id, false);
    report.push({
      id,
      name: b.name,
      missing,
      broken: missing.recipes.length > 0 || missing.goods.length > 0,
    });
  }
  return { kind: env.kind, blocks: report, groupsCreated: resolved.groups.length };
}
