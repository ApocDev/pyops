/**
 * Tasks & notes, per-project. Pure queries over the active project's db.
 *
 * A task is a "thing to do": title + markdown body, a checklist of `task_steps`,
 * and optionally child tasks (self-FK `parent_id`) for bigger breakdowns. A
 * "milestone" is just a parent task; a child task is a full task shown indented
 * on its parent. Notes are a separate flat scratch surface.
 *
 * `ensureSchema()` creates/upgrades these tables idempotently on first use, so every
 * project db has them. schema.ts stays the canonical definition.
 */
import { asc, eq, inArray, sql } from "drizzle-orm";

import { db, currentDatabaseFile } from "./index.server.ts";
import { searchAll, searchTechs } from "./queries.server.ts";
import {
  blocks,
  fluids,
  items,
  notes,
  recipes,
  taskLinks,
  taskSteps,
  tasks,
  technologies,
} from "./schema.ts";

export type TaskStep = { id: number; text: string; done: boolean; sortOrder: number | null };

/** Task workflow state. `closed` = won't-do / don't-care (drops out of rollups). */
export type TaskStatus = "open" | "in_progress" | "done" | "closed";
const STATUSES = new Set<TaskStatus>(["open", "in_progress", "done", "closed"]);
export function normalizeStatus(value: string | null | undefined): TaskStatus {
  return value && STATUSES.has(value as TaskStatus) ? (value as TaskStatus) : "open";
}

/** Advisory, LLM-assigned priority (recomputable, not user-owned truth). */
export type TaskPriority = "low" | "medium" | "high" | "critical";
const PRIORITIES = new Set<TaskPriority>(["low", "medium", "high", "critical"]);
function normalizePriority(value: string | null | undefined): TaskPriority | null {
  return value && PRIORITIES.has(value as TaskPriority) ? (value as TaskPriority) : null;
}

/** The domain-object kinds a task can link to. Data-model refs (item/fluid/
 * recipe/technology) resolve a display from the dump; `block` points at a saved
 * block; `entity`/`location` are in-game anchors captured from the mod. */
export type RefKind = "item" | "fluid" | "recipe" | "technology" | "block" | "entity" | "location";

/** A resolved entity reference, ready to render as an icon+display chip. For
 * item/fluid/recipe/technology, iconKind/iconName feed <Icon> directly; for a
 * block, they carry the block's own icon and `blockId` enables click-through. */
export type EntityRef = {
  kind: RefKind;
  refName: string; // internal name, or block id as text
  display: string;
  iconKind: string | null;
  iconName: string | null;
  blockId: number | null;
};

export type TaskLink = EntityRef & { id: number };

/** A task in the tree, with progress rollups (its own steps + its direct
 * children). Bodyless — the list/tree only needs enough to render + roll up. */
export type TaskNode = {
  id: number;
  parentId: number | null;
  title: string | null;
  status: TaskStatus;
  done: boolean; // derived: status === 'done' (kept for the UI's quick toggle)
  priority: TaskPriority | null;
  priorityReason: string | null;
  sortOrder: number | null;
  stepTotal: number;
  stepDone: number;
  childTotal: number;
  childDone: number;
};

export type TaskDetail = TaskNode & {
  body: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  steps: TaskStep[];
  children: TaskNode[];
  links: TaskLink[];
};

