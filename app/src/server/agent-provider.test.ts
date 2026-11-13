/**
 * Provider selection in getModel: OpenRouter by default, and in
 * OpenAI-compatible mode a Chat Completions request to the configured endpoint
 * that carries the gateway headers, the reasoning effort, and reports cost.
 * `fetch` is stubbed, so the test sees the exact HTTP request the SDK builds.
 */
import { generateText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { getModel, reasoningProviderOptions, turnCost } from "./agent.ts";
import { ensureModelsLoaded, modelContextWindow, pickerModels } from "./model-catalog.server.ts";

const BASE = "https://gateway.test/v1";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

const completion = {
  id: "gen-1",
  object: "chat.completion",
  created: 1,
  model: "deepseek/deepseek-v4.1-flash",
  choices: [{ index: 0, message: { role: "assistant", content: "Hi." }, finish_reason: "stop" }],
  usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15, cost: 0.0002 },
};

let chatRequests: { url: string; headers: Headers; body: Record<string, unknown> }[];

beforeEach(() => {
  chatRequests = [];
  vi.stubGlobal(
    "fetch",
    // Both the catalog and the SDK call fetch with a URL string and a string body.
    vi.fn(async (url: string, init?: RequestInit & { body?: string }) => {
      if (url === `${BASE}/models`) {
        return json({
          data: [
            { id: "deepseek/deepseek-v4.1-flash", mode: "chat", max_input_tokens: 1_048_576 },
            { id: "black-forest-labs/flux-3-image", mode: "image_generation" },
          ],
        });
      }
      if (url === `${BASE}/model/info`) {
        return json({
          data: [
            {
              model_name: "deepseek/deepseek-v4.1-flash",
              model_info: { supports_reasoning: true },
            },
          ],
        });
      }
      if (url === `${BASE}/chat/completions`) {
        chatRequests.push({
          url,
          headers: new Headers(init?.headers),
          body: JSON.parse(init?.body ?? "{}"),
        });
        return json(completion);
      }
      return new Response("not found", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getModel", () => {
  it("uses OpenRouter by default", () => {
    vi.stubEnv("PYOPS_AI_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubEnv("PYOPS_AGENT_MODEL", "openai/gpt-5.5");
    const model = getModel();
    expect(typeof model === "object" && model.provider).toMatch(/^openrouter/);
  });

  it("talks to an OpenAI-compatible endpoint with gateway headers, effort, and cost", async () => {
    vi.stubEnv("PYOPS_AI_PROVIDER", "openai-compatible");
    vi.stubEnv("PYOPS_OPENAI_COMPATIBLE_BASE_URL", BASE);
    vi.stubEnv("PYOPS_OPENAI_COMPATIBLE_API_KEY", "gateway-key");
    vi.stubEnv("PYOPS_AGENT_MODEL", "deepseek/deepseek-v4.1-flash");

    await ensureModelsLoaded();
    expect(pickerModels()).toEqual(["deepseek/deepseek-v4.1-flash"]);
    expect(modelContextWindow("deepseek/deepseek-v4.1-flash")).toBe(1_048_576);

    const result = await generateText({
      model: getModel(null, "conv-1"),
      providerOptions: reasoningProviderOptions(null, "high"),
      prompt: "hi",
    });

    const [req] = chatRequests;
    expect(req.headers.get("authorization")).toBe("Bearer gateway-key");
    expect(req.headers.get("x-ai-app")).toBe("pyops");
    expect(req.headers.get("x-ai-session")).toBe("conv-1");
    expect(req.body).toMatchObject({
      model: "deepseek/deepseek-v4.1-flash",
      reasoning_effort: "high",
    });
    expect(result.text).toBe("Hi.");
    expect(turnCost(result.steps)).toBe(0.0002);
  });

  it("omits reasoning effort for a model the endpoint doesn't describe", async () => {
    vi.stubEnv("PYOPS_AI_PROVIDER", "openai-compatible");
    vi.stubEnv("PYOPS_OPENAI_COMPATIBLE_BASE_URL", BASE);
    vi.stubEnv("PYOPS_AGENT_MODEL", "unlisted/model");
    await ensureModelsLoaded();
    expect(reasoningProviderOptions(null, "high")).toBeUndefined();
    expect(modelContextWindow("unlisted/model")).toBeNull();
  });
});

describe("turnCost", () => {
  it("sums known step costs and is null when any step's cost is unknown", () => {
    const or = (cost: number) => ({ providerMetadata: { openrouter: { usage: { cost } } } });
    const compat = (cost: number) => ({ providerMetadata: { openaiCompatible: { cost } } });
    expect(turnCost([or(0.01), or(0.02)])).toBeCloseTo(0.03);
    expect(turnCost([compat(0.001), compat(0.002)])).toBeCloseTo(0.003);
    expect(turnCost([compat(0.001), { providerMetadata: undefined }])).toBeNull();
    expect(turnCost([])).toBeNull();
  });
});
