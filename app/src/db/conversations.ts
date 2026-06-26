/**
 * Persisted assistant conversations, per-project. Pure queries over the
 * active project's db. Because these tables are newer than most existing project
 * dbs, `ensureSchema()` creates them idempotently on first use so the feature
 * works without a manual `db:push` per project (new projects get them from the
 * schema via drizzle-kit push). schema.ts stays the canonical definition.
 */
import { desc, eq, sql } from "drizzle-orm";

import { db, currentDatabaseFile } from "./index.ts";
import { conversationMessages, conversations } from "./schema.ts";

/** A message at the transport/storage boundary: `parts` is the JSON-stringified
 * AI-SDK UIMessage parts (a string keeps it trivially serializable across the
 * server-fn boundary; the client parses it back into UIMessage parts). */
export type StoredMessage = { id: string; role: string; parts: string };
export type ReasoningEffort = "low" | "medium" | "high";

const REASONING_EFFORTS = new Set<string>(["low", "medium", "high"]);

export function normalizeReasoningEffort(value: string | null | undefined): ReasoningEffort | null {
  const trimmed = value?.trim();
  return trimmed && REASONING_EFFORTS.has(trimmed) ? (trimmed as ReasoningEffort) : null;
}

const ensured = new Set<string>();
function ensureSchema() {
  const file = currentDatabaseFile();
  if (ensured.has(file)) return;
  db.run(
    sql`CREATE TABLE IF NOT EXISTS conversations (
      id text PRIMARY KEY NOT NULL, title text, model text, reasoning_effort text,
      created_at integer DEFAULT (unixepoch()), updated_at integer DEFAULT (unixepoch())
    )`,
  );
  for (const col of [
    sql`ALTER TABLE conversations ADD COLUMN reasoning_effort text`,
    sql`ALTER TABLE conversations ADD COLUMN last_input_tokens integer`,
    sql`ALTER TABLE conversations ADD COLUMN last_output_tokens integer`,
    sql`ALTER TABLE conversations ADD COLUMN last_total_tokens integer`,
    sql`ALTER TABLE conversations ADD COLUMN last_model_id text`,
  ]) {
    try {
      db.run(col);
    } catch {
      /* already present */
    }
  }
  db.run(
    sql`CREATE TABLE IF NOT EXISTS conversation_messages (
      id text PRIMARY KEY NOT NULL, conversation_id text NOT NULL,
      role text NOT NULL, parts text NOT NULL, seq integer NOT NULL
    )`,
  );
  db.run(sql`CREATE INDEX IF NOT EXISTS cm_conv_idx ON conversation_messages (conversation_id)`);
  ensured.add(file);
}

/** First bit of the first user message — a reasonable auto-title. */
function deriveTitle(messages: StoredMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  let text = "";
  if (firstUser) {
    try {
      const parts = JSON.parse(firstUser.parts) as { type?: string; text?: string }[];
      text = parts
        .filter((p) => p?.type === "text")
        .map((p) => p.text ?? "")
        .join(" ")
        .trim();
    } catch {
      /* unparseable parts — fall back to the default title */
    }
  }
  if (!text) return "New chat";
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

export function listConversations() {
  ensureSchema();
  return db
    .select({
      id: conversations.id,
      title: conversations.title,
      model: conversations.model,
      reasoningEffort: conversations.reasoningEffort,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .orderBy(desc(conversations.updatedAt))
    .all();
}

export function getConversation(id: string) {
  ensureSchema();
  const c = db.select().from(conversations).where(eq(conversations.id, id)).get();
  if (!c) return null;
  const msgs = db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, id))
    .orderBy(conversationMessages.seq)
    .all();
  return {
    id: c.id,
    title: c.title,
    model: c.model,
    reasoningEffort: normalizeReasoningEffort(c.reasoningEffort),
    usage: {
      inputTokens: c.lastInputTokens ?? null,
      outputTokens: c.lastOutputTokens ?? null,
      totalTokens: c.lastTotalTokens ?? null,
      modelId: c.lastModelId ?? null,
    },
    messages: msgs.map((m) => ({ id: m.id, role: m.role, parts: m.parts }) as StoredMessage),
  };
}

export type TurnUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  modelId: string | null;
};

/** Record the real token usage of the most recent completed turn (from
 * OpenRouter, via the stream's onFinish). Used to anchor compaction and the
 * context gauge to actual counts. No-op if the conversation row doesn't exist. */
export function recordTurnUsage(id: string, usage: TurnUsage) {
  ensureSchema();
  db.update(conversations)
    .set({
      lastInputTokens: usage.inputTokens,
      lastOutputTokens: usage.outputTokens,
      lastTotalTokens: usage.totalTokens,
      lastModelId: usage.modelId,
    })
    .where(eq(conversations.id, id))
    .run();
}

/** Upsert a conversation and replace its messages (the client sends the full,
 * authoritative message list after each turn). Skips empty chats. */
export function saveConversation(id: string, messages: StoredMessage[], title?: string) {
  ensureSchema();
  if (!messages.length) return;
  const now = new Date();
  const finalTitle = title?.trim() || deriveTitle(messages);
  const existing = db
    .select({ model: conversations.model, reasoningEffort: conversations.reasoningEffort })
    .from(conversations)
    .where(eq(conversations.id, id))
    .get();
  db.transaction((tx) => {
    tx.insert(conversations)
      .values({
        id,
        title: finalTitle,
        model: existing?.model ?? null,
        reasoningEffort: existing?.reasoningEffort ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({ target: conversations.id, set: { title: finalTitle, updatedAt: now } })
      .run();
    tx.delete(conversationMessages).where(eq(conversationMessages.conversationId, id)).run();
    tx.insert(conversationMessages)
      .values(
        messages.map((m, i) => ({
          id: m.id,
          conversationId: id,
          role: m.role,
          parts: m.parts,
          seq: i,
        })),
      )
      .run();
  });
}

export function setConversationModel(id: string, model: string | null) {
  ensureSchema();
  const value = model?.trim() || null;
  const existing = db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, id))
    .get();
  if (!existing) {
    db.insert(conversations)
      .values({ id, title: "New chat", model: value, updatedAt: new Date() })
      .run();
    return;
  }
  db.update(conversations)
    .set({ model: value, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .run();
}

export function setConversationReasoningEffort(id: string, effort: string | null) {
  ensureSchema();
  const value = normalizeReasoningEffort(effort);
  const existing = db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, id))
    .get();
  if (!existing) {
    db.insert(conversations)
      .values({ id, title: "New chat", reasoningEffort: value, updatedAt: new Date() })
      .run();
    return;
  }
  db.update(conversations)
    .set({ reasoningEffort: value, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .run();
}

export function renameConversation(id: string, title: string) {
  ensureSchema();
  db.update(conversations)
    .set({ title: title.trim() || "Untitled", updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .run();
}

export function deleteConversation(id: string) {
  ensureSchema();
  db.transaction((tx) => {
    tx.delete(conversationMessages).where(eq(conversationMessages.conversationId, id)).run();
    tx.delete(conversations).where(eq(conversations.id, id)).run();
  });
}
