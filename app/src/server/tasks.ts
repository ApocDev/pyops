/**
 * Server functions for tasks & notes. Thin wrappers over the db/tasks query
 * layer, scoped to the active project. Server-only modules are referenced only
 * inside `.handler()` bodies, so they never reach the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";

import type { RefKind } from "../db/tasks.server.ts";

// Server-only modules, top-level: referenced only inside `.handler()` bodies,
// so the Start compiler prunes them from the client bundle with the handlers.
import { generateText } from "ai";
import * as store from "../db/tasks.server.ts";
import { resolveApiKey } from "./app-config.server.ts";
import { getModel, reasoningProviderOptions } from "./agent.ts";

/* ── tasks ──────────────────────────────────────────────────────────────────── */

export const listTasksFn = createServerFn({ method: "GET" }).handler(async () => store.listTasks());

export const getTaskFn = createServerFn({ method: "GET" })
  .validator((id: number) => id)
  .handler(async ({ data }) => store.getTask(data));

export const createTaskFn = createServerFn({ method: "POST" })
  .validator((d: { parentId?: number | null; title?: string }) => d)
  .handler(async ({ data }) => ({ id: store.createTask(data) }));

export const updateTaskFn = createServerFn({ method: "POST" })
  .validator(
    (d: {
      id: number;
      title?: string | null;
      body?: string | null;
      status?: string;
      done?: boolean;
      parentId?: number | null;
    }) => d,
  )
  .handler(async ({ data }) => {
    const { id, ...patch } = data;
    store.updateTask(id, patch);
    return { ok: true };
  });

export const deleteTaskFn = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .handler(async ({ data }) => {
    store.deleteTask(data);
    return { ok: true };
  });

/** Ask the LLM to (re)assign advisory priorities to all open/in-progress tasks.
 * Recomputable — a re-run can demote tasks whose context changed. No-op without
 * an OpenRouter key. */
export const prioritizeTasksFn = createServerFn({ method: "POST" }).handler(async () => {
  const input = store.prioritizationInput();
  if (!input.length) return { ok: true as const, count: 0 };

  if (!resolveApiKey().key) {
    return { ok: false as const, error: "No OpenRouter API key configured (set one in Settings)." };
  }
  try {
    // generateText + JSON parse (not generateObject) — structured-output mode is
    // flaky across OpenRouter models (some hang/retry); plain text + a strict JSON
    // instruction works with any chat model, like the title-generation path.
    const lines = input.map((i) => {
      const parent = i.parentTitle ? ` [under "${i.parentTitle}"]` : "";
      const links = i.links.length ? ` [refs: ${i.links.join(", ")}]` : "";
      const body = i.body ? ` — ${i.body.replace(/\s+/g, " ").slice(0, 240)}` : "";
      return `#${i.id} (${i.status})${parent}: ${i.title ?? "Untitled"}${body}${links}`;
    });
    const { text } = await generateText({
      model: getModel(),
      providerOptions: reasoningProviderOptions(null, "low", { exclude: true }),
      maxOutputTokens: 2048,
      prompt:
        "You are triaging a Factorio (Pyanodons) factory-planning task list. For EACH task below, assign " +
        "an advisory priority (one of: low, medium, high, critical) and a short one-line reason. Weigh " +
        "blocking vs unblocking (a task that unblocks others ranks higher; a child of a not-yet-relevant " +
        "parent ranks lower), urgency, and impact on the factory.\n\n" +
        "Reply with ONLY a JSON object — no prose, no markdown fences — of exactly this shape, including " +
        'every task id:\n{"rankings":[{"id":<number>,"priority":"low|medium|high|critical","reason":"<short reason>"}]}\n\n' +
        "Tasks:\n" +
        lines.join("\n"),
    });
    const parsed = JSON.parse(extractJsonObject(text)) as {
      rankings?: { id: number; priority: string; reason?: string }[];
    };
    const valid = new Set(input.map((i) => i.id));
    const rankings = (parsed.rankings ?? []).filter((r) => valid.has(r.id));
    if (!rankings.length) return { ok: false as const, error: "model returned no rankings" };
    store.setPriorities(
      rankings.map((r) => ({ id: r.id, priority: r.priority, reason: r.reason ?? null })),
    );
    return { ok: true as const, count: rankings.length };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "prioritization failed" };
  }
});

