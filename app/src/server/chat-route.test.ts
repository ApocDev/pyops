/**
 * `/api/chat` end to end against a mock language model: the real route streams a
 * tool step then a text step, persists the finished assistant message, and
 * records the final step's token usage. The conversation opens with a compaction
 * summary (a stored `system` message), which the route must still accept.
 */
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { evictDatabase, switchDatabase } from "#/db/index.server.ts";
import { getConversation } from "#/db/conversations.server.ts";
import { makeTestDb, type TestDb } from "#/db/test-helpers.ts";

// Provider-level (V4) stream chunk and usage shapes, read off the mock model.
type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer P>
    ? P
    : never;
type Usage = Extract<StreamPart, { type: "finish" }>["usage"];

const usage = (input: number, output: number): Usage => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

const step = (parts: StreamPart[]) => ({
  stream: simulateReadableStream<StreamPart>({
    chunks: [
      { type: "stream-start", warnings: [] },
      { type: "response-metadata", modelId: "mock/model" },
      ...parts,
    ],
  }),
});

const model = new MockLanguageModelV4({
  doStream: [
    step([
      { type: "tool-call", toolCallId: "call-1", toolName: "listNotes", input: "{}" },
      {
        type: "finish",
        usage: usage(1000, 20),
        finishReason: { unified: "tool-calls", raw: undefined },
      },
    ]),
    step([
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "No notes yet." },
      { type: "text-end", id: "t1" },
      { type: "finish", usage: usage(1200, 30), finishReason: { unified: "stop", raw: "stop" } },
    ]),
  ],
  doGenerate: {
    content: [{ type: "text", text: "Notes check" }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: usage(10, 3),
    warnings: [],
  },
});

vi.mock("#/server/agent.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/server/agent.ts")>()),
  getModel: () => model,
}));
// Compaction sizes the context window from the OpenRouter catalogue; skip the fetch.
vi.mock("#/server/openrouter-models.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/server/openrouter-models.ts")>()),
  ensureModelsLoaded: async () => {},
}));

const { Route } = await import("#/routes/api.chat.ts");

let fx: TestDb;

beforeEach(async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  fx = await makeTestDb();
  fx.db.close();
  switchDatabase(fx.file);
});

afterEach(() => {
  vi.unstubAllEnvs();
  evictDatabase(fx.file);
  fx.cleanup();
});

describe("/api/chat", () => {
  it("streams a tool loop for a compacted conversation and persists the result", async () => {
    const { POST: post } = Route.options.server!.handlers as {
      POST: (ctx: { request: Request }) => Promise<Response>;
    };
    const request = new Request("http://test/api/chat", {
      method: "POST",
      body: JSON.stringify({
        id: "chat",
        messages: [
          {
            id: "summary",
            role: "system",
            parts: [{ type: "text", text: "Earlier conversation summary: iron plates." }],
          },
          { id: "u1", role: "user", parts: [{ type: "text", text: "Any notes?" }] },
        ],
      }),
    });

    const response = await post({ request });
    expect(response.status).toBe(200);
    await response.text();

    const prompt = model.doStreamCalls[0].prompt;
    expect(prompt.filter((m) => m.role === "system").map((m) => m.content)).toEqual([
      expect.stringContaining("PyOps planning assistant"),
      "Earlier conversation summary: iron plates.",
    ]);

    const saved = getConversation("chat");
    const assistant = saved?.messages.at(-1);
    expect(assistant?.role).toBe("assistant");
    expect(JSON.parse(assistant!.parts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool-listNotes", state: "output-available", output: [] }),
        expect.objectContaining({ type: "text", text: "No notes yet." }),
      ]),
    );
    // The final step carried the whole context, so it is the recorded usage.
    expect(saved?.usage).toMatchObject({ totalTokens: 1230, modelId: "mock/model" });
  });
});
