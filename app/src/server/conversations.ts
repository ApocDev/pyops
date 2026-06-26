/**
 * Server functions for persisted assistant conversations. Thin wrappers over
 * the db/conversations query layer, scoped to the active project.
 */
import { createServerFn } from "@tanstack/react-start";

import type { StoredMessage } from "../db/conversations.ts";
import {
  ensureModelsLoaded,
  modelContextWindow,
  supportedReasoningEfforts,
  supportsReasoningEffort,
} from "./openrouter-models.ts";

const store = () => import("../db/conversations.ts");
// Dynamic: conversation-compaction transitively pulls the db (better-sqlite3) +
// agent, which must not land in the client bundle that imports these server fns.
const compaction = () => import("./conversation-compaction.ts");

export const listConversationsFn = createServerFn({ method: "GET" }).handler(async () =>
  (await store()).listConversations(),
);

export const getConversationFn = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data }) => (await store()).getConversation(data));

export const saveConversationFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; messages: StoredMessage[]; title?: string }) => d)
  .handler(async ({ data }) => {
    (await store()).saveConversation(data.id, data.messages, data.title);
    return { ok: true };
  });

export const renameConversationFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; title: string }) => d)
  .handler(async ({ data }) => {
    (await store()).renameConversation(data.id, data.title);
    return { ok: true };
  });

export const deleteConversationFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    (await store()).deleteConversation(data);
    return { ok: true };
  });

export const activeAssistantRunsFn = createServerFn({ method: "GET" }).handler(async () =>
  (await import("./assistant-run-store.ts")).activeAssistantRunIds(),
);

export const conversationModelFn = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    await ensureModelsLoaded();
    const conv = (await store()).getConversation(data);
    const cfg = await import("./app-config.ts");
    const resolved = cfg.resolveModel(conv?.model);
    return {
      model: conv?.model ?? "",
      reasoningEffort: conv?.reasoningEffort ?? "",
      resolvedModel: resolved.model,
      modelFromEnv: resolved.fromEnv,
      modelFromConversation: resolved.fromConversation,
      reasoningEffortSupported: supportsReasoningEffort(resolved.model),
      reasoningEfforts: supportedReasoningEfforts(resolved.model),
      defaultModel: cfg.DEFAULT_MODEL,
    };
  });

/** Live context-fill status for the gauge: real token count from the last turn
 * when we have one (else a chars/4 estimate), against the model's real context
 * window. */
export const conversationTokenStatusFn = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    await ensureModelsLoaded();
    const conv = (await store()).getConversation(data);
    const cfg = await import("./app-config.ts");
    const resolved = cfg.resolveModel(conv?.model).model;
    const windowModel = conv?.usage.modelId || resolved;
    const contextWindow = modelContextWindow(windowModel);
    const real = conv?.usage.totalTokens ?? null;
    const usedTokens =
      real ?? (conv ? (await compaction()).estimateConversationTokens(conv.messages) : 0);
    const messageCount = conv?.messages.length ?? 0;
    return {
      usedTokens,
      contextWindow,
      ratio: contextWindow > 0 ? usedTokens / contextWindow : 0,
      estimated: real == null,
      modelId: conv?.usage.modelId ?? null,
      resolvedModel: resolved,
      messageCount,
    };
  });

/** Force-compact a conversation now (the gauge's click action). Replaces the
 * stored messages with the summarized set and clears the stale real-token count
 * so the gauge reflects the (smaller) compacted size until the next real turn.
 * Returns the new message list so the live client chat can swap to it. */
export const compactConversationFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    const s = await store();
    const conv = s.getConversation(data);
    if (!conv) return { ok: false, compacted: false, messages: [] as StoredMessage[] };
    const res = await (
      await compaction()
    ).compactMessagesForContext(conv.messages, conv.model, {
      realUsedTokens: conv.usage.totalTokens,
      lastModelId: conv.usage.modelId,
      force: true,
    });
    if (res.compacted) {
      s.saveConversation(data, res.messages, conv.title ?? undefined);
      s.recordTurnUsage(data, {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        modelId: null,
      });
    }
    return { ok: true, compacted: res.compacted, messages: res.messages };
  });

export const setConversationModelFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; model: string | null }) => d)
  .handler(async ({ data }) => {
    (await store()).setConversationModel(data.id, data.model);
    return { ok: true };
  });

export const setConversationReasoningEffortFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; reasoningEffort: string | null }) => d)
  .handler(async ({ data }) => {
    (await store()).setConversationReasoningEffort(data.id, data.reasoningEffort);
    return { ok: true };
  });

/** Plain text from a stored message's JSON parts. */
function textOf(parts: string): string {
  try {
    return (JSON.parse(parts) as { type?: string; text?: string }[])
      .filter((p) => p?.type === "text")
      .map((p) => p.text ?? "")
      .join(" ")
      .trim();
  } catch {
    return "";
  }
}

export async function generateConversationTitle(id: string) {
  const s = await store();
  const conv = s.getConversation(id);
  if (!conv) return null;
  const user = conv.messages.find((m) => m.role === "user");
  const asst = conv.messages.find((m) => m.role === "assistant");
  const transcript = [
    user && `User: ${textOf(user.parts).slice(0, 600)}`,
    asst && `Assistant: ${textOf(asst.parts).slice(0, 600)}`,
  ]
    .filter(Boolean)
    .join("\n");
  if (!transcript) return null;

  const { resolveApiKey } = await import("./app-config.ts");
  if (!resolveApiKey().key) return null;
  try {
    const { generateText } = await import("ai");
    const { getModel, reasoningProviderOptions } = await import("./agent.ts");
    const { text } = await generateText({
      // generous cap: reasoning models (e.g. gpt-5.x) spend output tokens on
      // reasoning before emitting the title, so a tiny cap yields empty text
      model: getModel(),
      providerOptions: reasoningProviderOptions(null, "low", { exclude: true }),
      maxOutputTokens: 512,
      prompt:
        "Write a short, specific title (max 6 words) for this assistant conversation. " +
        "Plain text only — no quotes, no trailing punctuation.\n\n" +
        transcript,
    });
    const title = text
      .replace(/["'`]/g, "")
      .replace(/\s+/g, " ")
      .replace(/[.\s]+$/, "")
      .trim()
      .slice(0, 70);
    if (title) s.renameConversation(id, title);
    return title || null;
  } catch {
    return null;
  }
}

/** Generate a short AI title for a conversation from its first exchange and save
 * it. No-ops (keeps the question-derived title) if there's no API key or the model
 * call fails. Returns the new title, or null. */
export const generateTitleFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    return { title: await generateConversationTitle(data) };
  });
