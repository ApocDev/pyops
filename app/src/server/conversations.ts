/**
 * Server functions for persisted assistant conversations. Thin wrappers over
 * the db/conversations query layer, scoped to the active project.
 */
import { createServerFn } from "@tanstack/react-start";

import type { StoredMessage } from "../db/conversations.server.ts";

// Server-only modules, top-level: referenced only inside `.handler()` bodies,
// so the Start compiler prunes them from the client bundle with the handlers.
import * as catalog from "./model-catalog.server.ts";
import * as store from "../db/conversations.server.ts";
import * as compaction from "./conversation-compaction.ts";
import * as cfg from "./app-config.server.ts";
import { activeAssistantRunIds } from "./assistant-run-store.ts";

export const listConversationsFn = createServerFn({ method: "GET" }).handler(async () =>
  store.listConversations(),
);

export const getConversationFn = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data }) => store.getConversation(data));

export const saveConversationFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; messages: StoredMessage[]; title?: string }) => d)
  .handler(async ({ data }) => {
    store.saveConversation(data.id, data.messages, data.title);
    return { ok: true };
  });

export const renameConversationFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; title: string }) => d)
  .handler(async ({ data }) => {
    store.renameConversation(data.id, data.title);
    return { ok: true };
  });

export const deleteConversationFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    store.deleteConversation(data);
    return { ok: true };
  });

export const activeAssistantRunsFn = createServerFn({ method: "GET" }).handler(async () =>
  activeAssistantRunIds(),
);

export const conversationModelFn = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    await catalog.ensureModelsLoaded();
    const conv = store.getConversation(data);
    const resolved = cfg.resolveModel(conv?.model);
    return {
      model: conv?.model ?? "",
      reasoningEffort: conv?.reasoningEffort ?? "",
      resolvedModel: resolved.model,
      modelFromEnv: resolved.fromEnv,
      modelFromConversation: resolved.fromConversation,
      reasoningEffortSupported: catalog.supportsReasoningEffort(resolved.model),
      reasoningEfforts: catalog.supportedReasoningEfforts(resolved.model),
      // The endpoint's own model list in OpenAI-compatible mode; null means
      // OpenRouter, where the picker shows its curated shortlist.
      models: catalog.pickerModels(),
      defaultModel: cfg.resolveProvider().kind === "openrouter" ? cfg.DEFAULT_MODEL : "",
      // Missing setup for THIS chat: its own model pick counts toward the model.
      problem: cfg.providerProblem(conv?.model),
    };
  });

/** Live context-fill status for the gauge: real token count from the last turn
 * when we have one (else a chars/4 estimate), against the model's real context
 * window. `contextWindow` is null when the endpoint doesn't report one. */
export const conversationTokenStatusFn = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    await catalog.ensureModelsLoaded();
    const conv = store.getConversation(data);
    const resolved = cfg.resolveModel(conv?.model).model;
    const contextWindow =
      catalog.modelContextWindow(conv?.usage.modelId || resolved) ??
      catalog.modelContextWindow(resolved);
    const real = conv?.usage.totalTokens ?? null;
    const usedTokens = real ?? (conv ? compaction.estimateConversationTokens(conv.messages) : 0);
    const messageCount = conv?.messages.length ?? 0;
    return {
      usedTokens,
      contextWindow,
      ratio: contextWindow ? usedTokens / contextWindow : null,
      estimated: real == null,
      modelId: conv?.usage.modelId ?? null,
      costUsd: conv?.usage.costUsd ?? null,
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
    const s = store;
    const conv = s.getConversation(data);
    if (!conv) return { ok: false, compacted: false, messages: [] as StoredMessage[] };
    const res = await compaction.compactMessagesForContext(conv.messages, conv.model, {
      realUsedTokens: conv.usage.totalTokens,
      lastModelId: conv.usage.modelId,
      force: true,
      sessionId: data,
    });
    if (res.compacted) {
      s.saveConversation(data, res.messages, conv.title ?? undefined);
      s.recordTurnUsage(data, {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        modelId: null,
        costUsd: null,
      });
    }
    return { ok: true, compacted: res.compacted, messages: res.messages };
  });

export const setConversationModelFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; model: string | null }) => d)
  .handler(async ({ data }) => {
    store.setConversationModel(data.id, data.model);
    return { ok: true };
  });

export const setConversationReasoningEffortFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; reasoningEffort: string | null }) => d)
  .handler(async ({ data }) => {
    store.setConversationReasoningEffort(data.id, data.reasoningEffort);
    return { ok: true };
  });