export type NoteRecord = {
  id: number;
  title: string | null;
  body: string | null;
  sortOrder: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

const ensured = new Set<string>();
function ensureSchema() {
  const file = currentDatabaseFile();
  if (ensured.has(file)) return;
  db.run(
    sql`CREATE TABLE IF NOT EXISTS tasks (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      parent_id integer,
      title text, body text,
      status text NOT NULL DEFAULT 'open',
      done integer NOT NULL DEFAULT 0,
      sort_order integer,
      created_at integer DEFAULT (unixepoch()),
      updated_at integer DEFAULT (unixepoch())
    )`,
  );
  // upgrade an older skeleton `tasks` table (had `kind`, no `parent_id`)
  try {
    db.run(sql`ALTER TABLE tasks ADD COLUMN parent_id integer`);
  } catch {
    /* already present */
  }
  // workflow status (added after the done bool); backfill from done on first add
  try {
    db.run(sql`ALTER TABLE tasks ADD COLUMN status text NOT NULL DEFAULT 'open'`);
    db.run(sql`UPDATE tasks SET status = 'done' WHERE done = 1`);
  } catch {
    /* already present */
  }
  for (const col of [
    sql`ALTER TABLE tasks ADD COLUMN priority text`,
    sql`ALTER TABLE tasks ADD COLUMN priority_reason text`,
    sql`ALTER TABLE tasks ADD COLUMN priority_at integer`,
  ]) {
    try {
      db.run(col);
    } catch {
      /* already present */
    }
  }
  db.run(
    sql`CREATE TABLE IF NOT EXISTS task_steps (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      task_id integer NOT NULL,
      text text NOT NULL,
      done integer NOT NULL DEFAULT 0,
      sort_order integer
    )`,
  );
  db.run(sql`CREATE TABLE IF NOT EXISTS notes (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      title text, body text, sort_order integer,
      created_at integer DEFAULT (unixepoch()),
      updated_at integer DEFAULT (unixepoch())
    )`);
  db.run(sql`CREATE TABLE IF NOT EXISTS task_links (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      task_id integer NOT NULL,
      ref_kind text NOT NULL,
      ref_name text NOT NULL,
      sort_order integer
    )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS task_parent_idx ON tasks (parent_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS task_steps_task_idx ON task_steps (task_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS task_links_task_idx ON task_links (task_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS task_links_ref_idx ON task_links (ref_kind, ref_name)`);
  ensured.add(file);
}

type RefDisplays = Record<"item" | "fluid" | "recipe" | "technology", Map<string, string>> & {
  blocks: Map<number, { name: string; iconKind: string | null; iconName: string | null }>;
};

/** Resolve a stored (kind, refName) reference from batch-loaded lookup maps.
 * Falls back to the raw name if the referenced entity no longer exists. */
function resolveRef(kind: RefKind, refName: string, displays: RefDisplays): EntityRef {
  const base: EntityRef = {
    kind,
    refName,
    display: refName,
    iconKind: kind,
    iconName: refName,
    blockId: null,
  };
  if (kind === "block") {
    const blockId = Number(refName);
    const b = displays.blocks.get(blockId);
    return {
      kind,
      refName,
      display: b?.name ?? `block #${refName}`,
      iconKind: b?.iconKind ?? null,
      iconName: b?.iconName ?? null,
      blockId,
    };
  }
  // In-game anchors (captured from the mod) — no dump lookup.
  if (kind === "entity") {
    return { ...base, iconKind: "entity", iconName: refName, display: humanize(refName) };
  }
  if (kind === "location") {
    // refName encodes "surface|x|y"
    const [surface, x, y] = refName.split("|");
    const display =
      surface && x != null && y != null
        ? `${surface} (${Math.round(Number(x))}, ${Math.round(Number(y))})`
        : refName;
    return { kind, refName, display, iconKind: "location", iconName: null, blockId: null };
  }
  return { ...base, display: displays[kind].get(refName) ?? refName };
}

/** Fallback display for an internal name with no dump entry (e.g. an entity
 * prototype): "assembling-machine-1" → "Assembling machine 1". */
function humanize(name: string): string {
  const s = name.replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : name;
}

/** Entity links for a set of tasks, loaded and resolved with a constant number
 * of queries per reference kind instead of one task/ref at a time. */
function linksByTask(taskIds: readonly number[]): Map<number, TaskLink[]> {
  const byTask = new Map<number, TaskLink[]>();
  if (!taskIds.length) return byTask;

  const links = db
    .select()
    .from(taskLinks)
    .where(inArray(taskLinks.taskId, [...new Set(taskIds)]))
    .orderBy(asc(taskLinks.taskId), asc(taskLinks.sortOrder), asc(taskLinks.id))
    .all();
  const names = {
    item: new Set<string>(),
    fluid: new Set<string>(),
    recipe: new Set<string>(),
    technology: new Set<string>(),
    blocks: new Set<number>(),
  };
  for (const link of links) {
    const kind = link.refKind as RefKind;
    if (kind === "block") {
      const id = Number(link.refName);
      if (Number.isFinite(id)) names.blocks.add(id);
    } else if (kind !== "entity" && kind !== "location") {
      names[kind].add(link.refName);
    }
  }

  const displays: RefDisplays = {
    item: new Map(),
    fluid: new Map(),
    recipe: new Map(),
    technology: new Map(),
    blocks: new Map(),
  };
  if (names.item.size) {
    for (const row of db
      .select({ name: items.name, display: items.display })
      .from(items)
      .where(inArray(items.name, [...names.item]))
      .all()) {
      displays.item.set(row.name, row.display ?? row.name);
    }
  }
  if (names.fluid.size) {
    for (const row of db
      .select({ name: fluids.name, display: fluids.display })
      .from(fluids)
      .where(inArray(fluids.name, [...names.fluid]))
      .all()) {
      displays.fluid.set(row.name, row.display ?? row.name);
    }
  }
  if (names.recipe.size) {
    for (const row of db
      .select({ name: recipes.name, display: recipes.display })
      .from(recipes)
      .where(inArray(recipes.name, [...names.recipe]))
      .all()) {
      displays.recipe.set(row.name, row.display ?? row.name);
    }
  }
  if (names.technology.size) {
    for (const row of db
      .select({ name: technologies.name, display: technologies.display })
      .from(technologies)
      .where(inArray(technologies.name, [...names.technology]))
      .all()) {
      displays.technology.set(row.name, row.display ?? row.name);
    }
  }
  if (names.blocks.size) {
    for (const row of db
      .select({
        id: blocks.id,
        name: blocks.name,
        iconKind: blocks.iconKind,
        iconName: blocks.iconName,
      })
      .from(blocks)
      .where(inArray(blocks.id, [...names.blocks]))
      .all()) {
      displays.blocks.set(row.id, row);
    }
  }

  for (const link of links) {
    const resolved = {
      id: link.id,
      ...resolveRef(link.refKind as RefKind, link.refName, displays),
    };
    const list = byTask.get(link.taskId) ?? [];
    list.push(resolved);
    byTask.set(link.taskId, list);
  }
  return byTask;
}

/** A task's entity links, ordered, each resolved to a renderable chip. */
function linksFor(taskId: number): TaskLink[] {
  return linksByTask([taskId]).get(taskId) ?? [];
}

/** Build a {taskId → {total,done}} rollup of steps, and {parentId → {total,done}}
 * rollup of direct children, in two scans. */
function rollups() {
  const steps = db.select({ taskId: taskSteps.taskId, done: taskSteps.done }).from(taskSteps).all();
  const stepBy = new Map<number, { total: number; done: number }>();
  for (const s of steps) {
    const r = stepBy.get(s.taskId) ?? { total: 0, done: 0 };
    r.total++;
    if (s.done) r.done++;
    stepBy.set(s.taskId, r);
  }
  const all = db.select({ parentId: tasks.parentId, status: tasks.status }).from(tasks).all();
  const childBy = new Map<number, { total: number; done: number }>();
  for (const t of all) {
    if (t.parentId == null) continue;
    if (t.status === "closed") continue; // don't-care drops out of the count
    const r = childBy.get(t.parentId) ?? { total: 0, done: 0 };
    r.total++;
    if (t.status === "done") r.done++;
    childBy.set(t.parentId, r);
  }
  return { stepBy, childBy };
}

function toNode(
  r: {
    id: number;
    parentId: number | null;
    title: string | null;
    status: string;
    priority: string | null;
    priorityReason: string | null;
    sortOrder: number | null;
  },
  stepBy: Map<number, { total: number; done: number }>,
  childBy: Map<number, { total: number; done: number }>,
): TaskNode {
  const s = stepBy.get(r.id);
  const c = childBy.get(r.id);
  const status = normalizeStatus(r.status);
  return {
    id: r.id,
    parentId: r.parentId,
    title: r.title,
    status,
    done: status === "done",
    priority: normalizePriority(r.priority),
    priorityReason: r.priorityReason,
    sortOrder: r.sortOrder,
    stepTotal: s?.total ?? 0,
    stepDone: s?.done ?? 0,
    childTotal: c?.total ?? 0,
    childDone: c?.done ?? 0,
  };
}

/** All tasks (flat) with rollups — the client assembles the tree from parentId. */
export function listTasks(): TaskNode[] {
  ensureSchema();
  const { stepBy, childBy } = rollups();
  return db
    .select({
      id: tasks.id,
      parentId: tasks.parentId,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      priorityReason: tasks.priorityReason,
      sortOrder: tasks.sortOrder,
    })
    .from(tasks)
    .orderBy(asc(tasks.sortOrder), asc(tasks.id))
    .all()
    .map((r) => toNode(r, stepBy, childBy));
}

/** One task with its body, steps, and direct children (with their rollups). */
export function getTask(id: number): TaskDetail | null {
  ensureSchema();
  const r = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!r) return null;
  const { stepBy, childBy } = rollups();
  const steps = db
    .select()
    .from(taskSteps)
    .where(eq(taskSteps.taskId, id))
    .orderBy(asc(taskSteps.sortOrder), asc(taskSteps.id))
    .all()
    .map((s) => ({ id: s.id, text: s.text, done: s.done, sortOrder: s.sortOrder }));
  const children = db
    .select({
      id: tasks.id,
      parentId: tasks.parentId,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      priorityReason: tasks.priorityReason,
      sortOrder: tasks.sortOrder,
    })
    .from(tasks)
    .where(eq(tasks.parentId, id))
    .orderBy(asc(tasks.sortOrder), asc(tasks.id))
    .all()
    .map((c) => toNode(c, stepBy, childBy));
  return {
    ...toNode(r, stepBy, childBy),
    body: r.body,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    steps,
    children,
    links: linksFor(id),
  };
}

