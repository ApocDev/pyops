import { generateId, generateText } from "ai";

import type { StoredMessage } from "../db/conversations.server.ts";
import { ensureModelsLoaded, modelContextWindow } from "./openrouter-models.ts";
import { getModel, reasoningProviderOptions } from "./agent.ts";
import { resolveApiKey, resolveModel } from "./app-config.server.ts";

const TRIGGER_RATIO = 0.75;
const TARGET_RATIO = 0.55;
const RECENT_MESSAGES_TO_KEEP = 8;
const MIN_MESSAGES_TO_COMPACT = 6;
const SUMMARY_MAX_OUTPUT_TOKENS = 1_500;
const SUMMARY_INPUT_CHAR_LIMIT = 90_000;

type CompactionData = {
  version: 1;
  compactedAt: string;
  model: string;
  originalCount: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  originals: StoredMessage[];
};

type ParsedPart = {
  type?: string;
  text?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  data?: CompactionData;
};

function parseParts(parts: string): ParsedPart[] {
  try {
    const parsed = JSON.parse(parts);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function textForModelEstimate(message: StoredMessage): string {
  return parseParts(message.parts)
    .map((part) => {
      if (part.type === "text" || part.type === "reasoning") return part.text ?? "";
      if (part.type?.startsWith("tool-") || part.type === "dynamic-tool") {
        return JSON.stringify({
          type: part.type,
          input: part.input,
          output: part.output,
          errorText: part.errorText,
        });
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function estimateMessageTokens(message: StoredMessage): number {
  const text = textForModelEstimate(message);
  return Math.ceil(text.length / 4) + 8;
}

export function estimateConversationTokens(messages: StoredMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

function compactedOriginals(message: StoredMessage): StoredMessage[] {
  const part = parseParts(message.parts).find((p) => p.type === "data-compaction");
  return part?.data?.originals ?? [];
}

function archiveOriginals(messages: StoredMessage[]): StoredMessage[] {
  return messages.flatMap((message) => {
    if (message.id.startsWith("compaction-")) return compactedOriginals(message);
    return [message];
  });
}

function messageForSummary(message: StoredMessage): string {
  if (message.id.startsWith("compaction-")) return textForModelEstimate(message);
  const text = textForModelEstimate(message).trim();
  return `${message.role.toUpperCase()}:\n${text || "(no text content)"}`;
}

function transcriptForSummary(messages: StoredMessage[]): string {
  const transcript = messages.map(messageForSummary).join("\n\n---\n\n");
  if (transcript.length <= SUMMARY_INPUT_CHAR_LIMIT) return transcript;
  return (
    transcript.slice(0, SUMMARY_INPUT_CHAR_LIMIT / 2) +
    "\n\n[... middle omitted for summarization budget ...]\n\n" +
    transcript.slice(-SUMMARY_INPUT_CHAR_LIMIT / 2)
  );
}

function fallbackSummary(messages: StoredMessage[]): string {
  return (
    "Earlier conversation was compacted locally before the next assistant turn.\n\n" +
    messages
      .map((message) => {
        const text = textForModelEstimate(message).replace(/\s+/g, " ").trim();
        return `- ${message.role}: ${text.slice(0, 400) || "(no text content)"}`;
      })
      .join("\n")
  );
}

async function summarizeMessages(messages: StoredMessage[], modelOverride: string | null) {
  if (!resolveApiKey().key) return fallbackSummary(messages);
  try {
    const { text } = await generateText({
      model: getModel(modelOverride),
      providerOptions: reasoningProviderOptions(modelOverride, "low", { exclude: true }),
      maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
      prompt:
        "Summarize the earlier part of this PyOps assistant conversation so the same " +
        "assistant can continue with full context. Preserve user goals, decisions, " +
        "selected models/settings, unresolved questions, important recipe/block facts, " +
        "tool results, and any commitments. Be concise but specific.\n\n" +
        transcriptForSummary(messages),
    });
    return text.trim() || fallbackSummary(messages);
  } catch {
    return fallbackSummary(messages);
  }
}

type CompactOptions = {
  /** Real token count of the conversation as last measured by OpenRouter; when
   * present it (not the chars/4 estimate) drives the trigger. */
  realUsedTokens?: number | null;
  /** The concrete model that served the last turn — its context window is more
   * accurate than the (possibly aliased) configured model. */
  lastModelId?: string | null;
  /** Compact now regardless of the trigger ratio (the manual gauge button). */
  force?: boolean;
};

export async function compactMessagesForContext(
  messages: StoredMessage[],
  modelOverride: string | null,
  opts: CompactOptions = {},
): Promise<{ messages: StoredMessage[]; compacted: boolean }> {
  await ensureModelsLoaded();
  const resolved = resolveModel(modelOverride).model;
  const contextWindow = modelContextWindow(opts.lastModelId || resolved);
  const estimated = estimateConversationTokens(messages);
  // Prefer the real count from the last turn; fall back to the estimate only when
  // we have no measured number yet. Accuracy here means we don't compact (and drop
  // detail) until the context is genuinely close to full.
  const beforeTokens = opts.realUsedTokens ?? estimated;
  if (!opts.force && beforeTokens < contextWindow * TRIGGER_RATIO) {
    return { messages, compacted: false };
  }
  if (messages.length <= RECENT_MESSAGES_TO_KEEP + MIN_MESSAGES_TO_COMPACT) {
    return { messages, compacted: false };
  }

  let split = Math.max(MIN_MESSAGES_TO_COMPACT, messages.length - RECENT_MESSAGES_TO_KEEP);
  let candidates = messages.slice(0, split);
  let recent = messages.slice(split);

  while (
    recent.length > RECENT_MESSAGES_TO_KEEP &&
    estimateConversationTokens(recent) > contextWindow * TARGET_RATIO
  ) {
    split += 1;
    candidates = messages.slice(0, split);
    recent = messages.slice(split);
  }

  if (candidates.length < MIN_MESSAGES_TO_COMPACT) return { messages, compacted: false };

  const archived = archiveOriginals(candidates);
  const summary = await summarizeMessages(candidates, modelOverride);
  const compactedAt = new Date().toISOString();
  const summaryMessage: StoredMessage = {
    id: `compaction-${generateId()}`,
    role: "system",
    parts: JSON.stringify([
      {
        type: "text",
        text:
          "Earlier conversation summary. Use this as context for the rest of the chat:\n\n" +
          summary,
      },
      {
        type: "data-compaction",
        data: {
          version: 1,
          compactedAt,
          model: resolved,
          originalCount: archived.length,
          estimatedTokensBefore: beforeTokens,
          estimatedTokensAfter: 0,
          originals: archived,
        } satisfies CompactionData,
      },
    ]),
  };
  const next = [summaryMessage, ...recent];
  const afterTokens = estimateConversationTokens(next);
  const parts = parseParts(summaryMessage.parts);
  const data = parts.find((p) => p.type === "data-compaction")?.data;
  if (data) data.estimatedTokensAfter = afterTokens;
  summaryMessage.parts = JSON.stringify(parts);
  return { messages: next, compacted: true };
}
