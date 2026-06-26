/**
 * Task bridge handlers.
 *
 * `task.capture` — the in-game New-task dialog (or the old quick field) files a
 * task: a title/description plus best-effort anchors (surface/position + the entity
 * the player was looking at). We create it immediately, attach the context as
 * entity/location anchors, and reply `task.captured`.
 *
 * `task.list` — the panel pulls the project's tasks to render (list + detail).
 */
import type { TaskLink } from "../../../db/tasks.ts";
import type { BridgeRequest, BridgeResponse } from "../protocol.ts";

const lib = () => import("../../../db/tasks.ts");

export async function handleTaskCapture(req: BridgeRequest): Promise<BridgeResponse | null> {
  const p = (req.payload ?? {}) as {
    text?: unknown;
    title?: unknown;
    body?: unknown;
    anchor?: unknown;
    surface?: unknown;
    x?: unknown;
    y?: unknown;
    entity?: unknown;
  };
  const text = typeof p.text === "string" ? p.text.trim() : "";
  const title = typeof p.title === "string" ? p.title.trim() : "";
  if (!text && !title) {
    return {
      type: "task.captured",
      request_id: req.request_id,
      payload: { ok: false, error: "a task needs a title" },
    };
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const t = await lib();
  const { id, title: created } = t.captureTask({
    text: text || title,
    title: title || null,
    body: typeof p.body === "string" ? p.body : null,
    anchor: p.anchor !== false,
    player: req.player ?? null,
    surface: typeof p.surface === "string" ? p.surface : null,
    x: num(p.x),
    y: num(p.y),
    entity: typeof p.entity === "string" ? p.entity : null,
  });
  return {
    type: "task.captured",
    request_id: req.request_id,
    payload: { ok: true, id, title: created },
  };
}

/** Map a task link to a compact wire shape the mod can render: a Factorio sprite
 * path (or null) plus, for location anchors, the surface/coords to travel to. */
function linkToWire(l: TaskLink) {
  if (l.kind === "location") {
    const [surface, x, y] = l.refName.split("|");
    return {
      kind: "location" as const,
      display: l.display,
      sprite: null,
      surface: surface ?? null,
      x: Number(x),
      y: Number(y),
    };
  }
  const sprite = l.iconKind && l.iconName ? `${l.iconKind}/${l.iconName}` : null;
  return { kind: l.kind, display: l.display, sprite };
}

/** `task.list` — send the project's tasks with body/steps/links so the mod can show
 * list + detail without a second round-trip. Read-only for now; status/step writes
 * come later. */
export async function handleTaskList(req: BridgeRequest): Promise<BridgeResponse | null> {
  const t = await lib();
  const tasks = t.listTasks().map((n) => {
    const d = t.getTask(n.id);
    return {
      id: n.id,
      parentId: n.parentId,
      title: n.title ?? "(untitled)",
      status: n.status,
      priority: n.priority,
      stepTotal: n.stepTotal,
      stepDone: n.stepDone,
      body: d?.body ?? "",
      steps: (d?.steps ?? []).map((s) => ({ id: s.id, text: s.text, done: s.done })),
      links: (d?.links ?? []).map(linkToWire),
    };
  });
  return { type: "task.list", request_id: req.request_id, payload: { tasks } };
}