/** Create a task (top-level, or a child of `parentId`). New tasks sort last among
 * their siblings. Returns the new id. */
export function createTask(input: {
  parentId?: number | null;
  title?: string;
  body?: string;
}): number {
  ensureSchema();
  const now = new Date();
  const max = db
    .select({ n: sql<number>`coalesce(max(${tasks.sortOrder}), -1)` })
    .from(tasks)
    .where(
      input.parentId == null ? sql`${tasks.parentId} is null` : eq(tasks.parentId, input.parentId),
    )
    .get();
  const row = db
    .insert(tasks)
    .values({
      parentId: input.parentId ?? null,
      title: input.title?.trim() || null,
      body: input.body ?? null,
      sortOrder: (max?.n ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: tasks.id })
    .get();
  return row.id;
}

/** True if `candidateParent` is `id` or one of its descendants (a move that would
 * create a cycle). */
function wouldCycle(id: number, candidateParent: number): boolean {
  const rows = db.select({ id: tasks.id, parentId: tasks.parentId }).from(tasks).all();
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId] as const));
  let cur: number | null | undefined = candidateParent;
  while (cur != null) {
    if (cur === id) return true;
    cur = parentOf.get(cur) ?? null;
  }
  return false;
}

export function updateTask(
  id: number,
  patch: {
    title?: string | null;
    body?: string | null;
    status?: string;
    done?: boolean;
    parentId?: number | null;
  },
) {
  ensureSchema();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title?.trim() || null;
  if (patch.body !== undefined) set.body = patch.body ?? null;
  // status is the source of truth; keep the legacy `done` bool in lockstep. A
  // bare `done` toggle (the quick checkbox) maps to done<->open.
  if (patch.status !== undefined) {
    const s = normalizeStatus(patch.status);
    set.status = s;
    set.done = s === "done";
  } else if (patch.done !== undefined) {
    set.done = patch.done;
    set.status = patch.done ? "done" : "open";
  }
  if (patch.parentId !== undefined) {
    if (patch.parentId != null && (patch.parentId === id || wouldCycle(id, patch.parentId))) return;
    set.parentId = patch.parentId;
  }
  db.update(tasks).set(set).where(eq(tasks.id, id)).run();
}

