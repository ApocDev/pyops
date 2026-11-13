/**
 * `/api/chat` end to end against a mock language model: the real route streams a
 * tool step then a text step, persists the finished assistant message, and
 * records the final step's token usage and the turn's cost. The conversation
 * opens with a compaction summary (a stored `system` message), which the route
 * must still accept. Further cases run the OpenAI-compatible mode, including the
 * setup check that a conversation's own model pick satisfies.
 */
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { evictDatabase, switchDatabase } from "#/db/index.server.ts";
import { getConversation, setConversationModel } from "#/db/conversations.server.ts";
import { makeTestDb, type TestDb } from "#/db/test-helpers.ts";

// An empty data dir, set before any module reads it, so a developer's real
// app-config.json can't change which provider or model these tests resolve.
const dataDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(tmpdir(), "pyops-chat-route-"));
  process.env.PYOPS_DATA_DIR = dir;
  return dir;
});

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

/** OpenAI-compatible response metadata carrying one request's cost. */
const costMeta = (cost: number) => ({ openaiCompatible: { cost } });

const step = (parts: StreamPart[]) => ({
  stream: simulateReadableStream<StreamPart>({
    chunks: [
      { type: "stream-start", warnings: [] },
      { type: "response-metadata", modelId: "mock/model" },
      ...parts,
    ],
  }),
});

// Title generation runs after a first exchange; it uses doGenerate.
const titleReply = {
  content: [{ type: "text" as const, text: "Notes check" }],
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage: usage(10, 3),
  warnings: [],
};

/** A tool step then a text step; `cost` adds per-request cost metadata. */
const toolLoopModel = (cost?: [number, number]) =>
  new MockLanguageModelV4({
    doStream: [
      step([
        { type: "tool-call", toolCallId: "call-1", toolName: "listNotes", input: "{}" },
        {
          type: "finish",
          usage: usage(1000, 20),
          finishReason: { unified: "tool-calls", raw: undefined },
          ...(cost ? { providerMetadata: costMeta(cost[0]) } : {}),
        },
      ]),
      step([
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "No notes yet." },
        { type: "text-end", id: "t1" },
        {
          type: "finish",
          usage: usage(1200, 30),
          finishReason: { unified: "stop", raw: "stop" },
          ...(cost ? { providerMetadata: costMeta(cost[1]) } : {}),
        },
      ]),
    ],
    doGenerate: titleReply,
  });

// Each test swaps in a fresh model; the mocked getModel reads this binding per call.
let model = toolLoopModel();
const getModel = vi.fn((_override?: string | null, _sessionId?: string) => model);

vi.mock("#/server/agent.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/server/agent.ts")>()),
  getModel,
}));
// Compaction sizes the context window from the provider's catalog; skip the fetch.
vi.mock("#/server/model-catalog.server.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/server/model-catalog.server.ts")>()),
  ensureModelsLoaded: async () => {},
  modelContextWindow: () => null,
  supportsReasoningEffort: () => false,
}));

const { Route } = await import("#/routes/api.chat.ts");

let fx: TestDb;

beforeEach(async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  fx = await makeTestDb();
  fx.db.close();
  switchDatabase(fx.file);
});

afterAll(async () => {
  const { rmSync } = await import("node:fs");
  rmSync(dataDir, { recursive: true, force: true });
});

/** A first-turn chat request for conversation `id`. */
const chatRequest = (id: string) =>
  new Request("http://test/api/chat", {
    method: "POST",
    body: JSON.stringify({
      id,
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Any notes?" }] }],
    }),
  });

afterEach(() => {
  getModel.mockClear();
  vi.unstubAllEnvs();
  evictDatabase(fx.file);
  fx.cleanup();
});

const { POST: post } = Route.options.server!.handlers as {
  POST: (ctx: { request: Request }) => Promise<Response>;
};

