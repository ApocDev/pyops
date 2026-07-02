import { generateId, UI_MESSAGE_STREAM_HEADERS, type UIMessage } from "ai";
import * as db from "#/db/conversations.server.ts";

type Subscriber = ReadableStreamDefaultController<string>;

type ActiveRun = {
  chatId: string;
  streamId: string;
  chunks: string[];
  subscribers: Set<Subscriber>;
  abort: AbortController;
  done: boolean;
};

const runs = new Map<string, ActiveRun>();

export function startAssistantRun(chatId: string) {
  const previous = runs.get(chatId);
  previous?.abort.abort();
  previous?.subscribers.forEach((s) => {
    try {
      s.close();
    } catch {
      /* subscriber already gone */
    }
  });

  const run: ActiveRun = {
    chatId,
    streamId: generateId(),
    chunks: [],
    subscribers: new Set(),
    abort: new AbortController(),
    done: false,
  };
  runs.set(chatId, run);
  return { streamId: run.streamId, abortSignal: run.abort.signal };
}

export async function recordAssistantStream(
  chatId: string,
  streamId: string,
  stream: ReadableStream<string>,
) {
  const run = runs.get(chatId);
  if (!run || run.streamId !== streamId) return;
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      run.chunks.push(value);
      run.subscribers.forEach((s) => s.enqueue(value));
    }
  } catch (err) {
    run.subscribers.forEach((s) => s.error(err));
    throw err;
  } finally {
    run.done = true;
    run.subscribers.forEach((s) => {
      try {
        s.close();
      } catch {
        /* subscriber already gone */
      }
    });
    run.subscribers.clear();
  }
}

export function finishAssistantRun(chatId: string, streamId: string) {
  const run = runs.get(chatId);
  if (run?.streamId === streamId) runs.delete(chatId);
}

export function resumeAssistantRun(chatId: string): Response {
  const run = runs.get(chatId);
  if (!run) return new Response(null, { status: 204 });

  let subscriber: Subscriber | null = null;
  const stream = new ReadableStream<string>({
    start(controller) {
      run.chunks.forEach((chunk) => controller.enqueue(chunk));
      if (run.done) {
        controller.close();
        return;
      }
      subscriber = controller;
      run.subscribers.add(controller);
    },
    cancel() {
      if (subscriber) run.subscribers.delete(subscriber);
    },
  });

  return new Response(stream, { headers: UI_MESSAGE_STREAM_HEADERS });
}

export function stopAssistantRun(chatId: string, assistantMessage?: UIMessage) {
  const run = runs.get(chatId);
  if (!run) return { stopped: false };
  run.abort.abort();
  if (assistantMessage) {
    const conv = db.getConversation(chatId);
    const messages = conv?.messages ?? [];
    const existing = messages.findIndex((m) => m.id === assistantMessage.id);
    const stored = {
      id: assistantMessage.id,
      role: assistantMessage.role,
      parts: JSON.stringify(assistantMessage.parts),
    };
    const next =
      existing >= 0 ? messages.map((m, i) => (i === existing ? stored : m)) : [...messages, stored];
    db.saveConversation(chatId, next);
  }
  run.subscribers.forEach((s) => {
    try {
      s.close();
    } catch {
      /* subscriber already gone */
    }
  });
  runs.delete(chatId);
  return { stopped: true };
}

export function activeAssistantRunIds() {
  return [...runs.keys()];
}