/** Delete a task and its whole subtree (descendant tasks + everyone's steps). */
export function deleteTask(id: number) {
  ensureSchema();
  db.transaction((tx) => {
    // Repeat the recursive CTE for each statement while the task rows still
    // exist. SQLite's row triggers still log every deleted row for undo.
    tx.run(sql`
      WITH RECURSIVE subtree(id) AS (
        SELECT id FROM tasks WHERE id = ${id}
        UNION
        SELECT child.id FROM tasks child JOIN subtree parent ON child.parent_id = parent.id
      )
      DELETE FROM task_steps WHERE task_id IN (SELECT id FROM subtree)
    `);
    tx.run(sql`
      WITH RECURSIVE subtree(id) AS (
        SELECT id FROM tasks WHERE id = ${id}
        UNION
        SELECT child.id FROM tasks child JOIN subtree parent ON child.parent_id = parent.id
      )
      DELETE FROM task_links WHERE task_id IN (SELECT id FROM subtree)
    `);
    tx.run(sql`
      WITH RECURSIVE subtree(id) AS (
        SELECT id FROM tasks WHERE id = ${id}
        UNION
        SELECT child.id FROM tasks child JOIN subtree parent ON child.parent_id = parent.id
      )
      DELETE FROM tasks WHERE id IN (SELECT id FROM subtree)
    `);
  });
}