describe("/api/chat", () => {
  it("streams a tool loop for a compacted conversation and persists the result", async () => {
    model = toolLoopModel();
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
    // The provider reported no cost, so it stays unknown rather than 0.
    expect(saved?.usage).toMatchObject({
      totalTokens: 1230,
      modelId: "mock/model",
      costUsd: null,
    });
  });

  it("runs against an OpenAI-compatible endpoint and records the turn's cost", async () => {
    vi.stubEnv("PYOPS_AI_PROVIDER", "openai-compatible");
    vi.stubEnv("PYOPS_OPENAI_COMPATIBLE_BASE_URL", "https://gateway.test/v1");
    vi.stubEnv("PYOPS_AGENT_MODEL", "deepseek/deepseek-v4.1-flash");
    model = toolLoopModel([0.001, 0.0025]);

    const response = await post({
      request: new Request("http://test/api/chat", {
        method: "POST",
        body: JSON.stringify({
          id: "compat-chat",
          messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Any notes?" }] }],
        }),
      }),
    });
    expect(response.status).toBe(200);
    await response.text();

    // The conversation id reaches the provider as the gateway session.
    expect(getModel).toHaveBeenCalledWith(null, "compat-chat");
    const saved = getConversation("compat-chat");
    expect(JSON.parse(saved!.messages.at(-1)!.parts)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text", text: "No notes yet." })]),
    );
    expect(saved?.usage.totalTokens).toBe(1230);
    // Every step is a billed request, so the turn's cost is their sum.
    expect(saved?.usage.costUsd).toBeCloseTo(0.0035);
  });

  it("accepts a conversation's own model when the endpoint has no default model", async () => {
    vi.stubEnv("PYOPS_AI_PROVIDER", "openai-compatible");
    vi.stubEnv("PYOPS_OPENAI_COMPATIBLE_BASE_URL", "https://gateway.test/v1");
    model = toolLoopModel([0.001, 0.0025]);
    // The model picker stores the pick before the first message is sent.
    setConversationModel("picked", "local/picked-model");

    const response = await post({ request: chatRequest("picked") });
    expect(response.status).toBe(200);
    await response.text();
    expect(getModel).toHaveBeenCalledWith("local/picked-model", "picked");
  });

  it("refuses with the no-model error when neither a default nor a pick is set", async () => {
    vi.stubEnv("PYOPS_AI_PROVIDER", "openai-compatible");
    vi.stubEnv("PYOPS_OPENAI_COMPATIBLE_BASE_URL", "https://gateway.test/v1");

    const response = await post({ request: chatRequest("unpicked") });
    expect(response.status).toBe(500);
    expect(await response.text()).toMatch(/No model set for the OpenAI-compatible endpoint/);
    expect(getModel).not.toHaveBeenCalled();
    // Nothing is persisted for a request that can't run.
    expect(getConversation("unpicked")).toBeNull();
  });

  it("names the page a dock message was sent from in the system prompt", async () => {
    model = new MockLanguageModelV4({
      doStream: [
        step([
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "The crushers." },
          { type: "text-end", id: "t1" },
          { type: "finish", usage: usage(900, 5), finishReason: { unified: "stop", raw: "stop" } },
        ]),
      ],
      doGenerate: titleReply,
    });
    const request = new Request("http://test/api/chat", {
      method: "POST",
      body: JSON.stringify({
        id: "dock-chat",
        messages: [
          {
            id: "u1",
            role: "user",
            parts: [
              { type: "text", text: "Why does this need so much power?" },
              {
                type: "data-page-context",
                data: {
                  path: "/block/12",
                  page: "Blocks",
                  entity: { kind: "block", id: "12", label: "Iron plate" },
                },
              },
            ],
          },
        ],
      }),
    });

    const response = await post({ request });
    await response.text();

    const prompt = model.doStreamCalls[0].prompt;
    expect(prompt[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining(
        "sent from the Blocks page (`/block`), focused on block id 12, which the app labels «Iron plate».",
      ),
    });
    // the record itself stays out of the user turn
    expect(prompt.find((m) => m.role === "user")?.content).toEqual([
      { type: "text", text: "Why does this need so much power?" },
    ]);
  });
});
