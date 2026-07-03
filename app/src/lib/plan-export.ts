/**
 * Shareable block/plan JSON (#82) — the pure envelope logic: types, validation,
 * and the import name-resolution (collision suffixing, group remapping). No db,
 * no node APIs, so it runs on both sides and is unit-testable.
 *
 * The envelope is versioned from day one (`pyops: 1`) so future PyOps versions
 * can still read old exports; snapshots (#85) reuse the same serialization.
 * Internal names are the stable keys — an import into a project whose data dump
 * lacks a referenced recipe/good is still created, just flagged broken (the same
 * degrade path as mod drift).
 */
import type { BlockData } from "../db/schema.ts";
import { normalizeBlockData, type RawBlockData } from "./goals";

/** Bump when the envelope shape changes incompatibly; keep reading old ones. */
export const PYOPS_EXPORT_VERSION = 1;

/** One block, self-contained: its face + its full editor doc (goals, recipes,
 * per-recipe picks, groups, dispositions, spoil plans). `group` is a plan-local
 * group id referencing `PlanEnvelope.groups[].id` (absent = ungrouped). */
export type ExportedBlock = {
  name: string;
  icon: { kind: string; name: string } | null;
  enabled: boolean;
  doc: BlockData;
  group?: number;
};

/** A sidebar folder. `id` is local to the envelope; `parent` references another
 * exported group's id (nesting). */
export type ExportedGroup = { id: number; name: string; parent?: number };

export type BlockEnvelope = {
  pyops: number;
  kind: "block";
  exportedAt: string;
  block: ExportedBlock;
};

export type PlanEnvelope = {
  pyops: number;
  kind: "plan";
  exportedAt: string;
  /** what this plan was exported from (project or folder name) — label only */
  name: string;
  blocks: ExportedBlock[];
  groups: ExportedGroup[];
};

export type ExportEnvelope = BlockEnvelope | PlanEnvelope;

export type ParseResult = { ok: true; envelope: ExportEnvelope } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Sanitize an untrusted block doc: migrate legacy shapes, keep only well-formed
 * goals/recipes. Per-recipe picks (machines/fuels/modules/…) ride along as-is —
 * a pick for a recipe that doesn't exist is inert, same as after mod drift. */
function sanitizeDoc(raw: unknown): BlockData | null {
  if (!isRecord(raw)) return null;
  const norm = normalizeBlockData(raw as RawBlockData);
  const goals = (Array.isArray(norm.goals) ? norm.goals : []).filter(
    (g) =>
      isRecord(g) &&
      typeof g.name === "string" &&
      g.name.length > 0 &&
      typeof g.rate === "number" &&
      Number.isFinite(g.rate),
  );
  const recipes = (Array.isArray(norm.recipes) ? norm.recipes : []).filter(
    (r): r is string => typeof r === "string" && r.length > 0,
  );
  return { ...norm, goals, recipes };
}

function sanitizeBlock(raw: unknown): ExportedBlock | null {
  if (!isRecord(raw)) return null;
  const doc = sanitizeDoc(raw.doc);
  if (!doc) return null;
  const icon = raw.icon;
  return {
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Imported block",
    icon:
      isRecord(icon) && typeof icon.kind === "string" && typeof icon.name === "string"
        ? { kind: icon.kind, name: icon.name }
        : null,
    enabled: raw.enabled !== false,
    doc,
    ...(typeof raw.group === "number" ? { group: raw.group } : {}),
  };
}

/** Validate + sanitize an untrusted export envelope (a parsed JSON value, or the
 * raw JSON text). Never throws — returns a user-showable error instead. */
export function parseExportEnvelope(input: unknown): ParseResult {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { ok: false, error: "not valid JSON" };
    }
  }
  if (!isRecord(value) || typeof value.pyops !== "number") {
    return { ok: false, error: "not a PyOps export file (missing the pyops version field)" };
  }
  if (value.pyops > PYOPS_EXPORT_VERSION) {
    return {
      ok: false,
      error: `this file was exported by a newer PyOps (export version ${value.pyops}; this app reads up to ${PYOPS_EXPORT_VERSION}) — update the app to import it`,
    };
  }
  if (value.pyops < 1) return { ok: false, error: "invalid export version" };
  const exportedAt = typeof value.exportedAt === "string" ? value.exportedAt : "";

  if (value.kind === "block") {
    const block = sanitizeBlock(value.block);
    if (!block) return { ok: false, error: "the export contains no readable block" };
    // a lone block can't reference a plan group
    delete block.group;
    return { ok: true, envelope: { pyops: 1, kind: "block", exportedAt, block } };
  }

  if (value.kind === "plan") {
    const rawBlocks = Array.isArray(value.blocks) ? value.blocks : [];
    const blocks = rawBlocks.map(sanitizeBlock).filter((b): b is ExportedBlock => b !== null);
    if (blocks.length === 0) return { ok: false, error: "the plan contains no readable blocks" };
    const groups: ExportedGroup[] = (Array.isArray(value.groups) ? value.groups : [])
      .filter(
        (g): g is Record<string, unknown> =>
          isRecord(g) && typeof g.id === "number" && typeof g.name === "string",
      )
      .map((g) => ({
        id: g.id as number,
        name: g.name as string,
        ...(typeof g.parent === "number" ? { parent: g.parent } : {}),
      }));
    // drop dangling references: a parent to a group not in the file, a block's
    // group that isn't in the file
    const ids = new Set(groups.map((g) => g.id));
    for (const g of groups)
      if (g.parent != null && (!ids.has(g.parent) || g.parent === g.id)) delete g.parent;
    for (const b of blocks) if (b.group != null && !ids.has(b.group)) delete b.group;
    const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : "plan";
    return { ok: true, envelope: { pyops: 1, kind: "plan", exportedAt, name, blocks, groups } };
  }

  return { ok: false, error: `unknown export kind ${JSON.stringify(value.kind)}` };
}

/** Pick a name not in `taken` by suffixing " (2)", " (3)", … — and claim it, so
 * successive calls against the same set stay unique within one import. */
export function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base} (${i})`;
  taken.add(name);
  return name;
}

export type ResolvedImport = {
  /** groups to create, in file order; `parent` still references plan-local ids */
  groups: { localId: number; name: string; parent?: number }[];
  /** blocks to create, names already de-collided; `group` is the plan-local id */
  blocks: ExportedBlock[];
};

/** Resolve an envelope against the target project's existing names: every
 * imported block/group gets a fresh (suffixed) name on collision. Pure — the
 * caller does the db writes. */
export function resolveImport(
  envelope: ExportEnvelope,
  existingBlockNames: Iterable<string>,
  existingGroupNames: Iterable<string>,
): ResolvedImport {
  const takenBlocks = new Set(existingBlockNames);
  const takenGroups = new Set(existingGroupNames);
  const blocks = envelope.kind === "block" ? [envelope.block] : envelope.blocks;
  const groups = envelope.kind === "block" ? [] : envelope.groups;
  return {
    groups: groups.map((g) => ({
      localId: g.id,
      name: uniqueName(g.name, takenGroups),
      ...(g.parent != null ? { parent: g.parent } : {}),
    })),
    blocks: blocks.map((b) => ({ ...b, name: uniqueName(b.name, takenBlocks) })),
  };
}

/** Suggested download filename for an envelope: `<slug>.pyops.json`. */
export function exportFileName(envelope: ExportEnvelope): string {
  const base = envelope.kind === "block" ? envelope.block.name : envelope.name;
  const slug =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || envelope.kind;
  return `${slug}.pyops.json`;
}