/* ── entity links ─────────────────────────────────────────────────────────────── */

/** Attach an entity reference to a task (no-op if already linked). Returns the
 * link id (existing or new). */
export function addLink(taskId: number, kind: RefKind, refName: string): number {
  ensureSchema();
  const existing = db
    .select({ id: taskLinks.id })
    .from(taskLinks)
    .where(
      sql`${taskLinks.taskId} = ${taskId} AND ${taskLinks.refKind} = ${kind} AND ${taskLinks.refName} = ${refName}`,
    )
    .get();
  if (existing) return existing.id;
  const max = db
    .select({ n: sql<number>`coalesce(max(${taskLinks.sortOrder}), -1)` })
    .from(taskLinks)
    .where(eq(taskLinks.taskId, taskId))
    .get();
  const row = db
    .insert(taskLinks)
    .values({ taskId, refKind: kind, refName, sortOrder: (max?.n ?? -1) + 1 })
    .returning({ id: taskLinks.id })
    .get();
  db.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, taskId)).run();
  return row.id;
}

export function removeLink(id: number) {
  ensureSchema();
  db.delete(taskLinks).where(eq(taskLinks.id, id)).run();
}

/** Search domain objects to link: items + fluids + recipes + techs + the user's
 * own blocks, as renderable chip candidates. */
export function searchLinkTargets(query: string, limit = 15): EntityRef[] {
  ensureSchema();
  const q = query.trim();
  if (!q) return [];
  const out: EntityRef[] = [];

  // user's own blocks first (most specific to their plan)
  const lpat = `%${q.toLowerCase()}%`;
  for (const b of db
    .select({
      id: blocks.id,
      name: blocks.name,
      iconKind: blocks.iconKind,
      iconName: blocks.iconName,
    })
    .from(blocks)
    .where(sql`lower(${blocks.name}) LIKE ${lpat}`)
    .limit(5)
    .all()) {
    out.push({
      kind: "block",
      refName: String(b.id),
      display: b.name,
      iconKind: b.iconKind,
      iconName: b.iconName,
      blockId: b.id,
    });
  }

  for (const g of searchAll(q, 8)) {
    const kind = g.kind === "fluid" ? "fluid" : "item";
    out.push({
      kind,
      refName: g.name,
      display: g.display ?? g.name,
      iconKind: kind,
      iconName: g.name,
      blockId: null,
    });
  }

  const pat = `%${q}%`;
  for (const r of db
    .select({ name: recipes.name, display: recipes.display })
    .from(recipes)
    .where(
      sql`(${recipes.name} LIKE ${pat} OR ${recipes.display} LIKE ${pat}) AND ${recipes.hidden} = 0`,
    )
    .limit(5)
    .all()) {
    out.push({
      kind: "recipe",
      refName: r.name,
      display: r.display ?? r.name,
      iconKind: "recipe",
      iconName: r.name,
      blockId: null,
    });
  }

  for (const t of searchTechs(q, 4)) {
    out.push({
      kind: "technology",
      refName: t.name,
      display: t.display ?? t.name,
      iconKind: "technology",
      iconName: t.name,
      blockId: null,
    });
  }

  return out.slice(0, limit);
}

