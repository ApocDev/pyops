/**
 * App-level live-chat store (run continuity). Holds one AI-SDK `Chat`
 * instance per conversation **outside the React tree**, so an in-flight agent run
 * keeps streaming when you navigate away from the assistant (or switch chats) —
 * the loop is server-side, and the connection is held here, not by a component
 * that unmounts. Multiple conversations run in parallel (one Chat each).
 *
 * Persistence is server-owned too: `/api/chat` saves submitted messages, streams
 * through a process-local replay buffer, and saves the finished assistant message.
 * The transport notifies listeners once the server accepts a send so the sidebar
 * refreshes without a duplicate client-side history write.
 */
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";

import {
  compactConversationFn,
  getConversationFn,
  saveConversationFn,
} from "#/server/conversations.ts";

export type ChatInstance = Chat<UIMessage>;

const chats = new Map<string, ChatInstance>();
const building = new Map<string, Promise<ChatInstance>>();
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

/** Subscribe to run/persistence changes (for the nav indicator + sidebar refresh). */
export function subscribeRuns(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

const isGenerating = (chat: ChatInstance) =>
  chat.status === "submitted" || chat.status === "streaming";

/** How many conversations are generating right now. */
export function activeRunCount(): number {
  let n = 0;
  for (const chat of chats.values()) if (isGenerating(chat)) n += 1;
  return n;
}

/** A stable snapshot (sorted, comma-joined ids) of conversations generating right
 * now — safe for useSyncExternalStore (string identity), parse with .split(","). */
export function runningKey(): string {
  const ids: string[] = [];
  for (const [id, chat] of chats) if (isGenerating(chat)) ids.push(id);
  return ids.sort().join(",");
}

const messagesToStored = (messages: UIMessage[]) =>
  messages.map((m) => ({ id: m.id, role: m.role, parts: JSON.stringify(m.parts) }));

async function build(id: string): Promise<ChatInstance> {
  const conv = await getConversationFn({ data: id });
  const messages: UIMessage[] = conv
    ? conv.messages.map(
        (m) => ({ id: m.id, role: m.role, parts: JSON.parse(m.parts) }) as UIMessage,
      )
    : [];
  const chat = new Chat<UIMessage>({
    id,
    messages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        notify();
        return response;
      },
      prepareReconnectToStreamRequest: ({ id }) => ({
        api: `/api/chat?stream=${encodeURIComponent(id)}`,
      }),
    }),
  });
  // status changes drive the nav run-indicator + sidebar refresh
  chat["~registerStatusCallback"](() => notify());
  chats.set(id, chat);
  return chat;
}

/** The live Chat for a conversation, building it (and loading history) on first
 * use. The instance is cached and reused across mounts. */
export function getChat(id: string): Promise<ChatInstance> {
  const existing = chats.get(id);
  if (existing) return Promise.resolve(existing);
  let p = building.get(id);
  if (!p) {
    p = build(id).finally(() => building.delete(id));
    building.set(id, p);
  }
  return p;
}

/** An already-built instance, if any (sync) — lets a re-mount show instantly. */
export function peekChat(id: string): ChatInstance | null {
  return chats.get(id) ?? null;
}

/** Send a message. The API persists the submitted history before returning the
 * stream response; the transport-level notification then refreshes the sidebar. */
export async function sendInChat(id: string, text: string, messageId?: string) {
  const chat = await getChat(id);
  void chat.sendMessage({ text, messageId });
}

export async function retryInChat(id: string, messageId?: string) {
  const chat = await getChat(id);
  void chat.regenerate({ messageId });
}

export async function stopInChat(id: string) {
  const chat = await getChat(id);
  const last = chat.messages[chat.messages.length - 1];
  await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "stop",
      id,
      assistantMessage: last?.role === "assistant" ? last : undefined,
    }),
  });
  await chat.stop();
  notify();
}

export async function branchChat(id: string, throughMessageId: string) {
  const chat = await getChat(id);
  const index = chat.messages.findIndex((m) => m.id === throughMessageId);
  if (index < 0) return null;
  const branchId = crypto.randomUUID();
  // Message ids are the table primary key, so a branch needs its own ids rather
  // than inserting the source conversation's ids a second time.
  const messages = chat.messages
    .slice(0, index + 1)
    .map((message) => ({ ...message, id: crypto.randomUUID() }));
  await saveConversationFn({ data: { id: branchId, messages: messagesToStored(messages) } });
  await getChat(branchId);
  return branchId;
}

/** Force-compact a conversation now and swap the live chat's messages to the
 * compacted set so the open view updates immediately. No-op while generating.
 * Returns whether anything was compacted. */
export async function compactChat(id: string): Promise<{ compacted: boolean }> {
  const chat = await getChat(id);
  if (isGenerating(chat)) return { compacted: false };
  const res = await compactConversationFn({ data: id });
  if (res.compacted && res.messages.length) {
    chat.messages = res.messages.map(
      (m) => ({ id: m.id, role: m.role, parts: JSON.parse(m.parts) }) as UIMessage,
    );
    notify();
  }
  return { compacted: res.compacted };
}

/** Forget a conversation's live chat (on delete): stop it and drop it. */
export function dropChat(id: string) {
  const chat = chats.get(id);
  if (chat) void chat.stop();
  chats.delete(id);
  notify();
}
