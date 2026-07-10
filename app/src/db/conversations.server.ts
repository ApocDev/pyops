/**
 * Persisted assistant conversations, per-project. Pure queries over the active
 * project's db. `ensureSchema()` creates these tables idempotently on first use, so
 * every project db has them. schema.ts stays the canonical definition.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db, currentDatabaseFile } from "./index.server.ts";
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

function conversationValues(id: string, messages: StoredMessage[], title?: string) {
  return {
    id,
    title: title?.trim() || deriveTitle(messages),
    updatedAt: new Date(),
  };
}

function messageValues(id: string, messages: StoredMessage[]) {
  return messages.map((m, i) => ({
    id: m.id,
    conversationId: id,
    role: m.role,
    parts: m.parts,
    seq: i,
  }));
}

/** Upsert a conversation and replace its full message history. This is the
 * explicit path for compaction, branching, and other history rewrites. Ordinary
 * chat turns use `syncConversation` so unchanged rows are not deleted/reinserted.
 * Skips empty chats. */
export function saveConversation(id: string, messages: StoredMessage[], title?: string) {
  ensureSchema();
  if (!messages.length) return;
  const values = conversationValues(id, messages, title);
  db.transaction((tx) => {
    tx.insert(conversations)
      .values(values)
      .onConflictDoUpdate({
        target: conversations.id,
        set: {
          ...(title?.trim() ? { title: values.title } : {}),
          updatedAt: values.updatedAt,
        },
      })
      .run();
    tx.delete(conversationMessages).where(eq(conversationMessages.conversationId, id)).run();
    tx.insert(conversationMessages).values(messageValues(id, messages)).run();
  });
}

/** Persist the authoritative message list for an ordinary submit/finish without
 * churning the unchanged prefix. Upserts current rows and truncates a stale tail
 * left by retry or edit-and-resend. The title is derived only when the
 * conversation is first inserted; later turns preserve AI/manual titles. */
export function syncConversation(id: string, messages: StoredMessage[]) {
  ensureSchema();
  if (!messages.length) return;
  const values = conversationValues(id, messages);
  db.transaction((tx) => {
    tx.insert(conversations)
      .values(values)
      .onConflictDoUpdate({
        target: conversations.id,
        set: {
          title: sql`CASE WHEN ${conversations.title} IS NULL OR ${conversations.title} = 'New chat' THEN excluded.title ELSE ${conversations.title} END`,
          updatedAt: values.updatedAt,
        },
      })
      .run();
    tx.delete(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, id),
          gte(conversationMessages.seq, messages.length),
        ),
      )
      .run();
    tx.insert(conversationMessages)
      .values(messageValues(id, messages))
      .onConflictDoUpdate({
        target: conversationMessages.id,
        set: {
          conversationId: sql`excluded.conversation_id`,
          role: sql`excluded.role`,
          parts: sql`excluded.parts`,
          seq: sql`excluded.seq`,
        },
      })
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