/** The reverse of a block link: tasks that reference this block (for the "tasks
 * on the block page" view). Includes each task's own step+subtask rollup. */
export function tasksForBlock(blockId: number): TaskNode[] {
  ensureSchema();
  const ids = db
    .select({ taskId: taskLinks.taskId })
    .from(taskLinks)
    .where(sql`${taskLinks.refKind} = 'block' AND ${taskLinks.refName} = ${String(blockId)}`)
    .all()
    .map((r) => r.taskId);
  if (!ids.length) return [];
  const idSet = new Set(ids);
  const { stepBy, childBy } = rollups();
  return db
    .select({
      id: tasks.id,
      parentId: tasks.parentId,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      priorityReason: tasks.priorityReason,
      sortOrder: tasks.sortOrder,
    })
    .from(tasks)
    .orderBy(asc(tasks.title))
    .all()
    .filter((r) => idSet.has(r.id))
    .map((r) => toNode(r, stepBy, childBy));
}

/* ── in-game capture ────────────────────────────────────────────────────────── */

export type CaptureInput = {
  text: string;
  title?: string | null; // explicit title (the New-task dialog); else derived from text
  body?: string | null; // explicit description (the New-task dialog)
  anchor?: boolean; // default true; when false, don't attach location/entity links
  player?: string | null;
  surface?: string | null;
  x?: number | null;
  y?: number | null;
  entity?: string | null; // selected entity prototype name
};

/** Create a task from an in-game capture (the quick field or the New-task dialog),
 * attaching the captured context as entity/location anchors and a snapshot line in
 * the body. Created immediately; enrichment (sharpening) is a separate, optional step. */
export function captureTask(input: CaptureInput): { id: number; title: string } {
  ensureSchema();
  const text = input.text.trim();
  const explicitTitle = input.title?.trim();
  const title =
    explicitTitle || (text.length > 80 ? `${text.slice(0, 79)}…` : text) || "Captured task";
  const anchored = input.anchor !== false;
  const hasLoc = anchored && input.surface && input.x != null && input.y != null;
  const hasEntity = anchored && !!input.entity;
  const ctx: string[] = [];
  if (input.player) ctx.push(`by **${input.player}**`);
  if (hasLoc) ctx.push(`at ${input.surface} (${Math.round(input.x!)}, ${Math.round(input.y!)})`);
  if (hasEntity) ctx.push(`near \`${input.entity}\``);
  const userBody = input.body?.trim();
  const lead = userBody ? `${userBody}\n\n` : text.length > 80 ? `${text}\n\n` : "";
  const body = `${lead}_Captured in-game${ctx.length ? ` ${ctx.join(", ")}` : ""}._`;
  const id = createTask({ title, body });
  if (hasLoc) addLink(id, "location", `${input.surface}|${input.x}|${input.y}`);
  if (hasEntity) addLink(id, "entity", input.entity!);
  return { id, title };
}

/* ── priority (advisory, LLM-assigned) ──────────────────────────────────────── */

export type PriorityInput = {
  id: number;
  title: string | null;
  body: string | null;
  status: TaskStatus;
  parentTitle: string | null;
  links: string[];
};

/** The open/in-progress tasks plus the context the LLM ranks on (parent + link
 * display names). Done/closed tasks are excluded — they don't need prioritizing. */