/** Sharpen one task's rough title/body into something clearer using the LLM,
 * preserving the user's original wording and any captured context. For the
 * quick-capture → "enhance" flow. No-op without an OpenRouter key. */
export const enrichTaskFn = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .handler(async ({ data }) => {
    const task = store.getTask(data);
    if (!task) return { ok: false as const, error: "no such task" };

    if (!resolveApiKey().key) {
      return {
        ok: false as const,
        error: "No OpenRouter API key configured (set one in Settings).",
      };
    }
    try {
      const links = task.links.map((l) => `${l.kind}:${l.display}`).join(", ");
      const { text } = await generateText({
        model: getModel(),
        providerOptions: reasoningProviderOptions(null, "low", { exclude: true }),
        maxOutputTokens: 2048,
        prompt:
          "You are sharpening a rough Factorio (Pyanodons) planning task into something clear and " +
          "actionable. PRESERVE the user's original intent and wording — improve, don't replace or invent " +
          "facts. Keep any in-game context. Produce a crisp imperative title (<= 80 chars) and a short " +
          "markdown body explaining what to do / what to check.\n\n" +
          "Reply with ONLY a JSON object — no prose, no fences — exactly:\n" +
          '{"title":"<title>","body":"<markdown body>"}\n\n' +
          `Current title: ${task.title ?? "(none)"}\n` +
          `Current body: ${task.body ?? "(none)"}\n` +
          (links ? `Linked: ${links}\n` : ""),
      });
      const parsed = JSON.parse(extractJsonObject(text)) as { title?: string; body?: string };
      const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
      const body = typeof parsed.body === "string" ? parsed.body : "";
      if (!title && !body) return { ok: false as const, error: "model returned nothing usable" };
      store.updateTask(data, { title: title || task.title, body: body || task.body });
      return { ok: true as const, title: title || task.title };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "enrichment failed" };
    }
  });

/** Pull the first `{ … }` JSON object out of a model reply, tolerating code
 * fences or stray prose around it. */
function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body.trim();
}

/* ── steps ──────────────────────────────────────────────────────────────────── */

export const addStepFn = createServerFn({ method: "POST" })
  .validator((d: { taskId: number; text: string }) => d)
  .handler(async ({ data }) => ({ id: store.addStep(data.taskId, data.text) }));

export const updateStepFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; text?: string; done?: boolean }) => d)
  .handler(async ({ data }) => {
    const { id, ...patch } = data;
    store.updateStep(id, patch);
    return { ok: true };
  });

export const deleteStepFn = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .handler(async ({ data }) => {
    store.deleteStep(data);
    return { ok: true };
  });

/* ── entity links ─────────────────────────────────────────────────────────────── */

export const searchLinkTargetsFn = createServerFn({ method: "GET" })
  .validator((query: string) => query)
  .handler(async ({ data }) => store.searchLinkTargets(data));

export const addLinkFn = createServerFn({ method: "POST" })
  .validator((d: { taskId: number; kind: RefKind; refName: string }) => d)
  .handler(async ({ data }) => ({
    id: store.addLink(data.taskId, data.kind, data.refName),
  }));

export const removeLinkFn = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .handler(async ({ data }) => {
    store.removeLink(data);
    return { ok: true };
  });

/** Reverse lookup: tasks that link to a given block (block-page view). */
export const tasksForBlockFn = createServerFn({ method: "GET" })
  .validator((blockId: number) => blockId)
  .handler(async ({ data }) => store.tasksForBlock(data));

/* ── notes ──────────────────────────────────────────────────────────────────── */

export const listNotesFn = createServerFn({ method: "GET" }).handler(async () => store.listNotes());

export const createNoteFn = createServerFn({ method: "POST" })
  .validator((d: { title?: string; body?: string }) => d)
  .handler(async ({ data }) => ({ id: store.createNote(data) }));

export const updateNoteFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; title?: string | null; body?: string | null }) => d)
  .handler(async ({ data }) => {
    const { id, ...patch } = data;
    store.updateNote(id, patch);
    return { ok: true };
  });

export const deleteNoteFn = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .handler(async ({ data }) => {
    store.deleteNote(data);
    return { ok: true };
  });