export function prioritizationInput(): PriorityInput[] {
  ensureSchema();
  const titleById = new Map(
    db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .all()
      .map((r) => [r.id, r.title] as const),
  );
  const rows = db
    .select({
      id: tasks.id,
      title: tasks.title,
      body: tasks.body,
      status: tasks.status,
      parentId: tasks.parentId,
    })
    .from(tasks)
    .where(sql`${tasks.status} in ('open', 'in_progress')`)
    .all();
  const links = linksByTask(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    status: normalizeStatus(r.status),
    parentTitle: r.parentId != null ? (titleById.get(r.parentId) ?? null) : null,
    links: (links.get(r.id) ?? []).map((l) => `${l.kind}:${l.display}`),
  }));
}

/** Apply an advisory ranking. Clears priority on any task not in the set so a
 * re-run can demote tasks that fell off. */
export function setPriorities(
  updates: { id: number; priority: string | null; reason: string | null }[],
) {
  ensureSchema();
  // An LLM response should contain each id once, but retaining the last value
  // preserves the old loop's behavior for duplicate ids.
  const byId = new Map(updates.map((u) => [u.id, u] as const));
  const ranked = [...byId.values()];
  if (!ranked.length) {
    db.run(sql`UPDATE tasks SET priority = NULL, priority_reason = NULL, priority_at = NULL`);
    return;
  }
  const priorityCases = sql.join(
    ranked.map((u) => sql`WHEN ${u.id} THEN ${normalizePriority(u.priority)}`),
    sql` `,
  );
  const reasonCases = sql.join(
    ranked.map((u) => sql`WHEN ${u.id} THEN ${u.reason ?? null}`),
    sql` `,
  );
  const rankedCases = sql.join(
    ranked.map((u) => sql`WHEN ${u.id} THEN unixepoch()`),
    sql` `,
  );
  db.run(sql`
    UPDATE tasks SET
      priority = CASE id ${priorityCases} ELSE NULL END,
      priority_reason = CASE id ${reasonCases} ELSE NULL END,
      priority_at = CASE id ${rankedCases} ELSE NULL END
  `);
}

/* ── steps ──────────────────────────────────────────────────────────────────── */

export function addStep(taskId: number, text: string): number {
  ensureSchema();
  const max = db
    .select({ n: sql<number>`coalesce(max(${taskSteps.sortOrder}), -1)` })
    .from(taskSteps)
    .where(eq(taskSteps.taskId, taskId))
    .get();
  const row = db
    .insert(taskSteps)
    .values({ taskId, text: text.trim(), sortOrder: (max?.n ?? -1) + 1 })
    .returning({ id: taskSteps.id })
    .get();
  db.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, taskId)).run();
  return row.id;
}

export function updateStep(id: number, patch: { text?: string; done?: boolean }) {
  ensureSchema();
  const set: Record<string, unknown> = {};
  if (patch.text !== undefined) set.text = patch.text.trim();
  if (patch.done !== undefined) set.done = patch.done;
  if (Object.keys(set).length === 0) return;
  db.update(taskSteps).set(set).where(eq(taskSteps.id, id)).run();
}

export function deleteStep(id: number) {
  ensureSchema();
  db.delete(taskSteps).where(eq(taskSteps.id, id)).run();
}

/* ── notes ──────────────────────────────────────────────────────────────────── */

export function listNotes(): NoteRecord[] {
  ensureSchema();
  return db
    .select()
    .from(notes)
    .orderBy(asc(notes.sortOrder), sql`${notes.updatedAt} desc`)
    .all()
    .map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      sortOrder: n.sortOrder,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    }));
}

export function createNote(input: { title?: string; body?: string }): number {
  ensureSchema();
  const now = new Date();
  const row = db
    .insert(notes)
    .values({
      title: input.title?.trim() || null,
      body: input.body ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: notes.id })
    .get();
  return row.id;
}

export function updateNote(id: number, patch: { title?: string | null; body?: string | null }) {
  ensureSchema();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title?.trim() || null;
  if (patch.body !== undefined) set.body = patch.body ?? null;
  db.update(notes).set(set).where(eq(notes.id, id)).run();
}

export function deleteNote(id: number) {
  ensureSchema();
  db.delete(notes).where(eq(notes.id, id)).run();
}
